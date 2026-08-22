import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { bundledPackageRecords } from "./bundled-packages.mjs";

const algorithms = new Map([
  ["sha256", { cyclonedx: "SHA-256", length: 32 }],
  ["sha384", { cyclonedx: "SHA-384", length: 48 }],
  ["sha512", { cyclonedx: "SHA-512", length: 64 }],
]);

export function createCycloneDxForBundle({ manifest, lock, metafiles, revision }) {
  requireString(manifest?.name, "Extension name");
  requireString(manifest?.publisher, "Extension publisher");
  requireString(manifest?.version, "Extension version");
  requireString(manifest?.license, "Extension license");
  if (!/^[0-9a-f]{40}$/u.test(revision)) {
    throw new Error("The source revision must be a full lowercase Git object ID.");
  }

  const records = bundledPackageRecords(metafiles, lock);
  if (records.length === 0) throw new Error("The release bundles contain no npm dependencies.");

  const componentsByReference = new Map();
  const referenceByPath = new Map();
  for (const record of records) {
    const reference = npmPackageUrl(record.name, record.version);
    referenceByPath.set(record.path, reference);
    if (!componentsByReference.has(reference)) {
      componentsByReference.set(reference, componentFor(record, reference));
    }
  }
  const components = [...componentsByReference.values()].sort((left, right) =>
    compareText(left["bom-ref"], right["bom-ref"]),
  );
  const rootReference = npmPackageUrl(manifest.name, manifest.version);
  const dependencyReferences = new Map(
    components.map((component) => [component["bom-ref"], new Set()]),
  );
  for (const record of records) {
    const sourceReference = referenceByPath.get(record.path);
    const targets = dependencyReferences.get(sourceReference);
    if (targets === undefined) continue;
    for (const dependencyName of Object.keys(record.metadata.dependencies ?? {})) {
      const dependencyPath = resolveBundledDependency(record.path, dependencyName, referenceByPath);
      if (dependencyPath !== undefined) {
        const dependencyReference = referenceByPath.get(dependencyPath);
        if (dependencyReference !== undefined) targets.add(dependencyReference);
      }
    }
  }

  const dependencies = [
    { ref: rootReference, dependsOn: components.map((component) => component["bom-ref"]) },
    ...[...dependencyReferences]
      .sort(([left], [right]) => compareText(left, right))
      .map(([ref, dependsOn]) => ({ ref, dependsOn: [...dependsOn].sort() })),
  ];
  const seed = `${manifest.publisher}.${manifest.name}@${manifest.version}:${revision}`;

  return {
    $schema: "http://cyclonedx.org/schema/bom-1.5.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: deterministicSerialNumber(seed),
    version: 1,
    metadata: {
      lifecycles: [{ phase: "build" }],
      component: rootComponent(manifest, revision, rootReference),
    },
    components,
    dependencies,
  };
}

function componentFor(record, reference) {
  const license = requireString(record.metadata.license, `License for ${record.name}`);
  const resolved = requireString(record.metadata.resolved, `Resolved URL for ${record.name}`);
  return {
    "bom-ref": reference,
    type: "library",
    name: record.name,
    version: record.version,
    scope: "required",
    hashes: integrityHashes(record.metadata.integrity, record.name),
    licenses: [cycloneDxLicense(license)],
    purl: reference,
    externalReferences: [{ type: "distribution", url: resolved }],
  };
}

function rootComponent(manifest, revision, reference) {
  const component = {
    "bom-ref": reference,
    type: "application",
    name: manifest.name,
    version: manifest.version,
    scope: "required",
    description: requireString(manifest.description, "Extension description"),
    licenses: [cycloneDxLicense(manifest.license)],
    purl: reference,
    properties: [{ name: "vscode-vhs:source-revision", value: revision }],
  };
  const author =
    typeof manifest.author === "string"
      ? manifest.author
      : typeof manifest.author?.name === "string"
        ? manifest.author.name
        : undefined;
  if (author !== undefined && author !== "") component.author = author;
  const externalReferences = manifestExternalReferences(manifest);
  if (externalReferences.length > 0) component.externalReferences = externalReferences;
  return component;
}

function manifestExternalReferences(manifest) {
  const repository =
    typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  const bugs = typeof manifest.bugs === "string" ? manifest.bugs : manifest.bugs?.url;
  return [
    ["vcs", repository],
    ["website", manifest.homepage],
    ["issue-tracker", bugs],
  ]
    .filter((entry) => typeof entry[1] === "string" && entry[1] !== "")
    .map(([type, url]) => ({ type, url }));
}

function resolveBundledDependency(packagePath, dependencyName, references) {
  let parent = packagePath;
  while (true) {
    const nested = `${parent}/node_modules/${dependencyName}`;
    if (references.has(nested)) return nested;
    const marker = parent.lastIndexOf("/node_modules/");
    if (marker === -1) break;
    parent = parent.slice(0, marker);
  }
  const root = `node_modules/${dependencyName}`;
  return references.has(root) ? root : undefined;
}

function npmPackageUrl(name, version) {
  if (name.startsWith("@")) {
    const separator = name.indexOf("/");
    if (separator <= 1 || separator === name.length - 1) {
      throw new Error(`Invalid scoped npm package name: ${name}`);
    }
    return `pkg:npm/%40${encodeURIComponent(name.slice(1, separator))}/${encodeURIComponent(name.slice(separator + 1))}@${encodeURIComponent(version)}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function integrityHashes(value, name) {
  const integrity = requireString(value, `Integrity for ${name}`);
  const hashes = [];
  for (const token of integrity.split(/\s+/u)) {
    const match = /^(sha(?:256|384|512))-([A-Za-z0-9+/]+={0,2})(?:\?.*)?$/u.exec(token);
    if (match === null) continue;
    const algorithm = algorithms.get(match[1]);
    const bytes = Buffer.from(match[2], "base64");
    if (algorithm === undefined || bytes.byteLength !== algorithm.length) continue;
    hashes.push({ alg: algorithm.cyclonedx, content: bytes.toString("hex") });
  }
  if (hashes.length === 0) throw new Error(`Integrity for ${name} has no supported digest.`);
  return hashes.sort((left, right) => compareText(left.alg, right.alg));
}

function cycloneDxLicense(value) {
  return /^[A-Za-z0-9.+-]+$/u.test(value) ? { license: { id: value } } : { expression: value };
}

function deterministicSerialNumber(seed) {
  const digest = createHash("sha256").update(seed).digest("hex");
  const uuid = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
  return `urn:uuid:${uuid}`;
}

function requireString(value, label) {
  if (typeof value !== "string" || value === "") throw new Error(`${label} is missing.`);
  return value;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
