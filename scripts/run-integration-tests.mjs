import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { runTests } from "@vscode/test-electron";
import { createIsolatedVSCodeEnvironment } from "./vscode-test-environment.mjs";

const root = resolve(import.meta.dirname, "..");
const installedExtensions = process.env.VHS_VSIX_EXTENSIONS_DIR;
const installedUserData = process.env.VHS_VSIX_USER_DATA_DIR;
const installedSmoke = installedExtensions !== undefined && installedUserData !== undefined;

if (process.platform === "linux" && process.env.VHS_TEST_XVFB !== "1") {
  const child = spawnSync(
    "xvfb-run",
    ["-a", process.execPath, resolve(import.meta.dirname, "run-integration-tests.mjs")],
    {
      cwd: root,
      env: { ...createIsolatedVSCodeEnvironment(), VHS_TEST_XVFB: "1" },
      stdio: "inherit",
    },
  );
  process.exit(child.status ?? 1);
}

const temporaryUserData = installedSmoke
  ? undefined
  : await mkdtemp(resolve(tmpdir(), "vscode-vhs-integration-"));
const temporaryWorkspaceRoot = await mkdtemp(resolve(tmpdir(), "vscode-vhs-workspace-"));
const temporaryWorkspace = resolve(temporaryWorkspaceRoot, "fixtures");
await cp(resolve(root, "test/integration/fixtures"), temporaryWorkspace, { recursive: true });
const userData = installedUserData ?? temporaryUserData;
if (userData === undefined) throw new Error("Unable to create an integration-test profile.");

try {
  await runTests({
    version: process.env.VSCODE_VERSION ?? "1.102.0",
    extensionDevelopmentPath: installedSmoke ? resolve(root, "test/package/host") : root,
    extensionTestsPath: resolve(root, "test/integration/suite/index.cjs"),
    launchArgs: [
      temporaryWorkspace,
      ...(installedSmoke ? [] : ["--disable-extensions"]),
      "--disable-workspace-trust",
      "--skip-release-notes",
      "--skip-welcome",
      "--user-data-dir=" + userData,
      ...(installedExtensions === undefined ? [] : ["--extensions-dir=" + installedExtensions]),
    ],
    extensionTestsEnv: {
      ...createIsolatedVSCodeEnvironment(),
      VHS_TEST_NODE_PATH: process.execPath,
    },
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (temporaryUserData !== undefined) {
    await rm(temporaryUserData, { recursive: true, force: true });
  }
  await rm(temporaryWorkspaceRoot, { recursive: true, force: true });
}
