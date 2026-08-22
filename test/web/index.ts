import * as vscode from "vscode";

const extensionId = "willibrandon.vhs-tape";

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension(extensionId);
  assert(extension !== undefined, `${extensionId} was not installed in the web extension host`);
  await extension.activate();
  assert(extension.isActive, "the web extension did not activate");
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert(folder !== undefined, "the virtual test workspace was not opened");
  assert(folder.uri.scheme !== "file", "the web test must use a virtual filesystem");
  const uri = vscode.Uri.joinPath(folder.uri, "demo.tape");
  const partsUri = vscode.Uri.joinPath(folder.uri, "parts.tape");
  const document = await vscode.workspace.openTextDocument(uri);
  assert(document.languageId === "vhs", "VHS did not receive its language id");
  await vscode.window.showTextDocument(document);

  const diagnostics = await waitForDiagnostics(uri, "invalid-command");
  assert(
    diagnostics.some(({ source }) => source === "VHS"),
    "the browser language server did not publish diagnostics",
  );
  const completion = await vscode.commands.executeCommand<vscode.CompletionList>(
    "vscode.executeCompletionItemProvider",
    uri,
    new vscode.Position(7, 2),
  );
  assert(
    completion.items.some(({ label }) => label === "Type"),
    "completion was unavailable in the browser worker",
  );
  const definitions = await waitFor(
    () =>
      vscode.commands.executeCommand<readonly vscode.Location[]>(
        "vscode.executeDefinitionProvider",
        uri,
        new vscode.Position(10, 10),
      ),
    (locations) => locations[0]?.uri.toString() === partsUri.toString(),
    "cross-file definition in the browser worker",
  );
  assert(definitions[0]?.uri.toString() === partsUri.toString(), "definition target was wrong");
  const commands = await vscode.commands.getCommands(true);
  assert(commands.includes("vhs.runTape"), "VHS commands were not registered");
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitForDiagnostics(
  uri: vscode.Uri,
  code: string,
): Promise<readonly vscode.Diagnostic[]> {
  return waitFor(
    () => vscode.languages.getDiagnostics(uri),
    (diagnostics) => diagnostics.some((diagnostic) => diagnosticCode(diagnostic) === code),
    `${code} diagnostics for ${uri.toString()}`,
  );
}

async function waitFor<T>(
  read: () => T | PromiseLike<T>,
  accept: (value: T) => boolean,
  description: string,
): Promise<T> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function diagnosticCode(diagnostic: vscode.Diagnostic): string | number | undefined {
  return typeof diagnostic.code === "object" ? diagnostic.code.value : diagnostic.code;
}
