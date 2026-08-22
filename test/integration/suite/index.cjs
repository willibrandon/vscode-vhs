const assert = require("node:assert/strict");
const { TextDecoder } = require("node:util");
const vscode = require("vscode");

const extensionId = "willibrandon.vhs";

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
