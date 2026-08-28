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
  const ignoreUri = vscode.Uri.joinPath(root, ".gitignore");
  const ignoredDirectory = vscode.Uri.joinPath(root, "artifacts");
  const ignoredUri = vscode.Uri.joinPath(ignoredDirectory, "ignored.tape");
  await vscode.workspace.fs.createDirectory(ignoredDirectory);
  await vscode.workspace.fs.writeFile(ignoreUri, new TextEncoder().encode("artifacts/\n"));
  await vscode.workspace.fs.writeFile(
    ignoredUri,
    new TextEncoder().encode('Source parts.tape\nType "ignored"\n'),
  );
  const vscodeExcludedDirectory = vscode.Uri.joinPath(root, "excluded-by-vscode");
  const vscodeExcludedUri = vscode.Uri.joinPath(vscodeExcludedDirectory, "excluded.tape");
  await vscode.workspace.fs.createDirectory(vscodeExcludedDirectory);
  await vscode.workspace.fs.writeFile(
    vscodeExcludedUri,
    new TextEncoder().encode('Source parts.tape\nType "excluded"\n'),
  );
  const filesConfiguration = vscode.workspace.getConfiguration("files", vscodeExcludedUri);
  await filesConfiguration.update(
    "exclude",
    { "**/excluded-by-vscode": true },
    vscode.ConfigurationTarget.Workspace,
  );
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

  const readPartReferences = () =>
    vscode.commands.executeCommand(
      "vscode.executeReferenceProvider",
      uri,
      new vscode.Position(10, 10),
    );
  await waitFor(
    readPartReferences,
    (locations) => locations.some((location) => location.uri.toString() === uri.toString()),
    "initial VHS workspace index",
  );
  let partReferences = await readPartReferences();
  assert.equal(
    partReferences.some((location) => location.uri.toString() === ignoredUri.toString()),
    false,
    "Git-ignored tapes must stay out of ambient workspace indexing.",
  );
  assert.equal(
    partReferences.some((location) => location.uri.toString() === vscodeExcludedUri.toString()),
    false,
    "files.exclude entries must stay out of ambient workspace indexing.",
  );

  await vscode.workspace.fs.writeFile(ignoreUri, new TextEncoder().encode(""));
  await waitFor(
    readPartReferences,
    (locations) => locations.some((location) => location.uri.toString() === ignoredUri.toString()),
    "tape to enter the index after .gitignore changes",
  );
  await vscode.workspace.fs.writeFile(ignoreUri, new TextEncoder().encode("artifacts/\n"));
  await waitFor(
    readPartReferences,
    (locations) => locations.every((location) => location.uri.toString() !== ignoredUri.toString()),
    "tape to leave the index after .gitignore changes",
  );

  const indexConfiguration = vscode.workspace.getConfiguration("vhs", ignoredUri);
  await indexConfiguration.update(
    "index.useIgnoreFiles",
    false,
    vscode.ConfigurationTarget.WorkspaceFolder,
  );
  await waitFor(
    readPartReferences,
    (locations) => locations.some((location) => location.uri.toString() === ignoredUri.toString()),
    "ignored tape to enter the index when Git ignore filtering is disabled",
  );
  await indexConfiguration.update(
    "index.useIgnoreFiles",
    true,
    vscode.ConfigurationTarget.WorkspaceFolder,
  );
  await waitFor(
    readPartReferences,
    (locations) => locations.every((location) => location.uri.toString() !== ignoredUri.toString()),
    "ignored tape to leave the index when Git ignore filtering is restored",
  );

  await filesConfiguration.update(
    "exclude",
    { "**/excluded-by-vscode": false },
    vscode.ConfigurationTarget.Workspace,
  );
  await waitFor(
    readPartReferences,
    (locations) =>
      locations.some((location) => location.uri.toString() === vscodeExcludedUri.toString()),
    "tape to enter the index after files.exclude changes",
  );
  await filesConfiguration.update(
    "exclude",
    { "**/excluded-by-vscode": true },
    vscode.ConfigurationTarget.Workspace,
  );
  await waitFor(
    readPartReferences,
    (locations) =>
      locations.every((location) => location.uri.toString() !== vscodeExcludedUri.toString()),
    "tape to leave the index after files.exclude changes",
  );

  const explicitUri = vscode.Uri.joinPath(root, "explicit-source.tape");
  await vscode.workspace.fs.writeFile(
    explicitUri,
    new TextEncoder().encode("Source artifacts/ignored.tape\n"),
  );
  const explicitDocument = await vscode.workspace.openTextDocument(explicitUri);
  await vscode.window.showTextDocument(explicitDocument);
  const ignoredDefinition = await waitFor(
    () =>
      vscode.commands.executeCommand(
        "vscode.executeDefinitionProvider",
        explicitUri,
        new vscode.Position(0, 17),
      ),
    (locations) => locations[0]?.uri.toString() === ignoredUri.toString(),
    "explicit Source to retain its Git-ignored target",
  );
  assert.equal(ignoredDefinition[0]?.uri.toString(), ignoredUri.toString());
  await waitFor(
    readPartReferences,
    (locations) => locations.some((location) => location.uri.toString() === ignoredUri.toString()),
    "explicitly sourced ignored tape to participate in language features",
  );

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
