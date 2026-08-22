export {
  artifactReferences,
  completionsAt,
  documentSymbols,
  hoverAt,
  versionDiagnostics,
} from "./intelligence.js";
export { formatVhs, type FormatOptions } from "./formatter.js";
export { lexVhs } from "./lexer.js";
export { parseVhs } from "./parser.js";
export {
  COMMANDS,
  COMMAND_BY_NAME,
  SETTINGS,
  SETTING_BY_NAME,
  SHELLS,
  THEMES,
  WINDOW_BARS,
} from "./registry.js";
export type {
  ArtifactReference,
  CommandDefinition,
  CommandNode,
  CompletionEntry,
  Diagnostic,
  DiagnosticSeverity,
  DocumentSymbolEntry,
  HoverEntry,
  LanguageItem,
  Position,
  SettingDefinition,
  TextRange,
  Token,
  TokenKind,
  ValueKind,
  VhsDocument,
} from "./types.js";
