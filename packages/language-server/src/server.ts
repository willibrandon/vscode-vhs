import {
  COMMAND_BY_NAME,
  completionsAt,
  documentSymbols,
  formatVhs,
  hoverAt,
  parseVhs,
  versionDiagnostics,
} from "@vhs/language-core";
import type { Diagnostic as CoreDiagnostic, Token, VhsDocument } from "@vhs/language-core";
import {
  CodeActionKind,
  Color,
  CompletionItemKind,
  DiagnosticSeverity,
  FoldingRangeKind,
  MarkupKind,
  SemanticTokensBuilder,
  SymbolKind,
  TextDocumentSyncKind,
  TextDocuments,
} from "vscode-languageserver";
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
  InitializeParams,
  InitializeResult,
  Location,
  Range,
  SemanticTokens,
  SignatureHelp,
  TextEdit,
  WorkspaceEdit,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  WorkspaceIndex,
  relativeSourcePath,
  sourceCycle,
  sourceOccurrences,
  sourceTarget,
} from "./workspace-index.js";

const tokenTypes = [
  "keyword",
  "string",
  "number",
  "comment",
  "regexp",
  "property",
  "enumMember",
] as const;
const tokenModifiers: readonly string[] = [];

interface ServerSettings {
  readonly codeLens: Readonly<{ readonly enabled: boolean }>;
  readonly targetVersion: string;
  readonly validation: Readonly<{ readonly enable: boolean; readonly maxProblems: number }>;
}

const defaultSettings: ServerSettings = {
  codeLens: { enabled: true },
  targetVersion: "latest",
  validation: { enable: true, maxProblems: 200 },
};

