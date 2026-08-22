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

const DURATION_UNITS = ["ms", "s", "m"] as const;
const INTEGER_SETTINGS = new Set([
  "BorderRadius",
  "FontSize",
  "Framerate",
  "Height",
  "Margin",
  "Padding",
  "Width",
  "WindowBarSize",
]);

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
    if (name === "Screenshot" && !value.value.endsWith(".png"))
      diagnostics.push(
        diagnostic(value, "error", "screenshot-extension", "Screenshot expects a .png file."),
      );
    if (!value.quoted && (consumed > 1 || !isVhsStringToken(args[0]))) {
      diagnostics.push(
        diagnostic(
          value,
          "error",
          "quote-path",
          `Quote this ${name === "Require" ? "name" : "path"} so VHS reads it correctly.`,
          `"${value.raw}"`,
        ),
      );
    }
    if (name === "Output" && !hasFileExtension(value.value) && !value.value.endsWith("/")) {
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
    const value = args[1];
    if (variable !== undefined && (variable.value.length === 0 || variable.value.includes("="))) {
      diagnostics.push(
        diagnostic(
          variable,
          "error",
          "invalid-environment-name",
          "An environment variable name cannot be empty or contain =.",
        ),
      );
    }
    if (value !== undefined && !isVhsStringToken(value))
      diagnostics.push(
        diagnostic(value, "error", "expected-string", "Env expects a string value."),
      );
    if (args.length > 2 && args[2] !== undefined)
      diagnostics.push(diagnostic(args[2], "error", "extra-argument", "Env expects one value."));
    return;
  }

  if (name === "Sleep") {
    if (!requireCount(1, "Sleep expects a duration.")) return;
    const consumed = validateDuration(args, diagnostics, nameToken);
    reportExtra(args, consumed, diagnostics, "Sleep expects one duration.");
    return;
  }

  if (name === "Type" || name === "Copy") {
    const consumed = name === "Type" ? validateOptionalSpeed(args, diagnostics) : 0;
    const text = args.slice(consumed);
    if (text.length === 0) {
      diagnostics.push(diagnostic(nameToken, "error", "missing-argument", `${name} expects text.`));
      return;
    }
    for (const token of text) {
      if (!isVhsStringToken(token))
        diagnostics.push(
          diagnostic(token, "error", "expected-string", `${name} expects string text.`),
        );
    }
    const firstText = text[0];
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
    validateModifiedKey(name, nameToken, args, diagnostics);
    return;
  }

  if (name === "Wait") {
    let consumed = 0;
    if (args[consumed]?.value === "+") {
      const scope = args[consumed + 1];
      if (scope === undefined || !["Line", "Screen"].includes(scope.value)) {
        diagnostics.push(
          diagnostic(
            scope ?? args[consumed] ?? nameToken,
            "error",
            "invalid-wait-scope",
            "Wait+ expects Line or Screen.",
          ),
        );
      }
      consumed += scope === undefined ? 1 : 2;
    }
    consumed += validateOptionalSpeed(args.slice(consumed), diagnostics, true);
    const pattern = args[consumed];
    if (pattern !== undefined) {
      if (pattern.kind !== "regex")
        diagnostics.push(diagnostic(pattern, "error", "expected-regex", "Wait expects /pattern/."));
      else validateRegexStructure(pattern, diagnostics);
      consumed += 1;
    }
    reportExtra(args, consumed, diagnostics, "Wait has too many values.");
    return;
  }

  const consumed = validateOptionalSpeed(args, diagnostics);
  const repeat = args[consumed];
  if (repeat !== undefined && repeat.kind !== "number")
    diagnostics.push(
      diagnostic(repeat, "error", "expected-number", `${name} expects a numeric repeat count.`),
    );
  reportExtra(
    args,
    consumed + (repeat === undefined ? 0 : 1),
    diagnostics,
    `${name} has too many values.`,
  );
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

function validateOptionalSpeed(
  args: readonly Token[],
  diagnostics: Diagnostic[],
  positive = false,
): number {
  if (args[0]?.value !== "@") return 0;
  return 1 + validateDuration(args.slice(1), diagnostics, args[0], DURATION_UNITS, positive);
}

function validateDuration(
  args: readonly Token[],
  diagnostics: Diagnostic[],
  anchor: Token,
  allowedUnits: readonly string[] = DURATION_UNITS,
  positive = false,
): number {
  const number = args[0];
  if (number === undefined) {
    diagnostics.push(
      diagnostic(anchor, "error", "missing-duration", "A duration starts with a number."),
    );
    return 0;
  }
  if (number.kind !== "number" || !Number.isFinite(Number(number.value))) {
    diagnostics.push(
      diagnostic(number, "error", "invalid-duration", "A duration starts with a number."),
    );
    return 1;
  }
  if (positive && Number(number.value) <= 0)
    diagnostics.push(
      diagnostic(number, "error", "non-positive-duration", "A duration must be greater than zero."),
    );
  const unit = args[1];
  return unit !== undefined && allowedUnits.includes(unit.value) ? 2 : 1;
}

