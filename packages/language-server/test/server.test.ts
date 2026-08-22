import { PassThrough } from "node:stream";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import type { MessageConnection } from "vscode-jsonrpc/node";
import { createConnection } from "vscode-languageserver/node";
import type {
  CodeAction,
  CodeLens,
  ColorInformation,
  ColorPresentation,
  CompletionItem,
  Connection,
  Diagnostic,
  DocumentLink,
  DocumentSymbol,
  FoldingRange,
  Hover,
  InitializeResult,
  Location,
  SemanticTokens,
  SignatureHelp,
  TextEdit,
  WorkspaceEdit,
} from "vscode-languageserver";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startLanguageServer } from "../src/server.js";

const uri = "file:///workspace/main.tape";
const source = `# Demo
Output 123.gif
Set MarginFill "#112233"
Set Width 1200  
Hide
Type "hello"
Show
Source parts/setup.tape
Screenshot shot.png
`;

describe("VHS language server JSON-RPC contract", () => {
  let client: MessageConnection;
  let clientInput: PassThrough;
  let server: Connection;
  let serverInput: PassThrough;

  beforeEach(async () => {
    clientInput = new PassThrough();
    serverInput = new PassThrough();
    server = createConnection(
      new StreamMessageReader(serverInput),
      new StreamMessageWriter(clientInput),
    );
    startLanguageServer(server);
    client = createMessageConnection(
      new StreamMessageReader(clientInput),
      new StreamMessageWriter(serverInput),
    );
    client.listen();
    const initialization = await client.sendRequest<InitializeResult>("initialize", {
      capabilities: {},
      clientInfo: { name: "contract test" },
      processId: null,
      rootUri: "file:///workspace",
    });
    expect(initialization.serverInfo).toEqual({ name: "VHS Language Server", version: "0.1.0" });
    expect(initialization.capabilities).toMatchObject({
      codeLensProvider: { resolveProvider: false },
      colorProvider: true,
      completionProvider: { resolveProvider: false },
      definitionProvider: true,
      documentFormattingProvider: true,
      hoverProvider: true,
      semanticTokensProvider: { full: true },
    });
    await client.sendNotification("initialized", {});
  });

  afterEach(async () => {
    await client.sendNotification("textDocument/didClose", { textDocument: { uri } });
    await client.sendRequest("shutdown");
    server.dispose();
    client.dispose();
    clientInput.destroy();
    serverInput.destroy();
  });

  it("serves editing, navigation, and structural features", async () => {
    await client.sendNotification("vhs/workspaceFiles", {
      files: [
        { text: source, uri },
        { text: 'Type "setup"', uri: "file:///workspace/parts/setup.tape" },
        { text: "Source parts/setup.tape", uri: "file:///workspace/other.tape" },
      ],
    });
    const diagnosticPromise = nextDiagnostics(client);
    await open(client, source);
    const diagnostics = await diagnosticPromise;
    expect(diagnostics.map(({ code }) => code)).toContain("quote-path");
    expect(diagnostics.map(({ code }) => code)).not.toContain("source-not-found");

    const completions = await request<CompletionItem[]>(client, "textDocument/completion", {
      textDocument: { uri },
      position: { line: 0, character: 0 },
    });
    expect(completions.find(({ label }) => label === "Wait")?.detail).toContain("Wait");

    const hover = await request<Hover | null>(client, "textDocument/hover", {
      textDocument: { uri },
      position: positionOf(source, "Type", 1),
    });
    expect(JSON.stringify(hover)).toContain("Types text into the terminal");

    const signature = await request<SignatureHelp | null>(client, "textDocument/signatureHelp", {
      textDocument: { uri },
      position: positionOf(source, "hello", 2),
    });
    expect(signature?.signatures[0]?.label).toContain("Type");

    const symbols = await request<DocumentSymbol[]>(client, "textDocument/documentSymbol", {
      textDocument: { uri },
    });
    expect(symbols.map(({ name }) => name)).toEqual([
      "Output",
      "Set",
      "Set",
      "Source",
      "Screenshot",
    ]);

    const links = await request<DocumentLink[]>(client, "textDocument/documentLink", {
      textDocument: { uri },
    });
    expect(links.map(({ target }) => target)).toContain("file:///workspace/parts/setup.tape");

    const definition = await request<Location | null>(client, "textDocument/definition", {
      textDocument: { uri },
      position: positionOf(source, "setup.tape", 2),
    });
    expect(definition?.uri).toBe("file:///workspace/parts/setup.tape");

    const references = await request<Location[]>(client, "textDocument/references", {
      context: { includeDeclaration: true },
      textDocument: { uri },
      position: positionOf(source, "setup.tape", 2),
    });
    expect(references.map(({ uri: referenceUri }) => referenceUri).sort()).toEqual([
      "file:///workspace/main.tape",
      "file:///workspace/other.tape",
    ]);

    const lenses = await request<CodeLens[]>(client, "textDocument/codeLens", {
      textDocument: { uri },
    });
    expect(lenses.map(({ command }) => command?.command)).toEqual([
      "vhs.runTape",
      "vhs.runAndPreview",
    ]);

    const tokens = await request<SemanticTokens>(client, "textDocument/semanticTokens/full", {
      textDocument: { uri },
    });
    expect(tokens.data.length).toBeGreaterThan(20);

    const folds = await request<FoldingRange[]>(client, "textDocument/foldingRange", {
      textDocument: { uri },
    });
    expect(folds).toMatchObject([{ startLine: 4, endLine: 6, kind: "region" }]);

    const colors = await request<ColorInformation[]>(client, "textDocument/documentColor", {
      textDocument: { uri },
    });
    expect(colors).toHaveLength(1);
    expect(colors[0]?.color.red).toBeCloseTo(17 / 255);
    const presentations = await request<ColorPresentation[]>(
      client,
      "textDocument/colorPresentation",
      {
        color: { red: 1, green: 0.5, blue: 0, alpha: 1 },
        range: colors[0]?.range,
        textDocument: { uri },
      },
    );
    expect(presentations[0]?.label).toBe('"#ff8000"');

    const formatting = await request<TextEdit[]>(client, "textDocument/formatting", {
      options: { insertSpaces: true, tabSize: 2 },
      textDocument: { uri },
    });
    expect(formatting).toHaveLength(1);
    expect(formatting[0]?.newText).toContain("Set Width 1200\n");
  });

  it("returns safe quick fixes and honors validation, version, and CodeLens settings", async () => {
    const initialDiagnostics = nextDiagnostics(client);
    await open(client, source);
    const initial = await initialDiagnostics;
    const pathProblem = initial.find(({ code }) => code === "quote-path");
    expect(pathProblem?.data).toEqual({ replacement: '"123.gif"' });
    const actions = await request<CodeAction[]>(client, "textDocument/codeAction", {
      context: { diagnostics: pathProblem === undefined ? [] : [pathProblem] },
      range: pathProblem?.range,
      textDocument: { uri },
    });
    expect(actions).toMatchObject([
      {
        edit: { changes: { [uri]: [{ newText: '"123.gif"' }] } },
        isPreferred: true,
        title: "Apply VHS fix",
      },
    ]);

    const afterChange = nextDiagnostics(client);
    await change(client, "ScrollUp 2\n", 2);
    await afterChange;
    const changedDiagnostics = nextDiagnostics(client);
    await client.sendNotification("workspace/didChangeConfiguration", {
      settings: {
        vhs: {
          codeLens: { enabled: false },
          targetVersion: "0.10.0",
          validation: { enable: true, maxProblems: 10 },
        },
      },
    });
    expect((await changedDiagnostics).map(({ code }) => code)).toContain("unsupported-version");
    expect(
      await request<CodeLens[]>(client, "textDocument/codeLens", { textDocument: { uri } }),
    ).toEqual([]);

    const detectedDiagnostics = nextDiagnostics(client);
    await client.sendNotification("vhs/detectedVersion", { version: "0.11.0" });
    await detectedDiagnostics;
    const disabledDiagnostics = nextDiagnostics(client);
    await client.sendNotification("workspace/didChangeConfiguration", {
      settings: {
        vhs: {
          codeLens: { enabled: true },
          targetVersion: "auto",
          validation: { enable: false, maxProblems: 10 },
        },
      },
    });
    expect(await disabledDiagnostics).toEqual([]);
  });

  it("updates Source paths when referenced files are renamed", async () => {
    await client.sendNotification("vhs/workspaceFiles", {
      files: [
        { text: source, uri },
        { text: 'Type "setup"', uri: "file:///workspace/parts/setup.tape" },
      ],
    });
    await open(client, source);
    const edit = await request<WorkspaceEdit | null>(client, "workspace/willRenameFiles", {
      files: [
        {
          oldUri: "file:///workspace/parts/setup.tape",
          newUri: "file:///workspace/shared/start.tape",
        },
      ],
    });
    expect(edit?.changes?.[uri]).toMatchObject([{ newText: "shared/start.tape" }]);
  });
});

