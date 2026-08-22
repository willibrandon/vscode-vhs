import { spawn } from "node:child_process";
import { runVSCodeCommand } from "@vscode/test-electron";
import { resolve } from "node:path";
import { createIsolatedVSCodeEnvironment } from "./vscode-test-environment.mjs";

export async function runInstalledDesktopSmoke(options) {
  const { expectedIdentity, extensionsDirectory, installTarget, root, userDataDirectory, version } =
    options;
  const commandEnvironment = createIsolatedVSCodeEnvironment();
  const profileArguments = [
    `--extensions-dir=${extensionsDirectory}`,
    `--user-data-dir=${userDataDirectory}`,
  ];
  const installation = await runVSCodeCommand(
    ["--install-extension", installTarget, "--force", ...profileArguments],
    { spawn: { env: commandEnvironment }, version },
  );
  process.stdout.write(installation.stdout);
  process.stderr.write(installation.stderr);

  const listing = await runVSCodeCommand(
    ["--list-extensions", "--show-versions", ...profileArguments],
    { spawn: { env: commandEnvironment }, version },
  );
  const installed = listing.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  if (!installed.includes(expectedIdentity.toLowerCase())) {
    throw new Error(
      `Clean profile contains ${JSON.stringify(installed)}, expected ${expectedIdentity}.`,
    );
  }

  const exitCode = await run(
    process.execPath,
    [resolve(root, "scripts/run-integration-tests.mjs")],
    {
      ...commandEnvironment,
      VHS_EXPECTED_INSTALLED_EXTENSION_PATH_PREFIX: extensionsDirectory,
      VHS_EXPECTED_INSTALLED_EXTENSION_VERSION: expectedIdentity.slice(
        expectedIdentity.lastIndexOf("@") + 1,
      ),
      VHS_VSIX_EXTENSIONS_DIR: extensionsDirectory,
      VHS_VSIX_USER_DATA_DIR: userDataDirectory,
      VSCODE_VERSION: version,
    },
  );
  if (exitCode !== 0)
    throw new Error(`Installed-extension smoke test exited with code ${exitCode}.`);

  const extensionIdentifier = expectedIdentity.slice(0, expectedIdentity.lastIndexOf("@"));
  const removal = await runVSCodeCommand(
    ["--uninstall-extension", extensionIdentifier, ...profileArguments],
    { spawn: { env: commandEnvironment }, version },
  );
  process.stdout.write(removal.stdout);
  process.stderr.write(removal.stderr);
  const afterRemoval = await runVSCodeCommand(
    ["--list-extensions", "--show-versions", ...profileArguments],
    { spawn: { env: commandEnvironment }, version },
  );
  const remaining = afterRemoval.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  if (remaining.some((entry) => entry.startsWith(`${extensionIdentifier.toLowerCase()}@`))) {
    throw new Error(`Clean uninstall left ${extensionIdentifier} registered in the test profile.`);
  }
}

function run(command, arguments_, environment) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, {
      cwd: process.cwd(),
      env: environment,
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      if (signal !== null) rejectPromise(new Error(`${command} stopped with ${signal}.`));
      else resolvePromise(code ?? 1);
    });
  });
}
