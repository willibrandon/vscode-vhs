import { COMMAND_BY_NAME, SETTING_BY_NAME } from "./registry.js";
import type { CommandNode, Diagnostic, TextRange, Token, VhsDocument } from "./types.js";
import { lexVhs } from "./lexer.js";

const asRange = (start: Token, end: Token): TextRange => ({
  start: start.start,
  end: end.end,
  startOffset: start.startOffset,
  endOffset: end.endOffset,
});

const diagnostic = (
  token: Token,
  severity: Diagnostic["severity"],
  code: string,
  message: string,
  replacement?: string,
): Diagnostic => ({
  severity,
  code,
  message,
  start: token.start,
  end: token.end,
  startOffset: token.startOffset,
  endOffset: token.endOffset,
  ...(replacement === undefined ? {} : { replacement }),
});

const isCommandStart = (tokens: readonly Token[], index: number): boolean => {
  const token = tokens[index];
  if (token === undefined || token.kind === "comment" || !COMMAND_BY_NAME.has(token.value))
    return false;
  return index === 0 || tokens[index - 1]?.value !== "+";
};

const commandEnd = (tokens: readonly Token[], start: number): number => {
  for (let index = start + 1; index < tokens.length; index += 1) {
    if (isCommandStart(tokens, index)) return index;
  }
  return tokens.length;
};

const meaningful = (tokens: readonly Token[]): readonly Token[] =>
  tokens.filter((token) => token.kind !== "comment");

export function parseVhs(text: string): VhsDocument {
  const scan = lexVhs(text);
  const tokens = meaningful(scan.tokens);
  const commands: CommandNode[] = [];
  const diagnostics: Diagnostic[] = [...scan.diagnostics];
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) break;
    if (!isCommandStart(tokens, index)) {
      diagnostics.push(
        diagnostic(token, "error", "invalid-command", `Unknown VHS command '${token.value}'.`),
      );
      index += 1;
      continue;
    }

    const endIndex = commandEnd(tokens, index);
    const args = tokens.slice(index + 1, endIndex);
    const last = args.at(-1) ?? token;
    commands.push({
      name: token.value,
      nameToken: token,
      arguments: args,
      ...asRange(token, last),
    });
    validateCommand(token.value, token, args, diagnostics);
    index = endIndex;
  }

  validateOrdering(commands, diagnostics);
  validateOutputs(commands, diagnostics);
  return { text, tokens: scan.tokens, commands, diagnostics };
}