export function startLanguageServer(connection: Connection): void {
  const documents = new TextDocuments(TextDocument);
  const workspaceIndex = new WorkspaceIndex();
  const settingsCache = new Map<string, Promise<ServerSettings>>();
  let fallbackSettings = defaultSettings;
  let supportsConfiguration = false;
  let detectedVersion: string | undefined;

  const settingsFor = (uri: string): Promise<ServerSettings> => {
    if (!supportsConfiguration) return Promise.resolve(fallbackSettings);
    const cached = settingsCache.get(uri);
    if (cached !== undefined) return cached;
    const request = connection.workspace
      .getConfiguration({ scopeUri: uri, section: "vhs" })
      .then(normalizeSettings, (): ServerSettings => defaultSettings);
    settingsCache.set(uri, request);
    return request;
  };

  const publish = async (document: TextDocument): Promise<void> => {
    const settings = await settingsFor(document.uri);
    if (documents.get(document.uri)?.version !== document.version) return;
    const tree = parseVhs(document.getText());
    const allFiles = workspaceIndex.merged(documents.all());
    const targetVersion =
      settings.targetVersion === "auto" ? (detectedVersion ?? "latest") : settings.targetVersion;
    const diagnostics = settings.validation.enable
      ? [
          ...tree.diagnostics.map((item) => toDiagnostic(document, item)),
          ...versionDiagnostics(tree, targetVersion).map((item) => toDiagnostic(document, item)),
          ...sourceDiagnostics(document, tree, allFiles),
        ].slice(0, settings.validation.maxProblems)
      : [];
    void connection.sendDiagnostics({ diagnostics, uri: document.uri, version: document.version });
  };

  connection.onInitialize((params: InitializeParams): InitializeResult => {
    supportsConfiguration = params.capabilities.workspace?.configuration === true;
    return {
      capabilities: {
        codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
        codeLensProvider: { resolveProvider: false },
        colorProvider: true,
        completionProvider: { resolveProvider: false, triggerCharacters: [" ", "+", "@", "/"] },
        definitionProvider: true,
        documentFormattingProvider: true,
        documentLinkProvider: { resolveProvider: false },
        documentSymbolProvider: true,
        foldingRangeProvider: true,
        hoverProvider: true,
        referencesProvider: true,
        semanticTokensProvider: {
          full: true,
          legend: { tokenModifiers: [...tokenModifiers], tokenTypes: [...tokenTypes] },
        },
        signatureHelpProvider: { triggerCharacters: [" ", "+", "@"] },
        textDocumentSync: TextDocumentSyncKind.Incremental,
        workspace: {
          fileOperations: {
            willRename: { filters: [{ pattern: { glob: "**/*.tape", matches: "file" } }] },
          },
        },
      },
      serverInfo: { name: "VHS Language Server", version: "0.1.0" },
    };
  });

  connection.onDidChangeConfiguration((event): void => {
    settingsCache.clear();
    if (!supportsConfiguration)
      fallbackSettings = normalizeSettings(asObject(event.settings)?.["vhs"] ?? event.settings);
    for (const document of documents.all()) void publish(document);
    void connection.sendRequest("workspace/codeLens/refresh").catch(() => undefined);
  });

  connection.onNotification("vhs/workspaceFiles", (payload: unknown): void => {
    const files = asObject(payload)?.["files"];
    workspaceIndex.replace(
      Array.isArray(files) ? files.filter(isWorkspaceFile).slice(0, 2_000) : [],
    );
    for (const document of documents.all()) void publish(document);
  });

  connection.onNotification("vhs/detectedVersion", (payload: unknown): void => {
    const version = asObject(payload)?.["version"];
    detectedVersion =
      typeof version === "string" && /^v?\d+\.\d+\.\d+$/u.test(version) ? version : undefined;
    for (const document of documents.all()) void publish(document);
  });

  connection.onCompletion((params): CompletionItem[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return [];
    return completionsAt(parseVhs(document.getText()), document.offsetAt(params.position)).map(
      (item): CompletionItem => ({
        detail: item.detail,
        documentation: { kind: MarkupKind.Markdown, value: item.documentation },
        insertText: item.insertText,
        kind:
          item.kind === "value"
            ? CompletionItemKind.Value
            : item.kind === "setting"
              ? CompletionItemKind.Property
              : CompletionItemKind.Keyword,
        label: item.label,
      }),
    );
  });

  connection.onHover((params): Hover | undefined => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return undefined;
    const hover = hoverAt(parseVhs(document.getText()), document.offsetAt(params.position));
    return hover === undefined
      ? undefined
      : {
          contents: { kind: MarkupKind.Markdown, value: hover.markdown },
          range: toRange(document, hover.range),
        };
  });

  connection.onSignatureHelp((params): SignatureHelp | undefined => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return undefined;
    const offset = document.offsetAt(params.position);
    const command = [...parseVhs(document.getText()).commands]
      .reverse()
      .find((candidate) => candidate.startOffset <= offset);
    if (command === undefined) return undefined;
    const definition = COMMAND_BY_NAME.get(command.name);
    if (definition === undefined) return undefined;
    const parameters = [...definition.syntax.matchAll(/<[^>]+>/gu)].map((match) => ({
      label: match[0],
    }));
    const activeParameter = Math.max(
      0,
      Math.min(
        parameters.length - 1,
        command.arguments.filter(({ endOffset }) => endOffset <= offset).length,
      ),
    );
    return {
      activeParameter,
      activeSignature: 0,
      signatures: [
        {
          activeParameter,
          documentation: { kind: MarkupKind.Markdown, value: definition.description },
          label: definition.syntax,
          parameters,
        },
      ],
    };
  });

  connection.onDocumentFormatting((params): TextEdit[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return [];
    const newText = formatVhs(document.getText());
    return newText === document.getText() ? [] : [{ newText, range: fullRange(document) }];
  });

  connection.onCodeAction((params): CodeAction[] =>
    params.context.diagnostics.flatMap((item): CodeAction[] => {
      const data = asObject(item.data);
      const replacement = data?.["replacement"];
      return typeof replacement !== "string"
        ? []
        : [
            {
              diagnostics: [item],
              edit: {
                changes: {
                  [params.textDocument.uri]: [{ newText: replacement, range: item.range }],
                },
              },
              isPreferred: true,
              kind: CodeActionKind.QuickFix,
              title: "Apply VHS fix",
            },
          ];
    }),
  );

  connection.onDocumentSymbol((params): DocumentSymbol[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return [];
    return documentSymbols(parseVhs(document.getText())).map((symbol): DocumentSymbol => ({
      detail: symbol.detail,
      kind:
        symbol.kind === "setting"
          ? SymbolKind.Property
          : symbol.kind === "file"
            ? SymbolKind.File
            : SymbolKind.Event,
      name: symbol.name,
      range: toRange(document, symbol.range),
      selectionRange: toRange(document, symbol.range),
    }));
  });

  connection.onDocumentLinks((params): DocumentLink[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return [];
    return parseVhs(document.getText()).commands.flatMap((command): DocumentLink[] => {
      if (!["Source", "Output", "Screenshot"].includes(command.name)) return [];
      const value = command.arguments[0];
      if (value === undefined) return [];
      const target = sourceTarget(document.uri, value.value);
      return target === undefined
        ? []
        : [
            {
              range: toRange(document, value),
              target,
              tooltip: command.name === "Source" ? "Open source tape" : "Open output",
            },
          ];
    });
  });

  connection.onDefinition((params): Location | undefined => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return undefined;
    const offset = document.offsetAt(params.position);
    const source = parseVhs(document.getText()).commands.find(
      (command) =>
        command.name === "Source" && command.startOffset <= offset && offset <= command.endOffset,
    );
    const value = source?.arguments[0]?.value;
    const target = value === undefined ? undefined : sourceTarget(document.uri, value);
    return target === undefined
      ? undefined
      : {
          uri: target,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        };
  });

  connection.onReferences((params): Location[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return [];
    const offset = document.offsetAt(params.position);
    const selected = parseVhs(document.getText()).commands.find(
      (command) =>
        command.name === "Source" && command.startOffset <= offset && offset <= command.endOffset,
    );
    const selectedValue = selected?.arguments[0]?.value;
    const target =
      selectedValue === undefined ? undefined : sourceTarget(document.uri, selectedValue);
    if (target === undefined) return [];
    return sourceOccurrences(workspaceIndex.merged(documents.all()))
      .filter((occurrence) => occurrence.target === target)
      .map((occurrence) => ({
        uri: occurrence.document.uri,
        range: rangeFromOffsets(
          occurrence.document.text,
          occurrence.command.arguments[0]?.startOffset ?? 0,
          occurrence.command.arguments[0]?.endOffset ?? 0,
        ),
      }));
  });

  connection.onCodeLens(async (params): Promise<CodeLens[]> => {
    const settings = await settingsFor(params.textDocument.uri);
    if (!settings.codeLens.enabled) return [];
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    return [
      { command: { command: "vhs.runTape", title: "$(play) Run Tape" }, range },
      {
        command: { command: "vhs.runAndPreview", title: "$(open-preview) Run and Preview" },
        range,
      },
    ];
  });

  connection.languages.semanticTokens.on((params): SemanticTokens => {
    const document = documents.get(params.textDocument.uri);
    const builder = new SemanticTokensBuilder();
    if (document === undefined) return builder.build();
    const tree = parseVhs(document.getText());
    const settings = new Set(
      tree.commands.flatMap((command) =>
        command.name === "Set" && command.arguments[0] !== undefined
          ? [command.arguments[0].startOffset]
          : [],
      ),
    );
    for (const token of tree.tokens) {
      if (token.start.line !== token.end.line || token.raw.length === 0) continue;
      const type = semanticType(token, settings);
      if (type !== undefined)
        builder.push(
          token.start.line,
          token.start.character,
          token.raw.length,
          tokenTypes.indexOf(type),
          0,
        );
    }
    return builder.build();
  });

  connection.onFoldingRanges((params): FoldingRange[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return [];
    const ranges: FoldingRange[] = [];
    const hidden: number[] = [];
    for (const command of parseVhs(document.getText()).commands) {
      if (command.name === "Hide") hidden.push(command.start.line);
      if (command.name === "Show") {
        const startLine = hidden.pop();
        if (startLine !== undefined && command.end.line > startLine)
          ranges.push({ endLine: command.end.line, kind: FoldingRangeKind.Region, startLine });
      }
    }
    return ranges;
  });

  connection.onDocumentColor((params): ColorInformation[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return [];
    const colors: ColorInformation[] = [];
    for (const command of parseVhs(document.getText()).commands) {
      if (command.name !== "Set" || command.arguments[0]?.value !== "MarginFill") continue;
      const value = command.arguments[1];
      const match = value?.value.match(/^#([0-9a-fA-F]{6})$/u);
      if (value === undefined || match?.[1] === undefined) continue;
      const hex = match[1];
      colors.push({
        color: Color.create(
          Number.parseInt(hex.slice(0, 2), 16) / 255,
          Number.parseInt(hex.slice(2, 4), 16) / 255,
          Number.parseInt(hex.slice(4, 6), 16) / 255,
          1,
        ),
        range: toRange(document, value),
      });
    }
    return colors;
  });

  connection.onColorPresentation((params): ColorPresentation[] => {
    const hex = [params.color.red, params.color.green, params.color.blue]
      .map((component) =>
        Math.round(component * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
    const label = `"#${hex}"`;
    return [{ label, textEdit: { newText: label, range: params.range } }];
  });

  connection.workspace.onWillRenameFiles((params): WorkspaceEdit | null => {
    const files = workspaceIndex.merged(documents.all());
    const changes: Record<string, TextEdit[]> = {};
    for (const rename of params.files) {
      for (const occurrence of sourceOccurrences(files).filter(
        ({ target }) => target === rename.oldUri,
      )) {
        const path = relativeSourcePath(occurrence.document.uri, rename.newUri);
        const value = occurrence.command.arguments[0];
        if (path === undefined || value === undefined) continue;
        const edits = changes[occurrence.document.uri] ?? [];
        edits.push({
          newText: value.quoted ? `"${path}"` : path,
          range: rangeFromOffsets(occurrence.document.text, value.startOffset, value.endOffset),
        });
        changes[occurrence.document.uri] = edits;
      }
    }
    return Object.keys(changes).length === 0 ? null : { changes };
  });

  documents.onDidOpen(({ document }) => void publish(document));
  documents.onDidChangeContent(({ document }) => void publish(document));
  documents.onDidClose(
    ({ document }) => void connection.sendDiagnostics({ diagnostics: [], uri: document.uri }),
  );
  documents.listen(connection);
  connection.listen();
}

function sourceDiagnostics(
  document: TextDocument,
  tree: VhsDocument,
  files: ReadonlyMap<
    string,
    { readonly text: string; readonly tree: VhsDocument; readonly uri: string }
  >,
): Diagnostic[] {
  if (!files.has(document.uri)) return [];
  const result: Diagnostic[] = [];
  for (const command of tree.commands) {
    if (command.name !== "Source") continue;
    const value = command.arguments[0];
    const target = value === undefined ? undefined : sourceTarget(document.uri, value.value);
    if (value === undefined || target === undefined) continue;
    const source = files.get(target);
    if (source === undefined)
      result.push({
        code: "source-not-found",
        message: `Source tape '${value.value}' was not found.`,
        range: toRange(document, value),
        severity: DiagnosticSeverity.Error,
        source: "VHS",
      });
    else if (source.text.length === 0)
      result.push({
        code: "source-empty",
        message: "Source tape is empty.",
        range: toRange(document, value),
        severity: DiagnosticSeverity.Error,
        source: "VHS",
      });
    else if (source.tree.commands.some((candidate) => candidate.name === "Source"))
      result.push({
        code: "nested-source",
        message: "VHS does not allow a sourced tape to contain Source.",
        range: toRange(document, value),
        severity: DiagnosticSeverity.Error,
        source: "VHS",
      });
  }
  if (sourceCycle(files, document.uri)) {
    const source = tree.commands.find((command) => command.name === "Source")?.arguments[0];
    if (source !== undefined)
      result.push({
        code: "source-cycle",
        message: "This Source chain contains a cycle.",
        range: toRange(document, source),
        severity: DiagnosticSeverity.Error,
        source: "VHS",
      });
  }
  return result;
}

function toDiagnostic(document: TextDocument, item: CoreDiagnostic): Diagnostic {
  return {
    code: item.code,
    data: item.replacement === undefined ? undefined : { replacement: item.replacement },
    message: item.message,
    range: toRange(document, item),
    severity:
      item.severity === "error"
        ? DiagnosticSeverity.Error
        : item.severity === "warning"
          ? DiagnosticSeverity.Warning
          : item.severity === "information"
            ? DiagnosticSeverity.Information
            : DiagnosticSeverity.Hint,
    source: "VHS",
  };
}

function semanticType(
  token: Token,
  settings: ReadonlySet<number>,
): (typeof tokenTypes)[number] | undefined {
  if (token.kind === "comment") return "comment";
  if (settings.has(token.startOffset)) return "property";
  if (COMMAND_BY_NAME.has(token.value)) return "keyword";
  if (token.kind === "number") return "number";
  if (token.kind === "regex") return "regexp";
  if (["string", "json"].includes(token.kind)) return "string";
  return undefined;
}

function toRange(
  document: TextDocument,
  range: { readonly startOffset: number; readonly endOffset: number },
): Range {
  return {
    start: document.positionAt(range.startOffset),
    end: document.positionAt(range.endOffset),
  };
}

function fullRange(document: TextDocument): Range {
  return { start: { line: 0, character: 0 }, end: document.positionAt(document.getText().length) };
}

function rangeFromOffsets(text: string, start: number, end: number): Range {
  const document = TextDocument.create("memory:///range.tape", "vhs", 1, text);
  return { start: document.positionAt(start), end: document.positionAt(end) };
}

function normalizeSettings(value: unknown): ServerSettings {
  const root = asObject(value);
  const validation = asObject(root?.["validation"]);
  const codeLens = asObject(root?.["codeLens"]);
  const maxProblems = validation?.["maxProblems"];
  return {
    codeLens: { enabled: typeof codeLens?.["enabled"] === "boolean" ? codeLens["enabled"] : true },
    targetVersion: typeof root?.["targetVersion"] === "string" ? root["targetVersion"] : "latest",
    validation: {
      enable: typeof validation?.["enable"] === "boolean" ? validation["enable"] : true,
      maxProblems:
        typeof maxProblems === "number" && Number.isInteger(maxProblems)
          ? Math.max(1, Math.min(2_000, maxProblems))
          : 200,
    },
  };
}

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

const isWorkspaceFile = (
  value: unknown,
): value is { readonly text: string; readonly uri: string } => {
  const item = asObject(value);
  return typeof item?.["text"] === "string" && typeof item["uri"] === "string";
};