async function open(client: MessageConnection, text: string): Promise<void> {
  await client.sendNotification("textDocument/didOpen", {
    textDocument: { languageId: "vhs", text, uri, version: 1 },
  });
}

async function change(client: MessageConnection, text: string, version: number): Promise<void> {
  await client.sendNotification("textDocument/didChange", {
    contentChanges: [{ text }],
    textDocument: { uri, version },
  });
}

const request = async <T = unknown>(
  client: MessageConnection,
  method: string,
  params: unknown,
): Promise<T> => client.sendRequest<T>(method, params);

function nextDiagnostics(client: MessageConnection): Promise<readonly Diagnostic[]> {
  return new Promise((resolve) => {
    const disposable = client.onNotification(
      "textDocument/publishDiagnostics",
      (params: { readonly diagnostics: readonly Diagnostic[]; readonly uri: string }) => {
        if (params.uri !== uri) return;
        disposable.dispose();
        resolve(params.diagnostics);
      },
    );
  });
}

function positionOf(
  text: string,
  needle: string,
  relative = 0,
): { readonly line: number; readonly character: number } {
  const offset = text.indexOf(needle) + relative;
  const before = text.slice(0, offset).split("\n");
  return { line: before.length - 1, character: before.at(-1)?.length ?? 0 };
}
