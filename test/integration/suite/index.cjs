const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { TextDecoder } = require("node:util");
const vscode = require("vscode");

const extensionId = "willibrandon.vhs-tape";

exports.run = async function run() {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  assert.ok(root, "The fixture workspace must be open.");
  const extension = vscode.extensions.getExtension(extensionId);
  assert.ok(extension, extensionId + " must be installed.");
  const uri = vscode.Uri.joinPath(root, "demo.tape");
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  assert.equal(document.languageId, "vhs");
  await extension.activate();
  assert.equal(extension.isActive, true);

  const installedPathPrefix = process.env.VHS_EXPECTED_INSTALLED_EXTENSION_PATH_PREFIX;
  if (installedPathPrefix !== undefined) {
    assert.equal(
      extension.packageJSON.version,
      process.env.VHS_EXPECTED_INSTALLED_EXTENSION_VERSION,
    );
    assert.ok(extension.extensionPath.startsWith(installedPathPrefix));
  }

  const completion = await vscode.commands.executeCommand(
    "vscode.executeCompletionItemProvider",
    uri,
    new vscode.Position(7, 2),
  );
  assert.ok(completion.items.some((item) => item.label === "Type"));

  const diagnostics = await waitFor(
    () => vscode.languages.getDiagnostics(uri),
    (items) => items.some((item) => diagnosticCode(item) === "invalid-command"),
    "invalid command diagnostic",
  );
  assert.ok(diagnostics.some((item) => item.source === "VHS"));

  const hovers = await vscode.commands.executeCommand(
    "vscode.executeHoverProvider",
    uri,
    new vscode.Position(7, 1),
  );
  const hoverText = hovers
    .flatMap(({ contents }) => contents)
    .map((content) => (typeof content === "string" ? content : content.value))
    .join("\n");
  assert.match(hoverText, /Types text into the terminal/u);

  const definition = await waitFor(
    () =>
      vscode.commands.executeCommand(
        "vscode.executeDefinitionProvider",
        uri,
        new vscode.Position(10, 10),
      ),
    (locations) =>
      locations[0]?.uri.toString() === vscode.Uri.joinPath(root, "parts.tape").toString(),
    "source definition",
  );
  assert.equal(definition.length, 1);

  const symbols = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", uri);
  assert.ok(symbols.some((symbol) => symbol.name === "Output"));
  assert.ok(symbols.some((symbol) => symbol.name === "Source"));

  const unformattedUri = vscode.Uri.joinPath(root, "unformatted.tape");
  await vscode.workspace.fs.writeFile(
    unformattedUri,
    new TextEncoder().encode('Set Width 800  \nType "hello"\t\n'),
  );
  const unformatted = await vscode.workspace.openTextDocument(unformattedUri);
  assert.equal(unformatted.languageId, "vhs");
  await vscode.window.showTextDocument(unformatted);
  const edits = await waitFor(
    () =>
      vscode.commands.executeCommand("vscode.executeFormatDocumentProvider", unformattedUri, {
        insertSpaces: true,
        tabSize: 2,
      }),
    (items) => Array.isArray(items),
    "formatting edits",
  );
  assert.equal(applyEdits(unformatted, edits), 'Set Width 800\nType "hello"\n');
  assert.equal(
    new TextDecoder().decode(await vscode.workspace.fs.readFile(unformattedUri)),
    'Set Width 800  \nType "hello"\t\n',
    "formatting must return edits without changing the file on disk",
  );

  const tapeDirectory = vscode.Uri.joinPath(root, "vhs");
  await vscode.workspace.fs.createDirectory(tapeDirectory);
  const setupUri = vscode.Uri.joinPath(tapeDirectory, "setup.tape");
  await vscode.workspace.fs.writeFile(setupUri, new TextEncoder().encode('Type "setup"\n'));
  const runtimeUri = vscode.Uri.joinPath(tapeDirectory, "runtime.tape");
  await vscode.workspace.fs.writeFile(
    runtimeUri,
    new TextEncoder().encode("Source vhs/setup.tape\nSleep 0\n"),
  );
  const runtime = await vscode.workspace.openTextDocument(runtimeUri);
  await vscode.window.showTextDocument(runtime);
  await waitFor(
    () =>
      vscode.commands.executeCommand(
        "vscode.executeDefinitionProvider",
        runtimeUri,
        new vscode.Position(0, 12),
      ),
    (locations) => locations[0]?.uri.toString() === setupUri.toString(),
    "workspace-root Source resolution",
  );
  const runtimeDiagnostics = vscode.languages.getDiagnostics(runtimeUri);
  assert.ok(!runtimeDiagnostics.some((item) => item.severity === vscode.DiagnosticSeverity.Error));

  const fakeVhs = await createFakeVhs(root.fsPath);
  const previousNodeOptions = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = [previousNodeOptions, `--require=${fakeVhs.hook}`]
    .filter(Boolean)
    .join(" ");
  const configuration = vscode.workspace.getConfiguration("vhs", runtimeUri);
  await configuration.update(
    "executablePath",
    fakeVhs.command,
    vscode.ConfigurationTarget.WorkspaceFolder,
  );
  try {
    await vscode.commands.executeCommand("vhs.runTape");
    const runCwd = await waitFor(
      () => readOptional(vscode.Uri.joinPath(root, "run-cwd.txt")),
      (value) => value.length > 0,
      "run working directory",
    );
    assert.equal(await fs.realpath(runCwd), await fs.realpath(root.fsPath));

    await vscode.commands.executeCommand("vhs.validateWithInstalledVhs");
    const validateCwd = await waitFor(
      () => readOptional(vscode.Uri.joinPath(root, "validate-cwd.txt")),
      (value) => value.length > 0,
      "validation working directory",
    );
    assert.equal(await fs.realpath(validateCwd), await fs.realpath(root.fsPath));
  } finally {
    if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousNodeOptions;
    await configuration.update(
      "executablePath",
      undefined,
      vscode.ConfigurationTarget.WorkspaceFolder,
    );
  }

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "vhs.runTape",
    "vhs.runAndPreview",
    "vhs.openPreview",
    "vhs.stopTape",
    "vhs.validateWithInstalledVhs",
    "vhs.restartLanguageServer",
    "vhs.openDocumentation",
    "vhs.showLanguageServerOutput",
    "vhs.showRunOutput",
  ]) {
    assert.ok(commands.includes(command), command + " must be registered.");
  }

  await vscode.commands.executeCommand("vhs.restartLanguageServer");
  const restarted = await vscode.commands.executeCommand(
    "vscode.executeCompletionItemProvider",
    uri,
    new vscode.Position(7, 2),
  );
  assert.ok(restarted.items.some((item) => item.label === "Type"));
};