function validateSetting(
  name: string,
  value: Token,
  values: readonly Token[],
  diagnostics: Diagnostic[],
): void {
  const setting = SETTING_BY_NAME.get(name);
  if (setting === undefined) return;
  if (setting.value === "number") {
    if (value.kind !== "number" || !Number.isFinite(Number(value.value)))
      diagnostics.push(diagnostic(value, "error", "expected-number", `${name} expects a number.`));
    else if (INTEGER_SETTINGS.has(name) && !/^\d+$/u.test(value.value))
      diagnostics.push(
        diagnostic(value, "error", "expected-integer", `${name} expects a whole number.`),
      );
  }
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
  if (setting.value === "regex") validateRegexStructure(value, diagnostics);
  if (setting.value === "duration")
    validateDuration(
      values,
      diagnostics,
      value,
      name === "TypingSpeed" ? ["ms", "s"] : DURATION_UNITS,
    );
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
    (name === "TypingSpeed" ? (["ms", "s"] as readonly string[]) : DURATION_UNITS).includes(
      values[1].value,
    )
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
    if (
      output === undefined ||
      command.arguments.length !== 1 ||
      !["string", "word"].includes(output.kind)
    )
      continue;
    const path = output.value;
    const kind = path.endsWith(".mp4")
      ? "video/mp4"
      : path.endsWith(".webm")
        ? "video/webm"
        : [".txt", ".ascii", ".test"].some((extension) => path.endsWith(extension))
          ? "text"
          : path.endsWith("/")
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

function isVhsStringToken(token: Token | undefined): boolean {
  if (token === undefined) return false;
  if (token.kind === "string") return true;
  if (token.kind !== "word" || token.value === "-") return false;
  return (
    !COMMAND_BY_NAME.has(token.value) &&
    !SETTING_BY_NAME.has(token.value) &&
    !["true", "false", "em", "ms", "px", "s", "m"].includes(token.value)
  );
}

function hasFileExtension(path: string): boolean {
  const name = path.replaceAll("\\", "/").split("/").at(-1) ?? "";
  return name.lastIndexOf(".") >= 0;
}

function reportExtra(
  args: readonly Token[],
  consumed: number,
  diagnostics: Diagnostic[],
  message: string,
): void {
  const extra = args[consumed];
  if (extra !== undefined) diagnostics.push(diagnostic(extra, "error", "extra-argument", message));
}

function validateModifiedKey(
  name: string,
  nameToken: Token,
  args: readonly Token[],
  diagnostics: Diagnostic[],
): void {
  if (args.length < 2) {
    diagnostics.push(
      diagnostic(nameToken, "error", "missing-argument", `${name} expects + followed by a key.`),
    );
    return;
  }
  if (name !== "Ctrl") {
    if (args[0]?.value !== "+")
      diagnostics.push(
        diagnostic(
          args[0] ?? nameToken,
          "error",
          "missing-plus",
          `${name} expects + before the key.`,
        ),
      );
    const key = args[1];
    if (
      key !== undefined &&
      !isVhsStringToken(key) &&
      !["Enter", "Tab", "[", "]"].includes(key.value)
    )
      diagnostics.push(
        diagnostic(key, "error", "invalid-modified-key", `${name} does not support this key.`),
      );
    reportExtra(args, 2, diagnostics, `${name} expects one key.`);
    return;
  }

  let index = 0;
  let keySeen = false;
  while (index < args.length) {
    const plus = args[index];
    const key = args[index + 1];
    if (plus?.value !== "+") {
      diagnostics.push(
        diagnostic(plus ?? nameToken, "error", "missing-plus", "Ctrl expects + before each key."),
      );
      return;
    }
    if (key === undefined) {
      diagnostics.push(
        diagnostic(plus, "error", "missing-argument", "Ctrl expects a key after +."),
      );
      return;
    }
    if (["Alt", "Shift"].includes(key.value)) {
      if (keySeen)
        diagnostics.push(
          diagnostic(key, "error", "modifier-order", "Place Ctrl modifiers before other keys."),
        );
    } else {
      keySeen = true;
      const supported =
        (isVhsStringToken(key) && key.value.length === 1) ||
        [
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
        ].includes(key.value);
      if (!supported)
        diagnostics.push(
          diagnostic(key, "error", "invalid-modified-key", "Ctrl does not support this key."),
        );
    }
    index += 2;
  }
}

function validateRegexStructure(token: Token, diagnostics: Diagnostic[]): void {
  const pattern = token.value;
  let escaped = false;
  let inClass = false;
  let parentheses = 0;
  for (const character of pattern) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[" && !inClass) {
      inClass = true;
      continue;
    }
    if (character === "]" && inClass) {
      inClass = false;
      continue;
    }
    if (inClass) continue;
    if (character === "(") parentheses += 1;
    if (character === ")") parentheses -= 1;
    if (parentheses < 0) break;
  }
  if (escaped || inClass || parentheses !== 0)
    diagnostics.push(
      diagnostic(token, "error", "invalid-regex", "This regular expression is incomplete."),
    );
}
