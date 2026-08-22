import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { createVSIX } from "@vscode/vsce";
import { canonicalizeVsix } from "./canonicalize-vsix.mjs";
import { createCycloneDxForBundle } from "./release-sbom.mjs";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const base = `vhs-${manifest.version}`;
const vsix = resolve(root, `dist/${base}.vsix`);
const sbom = resolve(root, `dist/${base}.cdx.json`);
const checksum = resolve(root, `dist/${base}.sha256`);
if (!/^\d+\.\d+\.\d+$/u.test(manifest.version)) {
  throw new Error(`Extension version must be major.minor.patch, received ${manifest.version}.`);
}
const { stdout: revisionOutput } = await execute("git", ["rev-parse", "HEAD"], { cwd: root });
const revision = revisionOutput.trim();
if (!/^[0-9a-f]{40}$/u.test(revision)) throw new Error("Unable to determine the source revision.");
await Promise.all([
  rm(vsix, { force: true }),
  rm(sbom, { force: true }),
  rm(checksum, { force: true }),
]);
await createVSIX({
  cwd: root,
  packagePath: vsix,
  dependencies: false,
  githubBranch: revision,
  preRelease: false,
});
await writeFile(vsix, canonicalizeVsix(await readFile(vsix)));
const [lock, metafiles] = await Promise.all([
  readFile(resolve(root, "package-lock.json"), "utf8").then(JSON.parse),
  readFile(resolve(root, "dist/metafile.json"), "utf8").then(JSON.parse),
]);
const prepared = createCycloneDxForBundle({ manifest, lock, metafiles, revision });
await writeFile(sbom, `${JSON.stringify(prepared, null, 2)}\n`, "utf8");
const digest = createHash("sha256")
  .update(await readFile(vsix))
  .digest("hex");
await writeFile(checksum, `${digest}  ${basename(vsix)}\n`, "utf8");
const sbomText = await readFile(sbom, "utf8");
if (/(?:\/home\/[^/\s]+|\/Users\/[^/\s]+|[A-Za-z]:\\\\Users\\\\[^\\\s]+)/u.test(sbomText)) {
  throw new Error("The generated SBOM contains a private build path.");
}
console.log(`Created ${basename(vsix)}, ${basename(checksum)}, and ${basename(sbom)} (stable).`);
