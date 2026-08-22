export interface Position {
  readonly line: number;
  readonly character: number;
}

export interface TextRange {
  readonly start: Position;
  readonly end: Position;
  readonly startOffset: number;
  readonly endOffset: number;
}

export type TokenKind =
  "word" | "number" | "string" | "regex" | "json" | "comment" | "symbol" | "invalid";

export interface Token extends TextRange {
  readonly kind: TokenKind;
  readonly raw: string;
  readonly value: string;
  readonly quoted: boolean;
  readonly lineBreakBefore: boolean;
  readonly terminated: boolean;
}

export interface CommandNode extends TextRange {
  readonly name: string;
  readonly nameToken: Token;
  readonly arguments: readonly Token[];
}

export type DiagnosticSeverity = "error" | "warning" | "information" | "hint";

export interface Diagnostic extends TextRange {
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly replacement?: string;
}

export interface VhsDocument {
  readonly text: string;
  readonly tokens: readonly Token[];
  readonly commands: readonly CommandNode[];
  readonly diagnostics: readonly Diagnostic[];
}

export type ValueKind =
  | "none"
  | "string"
  | "number"
  | "duration"
  | "boolean"
  | "color"
  | "regex"
  | "path"
  | "theme"
  | "shell"
  | "windowBar";

export interface LanguageItem {
  readonly name: string;
  readonly syntax: string;
  readonly description: string;
  readonly documentation: string;
  readonly since: string;
}

export interface CommandDefinition extends LanguageItem {
  readonly arguments: ValueKind;
  readonly action: boolean;
}

export interface SettingDefinition extends LanguageItem {
  readonly value: ValueKind;
  readonly defaultValue: string;
  readonly values?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface CompletionEntry {
  readonly label: string;
  readonly detail: string;
  readonly documentation: string;
  readonly insertText: string;
  readonly kind: "command" | "setting" | "value";
}

export interface HoverEntry {
  readonly title: string;
  readonly markdown: string;
  readonly range: TextRange;
}

export interface DocumentSymbolEntry {
  readonly name: string;
  readonly detail: string;
  readonly kind: "command" | "setting" | "file" | "event";
  readonly range: TextRange;
}

export interface ArtifactReference {
  readonly kind: "image" | "video" | "text" | "frames" | "screenshot";
  readonly path: string;
  readonly range: TextRange;
}