function validateCommand(
  name: string,
  nameToken: Token,
  args: readonly Token[],
  diagnostics: Diagnostic[],
): void {
  const requireCount = (minimum: number, message: string): boolean => {
    if (args.length >= minimum) return true;
    diagnostics.push(diagnostic(nameToken, "error", "missing-argument", message));
    return false;
  };

  if (name === "Set") {
    if (!requireCount(2, "Set expects a setting and a value.")) return;
    const settingToken = args[0];
    const value = args[1];
    if (settingToken === undefined || value === undefined) return;
    const setting = SETTING_BY_NAME.get(settingToken.value);
    if (setting === undefined) {
      diagnostics.push(
        diagnostic(
          settingToken,
          "error",
          "unknown-setting",
          `Unknown VHS setting '${settingToken.value}'.`,
        ),
      );
      return;
    }
    const settingValues = args.slice(1);
    validateSetting(setting.name, value, settingValues, diagnostics);
    if (settingValues.length > expectedSettingTokenCount(setting.name, settingValues)) {
      const extra = args.at(-1);
      if (extra !== undefined)
        diagnostics.push(
          diagnostic(extra, "error", "extra-argument", `${setting.name} has too many values.`),
        );
    }
    return;
  }

  if (["Hide", "Show", "Paste"].includes(name)) {
    if (args.length > 0 && args[0] !== undefined)
      diagnostics.push(
        diagnostic(args[0], "error", "extra-argument", `${name} does not take a value.`),
      );
    return;
  }

  if (["Output", "Source", "Screenshot", "Require"].includes(name)) {
    if (!requireCount(1, `${name} expects a path or name.`)) return;
    const { value, consumed } = mergeContiguous(args);
    if (value === undefined) return;
    if (args.length > consumed && args[consumed] !== undefined)
      diagnostics.push(
        diagnostic(args[consumed], "error", "extra-argument", `${name} expects one value.`),
      );
    if (name === "Source" && !value.value.endsWith(".tape"))
      diagnostics.push(
        diagnostic(value, "error", "source-extension", "Source expects a .tape file."),
      );
    if (name === "Screenshot" && !value.value.toLowerCase().endsWith(".png"))
      diagnostics.push(
        diagnostic(value, "error", "screenshot-extension", "Screenshot expects a .png file."),
      );
    if (
      (name === "Output" || name === "Source" || name === "Screenshot") &&
      !value.quoted &&
      (/^\d/u.test(value.value) || value.raw.startsWith("/") || value.kind === "regex")
    ) {
      diagnostics.push(
        diagnostic(
          value,
          "warning",
          "quote-path",
          "Quote this path so VHS reads it as a file path.",
          `"${value.raw}"`,
        ),
      );
    }
    if (name === "Output" && !value.value.includes(".") && !value.value.endsWith("/")) {
      diagnostics.push(
        diagnostic(
          value,
          "error",
          "frame-directory-slash",
          "A frame output directory must end with /.",
        ),
      );
    }
    return;
  }

  if (name === "Env") {
    if (!requireCount(2, "Env expects a name and a value.")) return;
    const variable = args[0];
    if (variable !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(variable.value)) {
      diagnostics.push(
        diagnostic(
          variable,
          "error",
          "invalid-environment-name",
          "Use a valid environment variable name.",
        ),
      );
    }
    if (args.length > 2 && args[2] !== undefined)
      diagnostics.push(diagnostic(args[2], "error", "extra-argument", "Env expects one value."));
    return;
  }

  if (name === "Sleep") {
    if (!requireCount(1, "Sleep expects a duration.")) return;
    validateDuration(args, diagnostics);
    return;
  }

  if (name === "Type" || name === "Copy") {
    if (!requireCount(1, `${name} expects text.`)) return;
    if (name === "Type") validateOptionalSpeed(args, diagnostics);
    const firstText = args.find((token) => token.value !== "@" && !isDurationPart(token));
    if (firstText !== undefined && firstText.lineBreakBefore && !firstText.quoted) {
      diagnostics.push(
        diagnostic(
          firstText,
          "warning",
          "bare-text-continuation",
          `Quote ${name} text that starts on another line.`,
        ),
      );
    }
    return;
  }

  if (["Ctrl", "Alt", "Shift"].includes(name)) {
    if (!requireCount(2, `${name} expects + followed by a key.`)) return;
    if (args[0]?.value !== "+")
      diagnostics.push(
        diagnostic(
          args[0] ?? nameToken,
          "error",
          "missing-plus",
          `${name} expects + before the key.`,
        ),
      );
    return;
  }

  if (name === "Wait") {
    for (const token of args) {
      if (token.kind === "regex" && token.terminated) {
        try {
          new RegExp(token.value);
        } catch {
          diagnostics.push(
            diagnostic(token, "error", "invalid-regex", "This Wait regular expression is invalid."),
          );
        }
      }
    }
    return;
  }

  validateOptionalSpeed(args, diagnostics);
}

function mergeContiguous(tokens: readonly Token[]): {
  readonly value: Token | undefined;
  readonly consumed: number;
} {
  const first = tokens[0];
  if (first === undefined) return { value: undefined, consumed: 0 };
  let consumed = 1;
  let last = first;
  while (tokens[consumed]?.startOffset === last.endOffset) {
    last = tokens[consumed] ?? last;
    consumed += 1;
  }
  if (consumed === 1) return { value: first, consumed };
  const joined = tokens
    .slice(0, consumed)
    .map((token) => token.raw)
    .join("");
  return {
    consumed,
    value: {
      ...first,
      kind: "word",
      raw: joined,
      value: joined,
      end: last.end,
      endOffset: last.endOffset,
      terminated: tokens.slice(0, consumed).every((token) => token.terminated),
    },
  };
}

const isDurationPart = (token: Token): boolean =>
  token.kind === "number" || ["ms", "s", "m"].includes(token.value);

function validateOptionalSpeed(args: readonly Token[], diagnostics: Diagnostic[]): void {
  const at = args.findIndex((token) => token.value === "@");
  if (at < 0) return;
  const value = args[at + 1];
  const unit = args[at + 2];
  validateDuration(
    value === undefined
      ? []
      : unit !== undefined && ["ms", "s", "m"].includes(unit.value)
        ? [value, unit]
        : [value],
    diagnostics,
  );
}

