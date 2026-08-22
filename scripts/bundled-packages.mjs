function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function bundledPackagePaths(metafiles) {
  if (!Array.isArray(metafiles) || metafiles.length === 0) {
    throw new Error("The esbuild metadata must be a non-empty array.");
  }

  const paths = new Set();
  for (const metafile of metafiles) {
    if (!isRecord(metafile) || !isRecord(metafile.inputs)) {
      throw new Error("An esbuild metafile has no input map.");
    }
    for (const input of Object.keys(metafile.inputs)) {
      const packagePath = packagePathFromInput(input);
      if (packagePath !== undefined) paths.add(packagePath);
    }
  }
  return [...paths].sort();
}

export function bundledPackageRecords(metafiles, lock) {
  if (!isRecord(lock) || !isRecord(lock.packages)) {
    throw new Error("The npm lockfile has no package map.");
  }

  return bundledPackagePaths(metafiles).map((path) => {
    const metadata = lock.packages[path];
    if (!isRecord(metadata) || typeof metadata.version !== "string" || metadata.version === "") {
      throw new Error(`Bundled dependency ${path} has no exact lockfile version.`);
    }
    return {
      metadata,
      name: packageNameFromPath(path),
      path,
      version: metadata.version,
    };
  });
}

function packagePathFromInput(input) {
  const segments = input.replaceAll("\\", "/").split("/");
  let firstNodeModules = -1;
  let packageEnd = -1;

  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index] !== "node_modules") continue;
    const firstName = segments[index + 1];
    if (firstName === undefined || firstName === "") {
      throw new Error(`Malformed node_modules input path: ${input}`);
    }
    const scoped = firstName.startsWith("@");
    const finalName = scoped ? segments[index + 2] : firstName;
    if (finalName === undefined || finalName === "" || finalName === "node_modules") {
      throw new Error(`Malformed node_modules input path: ${input}`);
    }
    if (firstNodeModules === -1) firstNodeModules = index;
    packageEnd = index + (scoped ? 3 : 2);
  }

  return firstNodeModules === -1
    ? undefined
    : segments.slice(firstNodeModules, packageEnd).join("/");
}

function packageNameFromPath(path) {
  const marker = "/node_modules/";
  const start = path.lastIndexOf(marker);
  const tail = path.slice(start === -1 ? "node_modules/".length : start + marker.length);
  const segments = tail.split("/");
  return segments[0]?.startsWith("@") ? `${segments[0]}/${segments[1]}` : segments[0];
}
