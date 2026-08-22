import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "..");

export function marketplaceIdentityFailures(entries, expected) {
  if (!Array.isArray(entries)) return ["Marketplace search returned an unexpected response."];

  const exact = entries.filter(
    (entry) => typeof entry === "object" && entry !== null && entry.extensionName === expected.name,
  );
  const owners = exact.map((entry) => entry.publisher?.publisherName);
  const invalidOwner = owners.some((owner) => typeof owner !== "string" || owner === "");
  if (invalidOwner) return [`Marketplace package ${expected.name} has an unknown owner.`];

  const conflicts = [...new Set(owners.filter((owner) => owner !== expected.publisher))].sort();
  return conflicts.map(
    (owner) =>
      `Marketplace package ${expected.name} is already owned by ${owner}, not ${expected.publisher}.`,
  );
}

export function openVsxIdentityFailures(metadata, expected) {
  if (metadata === undefined) return [];
  if (typeof metadata !== "object" || metadata === null) {
    return ["Open VSX returned an unexpected response."];
  }
  if (metadata.namespace !== expected.publisher || metadata.name !== expected.name) {
    return [`Open VSX returned the wrong package for ${expected.publisher}.${expected.name}.`];
  }
  return [];
}

async function searchMarketplace(name) {
  const vsce = resolve(root, "node_modules/@vscode/vsce/vsce");
  const { stdout } = await execute(process.execPath, [vsce, "search", name, "--json"], {
    cwd: root,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 60_000,
  });
  const response = stdout.trim();
  if (response === "No matching results") return [];
  return JSON.parse(response);
}

async function queryOpenVsx(expected) {
  const url = new URL(
    `/api/${encodeURIComponent(expected.publisher)}/${encodeURIComponent(expected.name)}`,
    "https://open-vsx.org",
  );
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status === 404) return undefined;
  if (!response.ok)
    throw new Error(`Open VSX identity request failed with HTTP ${response.status}.`);
  return response.json();
}

async function checkRegistryIdentity() {
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const expected = { name: manifest.name, publisher: manifest.publisher };
  const [marketplace, openVsx] = await Promise.all([
    searchMarketplace(expected.name),
    queryOpenVsx(expected),
  ]);
  const failures = [
    ...marketplaceIdentityFailures(marketplace, expected),
    ...openVsxIdentityFailures(openVsx, expected),
  ];
  if (failures.length > 0) {
    throw new Error(`Registry identity check failed:\n- ${failures.join("\n- ")}`);
  }
  console.log(`Registry identity is available to ${expected.publisher}.${expected.name}.`);
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await checkRegistryIdentity();
}