function validateDuration(args: readonly Token[], diagnostics: Diagnostic[]): void {
  const number = args[0];
  if (number?.kind !== "number") {
    if (number !== undefined)
      diagnostics.push(
        diagnostic(number, "error", "invalid-duration", "A duration starts with a number."),
      );
    return;
  }
  if (Number(number.value) <= 0)
    diagnostics.push(
      diagnostic(number, "error", "non-positive-duration", "A duration must be greater than zero."),
    );
  const unit = args[1];
  if (unit !== undefined && !["ms", "s", "m"].includes(unit.value))
    diagnostics.push(
      diagnostic(unit, "error", "invalid-duration-unit", "Use ms, s, or m for the duration unit."),
    );
}

function validateSetting(
  name: string,
  value: Token,
  values: readonly Token[],
  diagnostics: Diagnostic[],
): void {
  const setting = SETTING_BY_NAME.get(name);
  if (setting === undefined) return;
  if (setting.value === "number" && value.kind !== "number")
    diagnostics.push(diagnostic(value, "error", "expected-number", `${name} expects a number.`));
  if (setting.value === "boolean" && !["true", "false"].includes(value.value))
    diagnostics.push(
      diagnostic(value, "error", "expected-boolean", `${name} expects true or false.`),
    );
  if (
    setting.value === "color" &&
    value.value.startsWith("#") &&
    !/^#[0-9a-fA-F]{6}$/u.test(value.value)
  )
    diagnostics.push(diagnostic(value, "error", "invalid-color", "Use a six-digit hex color."));
  if (
    setting.value === "shell" &&
    setting.values !== undefined &&
    !setting.values.includes(value.value)
  )
    diagnostics.push(
      diagnostic(value, "error", "invalid-shell", `'${value.value}' is not a supported VHS shell.`),
    );
  if (
    setting.value === "windowBar" &&
    setting.values !== undefined &&
    !setting.values.includes(value.value)
  )
    diagnostics.push(
      diagnostic(
        value,
        "error",
        "invalid-window-bar",
        `'${value.value}' is not a VHS window-bar style.`,
      ),
    );
  if (
    setting.value === "theme" &&
    value.kind !== "json" &&
    setting.values !== undefined &&
    !setting.values.includes(value.value)
  )
    diagnostics.push(
      diagnostic(
        value,
        "warning",
        "unknown-theme",
        `'${value.value}' is not a built-in VHS theme.`,
      ),
    );
  if (setting.value === "regex" && value.kind !== "regex")
    diagnostics.push(diagnostic(value, "error", "expected-regex", `${name} expects /pattern/.`));
  if (setting.value === "duration") validateDuration(values, diagnostics);
  if (value.kind === "json") {
    try {
      JSON.parse(value.raw);
    } catch {
      diagnostics.push(diagnostic(value, "error", "invalid-json", "This theme JSON is invalid."));
    }
  }
}

const expectedSettingTokenCount = (name: string, values: readonly Token[]): number => {
  if (
    ["TypingSpeed", "WaitTimeout"].includes(name) &&
    values[1] !== undefined &&
    ["ms", "s", "m"].includes(values[1].value)
  )
    return 2;
  if (name === "LoopOffset" && values[1]?.value === "%") return 2;
  return 1;
};

function validateOrdering(commands: readonly CommandNode[], diagnostics: Diagnostic[]): void {
  let actionSeen = false;
  for (const command of commands) {
    const definition = COMMAND_BY_NAME.get(command.name);
    if (command.name === "Set" && actionSeen && command.arguments[0]?.value !== "TypingSpeed")
      diagnostics.push(
        diagnostic(
          command.nameToken,
          "warning",
          "late-setting",
          "VHS ignores this setting after recording actions begin.",
        ),
      );
    if (command.name === "Require" && actionSeen)
      diagnostics.push(
        diagnostic(
          command.nameToken,
          "warning",
          "late-require",
          "Place Require before recording actions.",
        ),
      );
    if (definition?.action === true) actionSeen = true;
  }
}

function validateOutputs(commands: readonly CommandNode[], diagnostics: Diagnostic[]): void {
  const seen = new Map<string, Token>();
  for (const command of commands) {
    if (command.name !== "Output") continue;
    const output = command.arguments[0];
    if (output === undefined) continue;
    const lower = output.value.toLowerCase();
    const kind = lower.endsWith(".mp4")
      ? "video/mp4"
      : lower.endsWith(".webm")
        ? "video/webm"
        : [".txt", ".ascii", ".test"].some((extension) => lower.endsWith(extension))
          ? "text"
          : lower.endsWith("/")
            ? "frames"
            : "image/gif";
    if (seen.has(kind))
      diagnostics.push(
        diagnostic(
          output,
          "warning",
          "shadowed-output",
          `A later ${kind} output replaces the earlier one.`,
        ),
      );
    seen.set(kind, output);
  }
}
