import type { Diagnostic, Position, Token, TokenKind } from "./types.js";

interface ScanResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
}

const position = (line: number, character: number): Position => ({ line, character });

const decodeQuoted = (raw: string): string => (raw.length >= 2 ? raw.slice(1, -1) : "");

export function lexVhs(text: string): ScanResult {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let offset = 0;
  let line = 0;
  let character = 0;
  let lineBreakBefore = false;

  const advance = (): string => {
    const current = text[offset] ?? "";
    offset += 1;
    if (current === "\n") {
      line += 1;
      character = 0;
    } else {
      character += 1;
    }
    return current;
  };

  const addToken = (
    kind: TokenKind,
    startOffset: number,
    startLine: number,
    startCharacter: number,
    value: string,
    quoted: boolean,
    terminated = true,
  ): void => {
    tokens.push({
      kind,
      raw: text.slice(startOffset, offset),
      value,
      quoted,
      lineBreakBefore,
      terminated,
      startOffset,
      endOffset: offset,
      start: position(startLine, startCharacter),
      end: position(line, character),
    });
    lineBreakBefore = false;
  };

  while (offset < text.length) {
    const current = text[offset] ?? "";
    if (/\s/u.test(current)) {
      if (advance() === "\n") lineBreakBefore = true;
      continue;
    }

    const startOffset = offset;
    const startLine = line;
    const startCharacter = character;

    if (current === "#") {
      while (offset < text.length && text[offset] !== "\n" && text[offset] !== "\r") advance();
      addToken(
        "comment",
        startOffset,
        startLine,
        startCharacter,
        text.slice(startOffset + 1, offset),
        false,
      );
      continue;
    }

    if (current === '"' || current === "'" || current === "`") {
      const quote = advance();
      let terminated = false;
      while (offset < text.length) {
        const next = text[offset] ?? "";
        if (next === quote) {
          advance();
          terminated = true;
          break;
        }
        if (next === "\n" || next === "\r") break;
        advance();
      }
      const raw = text.slice(startOffset, offset);
      addToken(
        "string",
        startOffset,
        startLine,
        startCharacter,
        terminated ? decodeQuoted(raw) : raw.slice(1),
        true,
        terminated,
      );
      if (!terminated) {
        diagnostics.push({
          severity: "error",
          code: "unterminated-string",
          message: "Close this string before the end of the line.",
          startOffset,
          endOffset: offset,
          start: position(startLine, startCharacter),
          end: position(line, character),
        });
      }
      continue;
    }

    if (current === "/") {
      advance();
      let backslashes = 0;
      let terminated = false;
      while (offset < text.length) {
        const next = text[offset] ?? "";
        if (next === "\n" || next === "\r") break;
        if (next === "/" && backslashes % 2 === 0) {
          advance();
          terminated = true;
          break;
        }
        backslashes = next === "\\" ? backslashes + 1 : 0;
        advance();
      }
      const raw = text.slice(startOffset, offset);
      addToken(
        "regex",
        startOffset,
        startLine,
        startCharacter,
        terminated ? raw.slice(1, -1) : raw.slice(1),
        false,
        terminated,
      );
      if (!terminated) {
        diagnostics.push({
          severity: "error",
          code: "unterminated-regex",
          message: "Close this regular expression with / before the end of the line.",
          replacement: `"${raw.replaceAll('"', '\\"')}"`,
          startOffset,
          endOffset: offset,
          start: position(startLine, startCharacter),
          end: position(line, character),
        });
      }
      continue;
    }

    if (current === "{") {
      let depth = 0;
      let quote = "";
      let escaped = false;
      do {
        const next = text[offset] ?? "";
        advance();
        if (quote !== "") {
          if (escaped) escaped = false;
          else if (next === "\\") escaped = true;
          else if (next === quote) quote = "";
        } else if (next === '"') quote = next;
        else if (next === "{") depth += 1;
        else if (next === "}") depth -= 1;
      } while (offset < text.length && depth > 0);
      const raw = text.slice(startOffset, offset);
      addToken("json", startOffset, startLine, startCharacter, raw, false, depth === 0);
      if (depth !== 0) {
        diagnostics.push({
          severity: "error",
          code: "unterminated-json",
          message: "Close this JSON object with }.",
          startOffset,
          endOffset: offset,
          start: position(startLine, startCharacter),
          end: position(line, character),
        });
      }
      continue;
    }

    if ("@+=[]%^\\".includes(current)) {
      advance();
      addToken("symbol", startOffset, startLine, startCharacter, current, false);
      continue;
    }

    if (/\d/u.test(current) || (current === "." && /\d/u.test(text[offset + 1] ?? ""))) {
      while (offset < text.length && /[\d.]/u.test(text[offset] ?? "")) advance();
      const raw = text.slice(startOffset, offset);
      addToken("number", startOffset, startLine, startCharacter, raw, false);
      continue;
    }

    while (offset < text.length && !/[\s#@+=[\]%^\\{}'"`]/u.test(text[offset] ?? "")) advance();
    if (offset === startOffset) advance();
    const raw = text.slice(startOffset, offset);
    addToken("word", startOffset, startLine, startCharacter, raw, false);
  }

  return { tokens, diagnostics };
}