async function createFakeVhs(root) {
  const hook = path.join(root, "fake-vhs-hook.cjs");
  const source = `
const fs = require("node:fs");
const path = require("node:path");
const command = process.argv[1] === "-" ? "-" : path.basename(process.argv[1] ?? "");
if (command === "-" || command === "validate") {
  const name = command === "validate" ? "validate-cwd.txt" : "run-cwd.txt";
  fs.writeFileSync(name, process.cwd());
  process.exit(0);
}
`;
  await fs.writeFile(hook, source, "utf8");
  const command = process.env.VHS_TEST_NODE_PATH;
  assert.ok(command, "The test Node executable must be provided.");
  return { command, hook };
}

async function readOptional(uri) {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return "";
  }
}

function applyEdits(document, edits) {
  return [...edits]
    .sort(
      (left, right) => document.offsetAt(right.range.start) - document.offsetAt(left.range.start),
    )
    .reduce((text, edit) => {
      const start = document.offsetAt(edit.range.start);
      const end = document.offsetAt(edit.range.end);
      return text.slice(0, start) + edit.newText + text.slice(end);
    }, document.getText());
}

function diagnosticCode(diagnostic) {
  return typeof diagnostic.code === "object" ? diagnostic.code.value : diagnostic.code;
}

async function waitFor(read, accept, description) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (await accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("Timed out waiting for " + description + ".");
}
