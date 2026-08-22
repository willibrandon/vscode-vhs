import {
  COMMANDS,
  COMMAND_BY_NAME,
  SETTINGS,
  SETTING_BY_NAME,
  SHELLS,
  THEMES,
  WINDOW_BARS,
} from "./registry.js";
import type {
  ArtifactReference,
  CompletionEntry,
  Diagnostic,
  DocumentSymbolEntry,
  HoverEntry,
  Token,
  VhsDocument,
} from "./types.js";

const commandCompletion = (name: string, syntax: string, description: string): CompletionEntry => ({
  label: name,
  detail: syntax,
  documentation: description,
  insertText: name,
  kind: "command",
});

const valueCompletions = (values: readonly string[], detail: string): readonly CompletionEntry[] =>
  values.map((value): CompletionEntry => ({
    label: value,
    detail,
    documentation: detail,
    insertText: value,
    kind: "value",
  }));

export function completionsAt(document: VhsDocument, offset: number): readonly CompletionEntry[] {
  const before = document.tokens.filter(
    (token) => token.endOffset <= offset && token.kind !== "comment",
  );
  const last = before.at(-1);
  const previous = before.at(-2);
  const currentCommand = [...document.commands]
    .reverse()
    .find((command) => command.startOffset <= offset);

  if (currentCommand?.name === "Set") {
    const setting = currentCommand.arguments[0]?.value;
    if (setting === undefined || currentCommand.arguments[0]?.endOffset === offset) {
      return SETTINGS.map((entry): CompletionEntry => ({
        label: entry.name,
        detail: entry.syntax,
        documentation: `${entry.description} Default: ${entry.defaultValue}.`,
        insertText: entry.name,
        kind: "setting",
      }));
    }
    if (setting === "Theme") return valueCompletions(THEMES, "Built-in VHS theme");
    if (setting === "Shell") return valueCompletions(SHELLS, "VHS shell");
    if (setting === "WindowBar")
      return valueCompletions(WINDOW_BARS.filter(Boolean), "VHS window-bar style");
    if (setting === "CursorBlink") return valueCompletions(["true", "false"], "Boolean");
  }

  if (last?.value === "+" || previous?.value === "+") {
    if (currentCommand?.name === "Wait") return valueCompletions(["Line", "Screen"], "Wait scope");
    if (["Alt", "Shift"].includes(currentCommand?.name ?? ""))
      return valueCompletions(["Enter", "Tab", "[", "]"], "Key");
    if (currentCommand?.name === "Ctrl")
      return valueCompletions(
        [
          "Alt",
          "Shift",
          "Enter",
          "Space",
          "Backspace",
          "Left",
          "Right",
          "Up",
          "Down",
          "-",
          "@",
          "[",
          "]",
          "^",
          "\\",
        ],
        "Key or modifier",
      );
  }

  return COMMANDS.map((entry) => commandCompletion(entry.name, entry.syntax, entry.description));
}

const tokenAt = (document: VhsDocument, offset: number): Token | undefined =>
  document.tokens.find((token) => token.startOffset <= offset && offset <= token.endOffset);

export function hoverAt(document: VhsDocument, offset: number): HoverEntry | undefined {
  const token = tokenAt(document, offset);
  if (token === undefined) return undefined;
  const command = COMMAND_BY_NAME.get(token.value);
  if (command !== undefined) {
    return {
      title: command.name,
      markdown: `**\`${command.syntax}\`**\n\n${command.description}\n\nAvailable since VHS ${command.since}.\n\n[Official documentation](${command.documentation})`,
      range: token,
    };
  }
  const setting = SETTING_BY_NAME.get(token.value);
  if (setting !== undefined) {
    return {
      title: setting.name,
      markdown: `**\`${setting.syntax}\`**\n\n${setting.description}\n\nDefault: \`${setting.defaultValue}\`.\n\n[Official documentation](${setting.documentation})`,
      range: token,
    };
  }
  return undefined;
}

export function documentSymbols(document: VhsDocument): readonly DocumentSymbolEntry[] {
  return document.commands
    .filter((command) => ["Set", "Source", "Output", "Screenshot"].includes(command.name))
    .map((command): DocumentSymbolEntry => ({
      name: command.name,
      detail: command.arguments.map((token) => token.raw).join(" "),
      kind: command.name === "Set" ? "setting" : command.name === "Source" ? "file" : "event",
      range: command,
    }));
}

export function artifactReferences(document: VhsDocument): readonly ArtifactReference[] {
  const artifacts: ArtifactReference[] = [];
  for (const command of document.commands) {
    const value = command.arguments[0];
    if (
      value === undefined ||
      command.arguments.length !== 1 ||
      !["string", "word"].includes(value.kind)
    )
      continue;
    const path = value.value;
    if (command.name === "Screenshot") artifacts.push({ kind: "screenshot", path, range: value });
    if (command.name !== "Output") continue;
    const kind: ArtifactReference["kind"] =
      path.endsWith(".mp4") || path.endsWith(".webm")
        ? "video"
        : [".txt", ".ascii", ".test"].some((extension) => path.endsWith(extension))
          ? "text"
          : path.endsWith("/")
            ? "frames"
            : "image";
    artifacts.push({ kind, path, range: value });
  }
  return artifacts;
}

export function versionDiagnostics(
  document: VhsDocument,
  targetVersion: string,
): readonly Diagnostic[] {
  const target = parseVersion(targetVersion);
  if (target === undefined) return [];
  const diagnostics: Diagnostic[] = [];
  for (const command of document.commands) {
    const definition = COMMAND_BY_NAME.get(command.name);
    const since = definition === undefined ? undefined : parseVersion(definition.since);
    if (since !== undefined && compareVersion(target, since) < 0) {
      diagnostics.push({
        code: "unsupported-version",
        message: `${command.name} requires VHS ${definition?.since ?? "a newer version"}; the target is ${targetVersion}.`,
        severity: "warning",
        start: command.nameToken.start,
        end: command.nameToken.end,
        startOffset: command.nameToken.startOffset,
        endOffset: command.nameToken.endOffset,
      });
    }
  }
  return diagnostics;
}

const parseVersion = (value: string): readonly [number, number, number] | undefined => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(value);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined)
    return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const compareVersion = (left: readonly number[], right: readonly number[]): number => {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};
