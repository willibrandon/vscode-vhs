import { describe, expect, it } from "vitest";
import { lexVhs } from "../src/lexer.js";

describe("lexVhs", () => {
  it("lexes every value form without losing its source range", () => {
    const text =
      'Type "hello" Copy `world` Set WaitPattern /foo\\/bar/ Set Theme {"background":"#000000"} # note\nEnter';
    const result = lexVhs(text);

    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.map(({ kind, value }) => [kind, value])).toEqual([
      ["word", "Type"],
      ["string", "hello"],
      ["word", "Copy"],
      ["string", "world"],
      ["word", "Set"],
      ["word", "WaitPattern"],
      ["regex", "foo\\/bar"],
      ["word", "Set"],
      ["word", "Theme"],
      ["json", '{"background":"#000000"}'],
      ["comment", " note"],
      ["word", "Enter"],
    ]);
    for (const token of result.tokens)
      expect(text.slice(token.startOffset, token.endOffset)).toBe(token.raw);
    expect(result.tokens.at(-1)?.lineBreakBefore).toBe(true);
  });

  it("reports unterminated strings, regexes, and JSON with exact codes", () => {
    expect(lexVhs('Type "broken').diagnostics.map(({ code }) => code)).toEqual([
      "unterminated-string",
    ]);
    expect(lexVhs("Wait /broken").diagnostics.map(({ code }) => code)).toEqual([
      "unterminated-regex",
    ]);
    expect(lexVhs('Set Theme {"background":"black"').diagnostics.map(({ code }) => code)).toEqual([
      "unterminated-json",
    ]);
  });

  it("counts CRLF as one line break", () => {
    const enter = lexVhs("Sleep 1s\r\nEnter").tokens.at(-1);
    expect(enter?.start).toEqual({ line: 1, character: 0 });
  });
});
