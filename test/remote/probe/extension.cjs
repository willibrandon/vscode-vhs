const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const vscode = require("vscode");

const execute = promisify(execFile);
const resultName = ".remote-smoke-result.json";

exports.activate = async function activate() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) return;
  const resultUri = vscode.Uri.joinPath(folder.uri, resultName);
  let result;
  try {
    assert.equal(vscode.env.remoteName, "ssh-remote");
    assert.equal(folder.uri.scheme, "file");

    const extension = vscode.extensions.getExtension("willibrandon.vhs");
    assert.ok(extension, "willibrandon.vhs is not installed in the remote extension host");
    const extensionVersion = extension.packageJSON.version;
    assert.equal(typeof extensionVersion, "string");
    assert.equal(
      extension.extensionPath,
      `/home/vscode/.vscode-server/extensions/willibrandon.vhs-${extensionVersion}`,
    );

    const vhsUri = vscode.Uri.joinPath(folder.uri, "demo.tape");
    const referencedUri = vscode.Uri.joinPath(folder.uri, "parts.tape");
    const document = await vscode.workspace.openTextDocument(vhsUri);
    await vscode.window.showTextDocument(document);
    await extension.activate();
    assert.equal(extension.isActive, true);
    assert.equal(document.languageId, "vhs");

    const diagnostics = await waitForDiagnostics(
      vhsUri,
      (items) => items.some((diagnostic) => diagnosticCode(diagnostic) === "invalid-command"),
      "the invalid-command diagnostic",
    );
    const completion = await vscode.commands.executeCommand(
      "vscode.executeCompletionItemProvider",
      vhsUri,
      new vscode.Position(7, 2),
    );
    assert.ok(completion.items.some(({ label }) => label === "Type"));
    const definitions = await waitFor(
      () =>
        vscode.commands.executeCommand(
          "vscode.executeDefinitionProvider",
          vhsUri,
          new vscode.Position(10, 10),
        ),
      (locations) => locations[0]?.uri.toString() === referencedUri.toString(),
      "the cross-file definition",
    );
    assert.equal(definitions[0]?.uri.toString(), referencedUri.toString());

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("vhs.runTape"));
    assert.ok(commands.includes("vhs.validateWithInstalledVhs"));

    const { stdout: processes } = await execute("ps", ["-eo", "args="], {
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
    });
    const languageServerProcess = processes
      .split(/\r?\n/u)
      .find((line) => line.includes(`${extension.extensionPath}/dist/nodeServer.cjs`));
    assert.ok(languageServerProcess, "the VHS language server is not running remotely");

    result = {
      ok: true,
      remoteName: vscode.env.remoteName,
      workspaceScheme: folder.uri.scheme,
      extensionPath: extension.extensionPath,
      extensionVersion,
      extensionHostExecutable: process.execPath,
      languageServerProcess: languageServerProcess.trim(),
      diagnosticCodes: diagnostics.map(diagnosticCode).map(String).sort(),
      completionLabels: completion.items.map(({ label }) => String(label)).sort(),
      definitionUri: definitions[0]?.uri.toString(),
      commands: commands.filter((command) => command.startsWith("vhs.")).sort(),
    };
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
  }

  await vscode.workspace.fs.writeFile(
    resultUri,
    Buffer.from(`${JSON.stringify(result, null, 2)}\n`),
  );
};

function diagnosticCode(diagnostic) {
  return typeof diagnostic.code === "object" ? diagnostic.code.value : diagnostic.code;
}

async function waitForDiagnostics(uri, predicate, description) {
  return waitFor(() => vscode.languages.getDiagnostics(uri), predicate, description);
}

async function waitFor(read, predicate, description) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}
