import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { COMMANDS, SETTINGS } from "@vhs/language-core";
import { describe, expect, it } from "vitest";
import { loadGrammar, tokenAt } from "./tokenize.js";

const root = resolve(import.meta.dirname, "../..");

describe("packaged VHS grammar", () => {
  it("highlights released VHS syntax with useful scopes", async () => {
    const grammar = await loadGrammar("source.vhs");
    const source = `# Demo
Output "demo.gif"
Set Theme {"background":"#171717"}
Set TypingSpeed 50ms
Env API_URL "https://example.test"
Type@20ms "hello" Sleep 500ms Enter
Wait+Screen@15s /ready\\/now/
Ctrl+Alt+Shift+Right
Screenshot "ready.png"
`;
    expect(scopesAt(grammar, source, 0, "#")).toContain("comment.line.number-sign.vhs");
    expect(scopesAt(grammar, source, 1, "Output")).toContain("keyword.control.vhs");
    expect(scopesAt(grammar, source, 1, "demo.gif")).toContain("string.quoted.double.vhs");
    expect(scopesAt(grammar, source, 2, "Theme")).toContain("support.type.property-name.vhs");
    expect(scopesAt(grammar, source, 2, '"background"')).toContain("string.quoted.double.json");
    expect(scopesAt(grammar, source, 3, "50")).toContain("constant.numeric.vhs");
    expect(scopesAt(grammar, source, 3, "ms")).toContain("keyword.other.unit.vhs");
    expect(scopesAt(grammar, source, 4, "API_URL")).toContain("variable.other.environment.vhs");
    expect(scopesAt(grammar, source, 6, "ready")).toContain("string.regexp.vhs");
    expect(scopesAt(grammar, source, 7, "Ctrl")).toContain("storage.modifier.vhs");
  });

  it("injects syntax into vhs and tape Markdown fences", async () => {
    const grammar = await loadGrammar("source.vhs.markdown");
    for (const fence of ["vhs", "tape"]) {
      const source = `\`\`\`${fence}\nOutput "demo.gif"\n\`\`\`\n`;
      expect(scopesAt(grammar, source, 1, "Output")).toContain("keyword.control.vhs");
    }
  });

  it("keeps command and setting patterns synchronized with the registry", async () => {
    const grammar = JSON.parse(
      await readFile(resolve(root, "syntaxes/vhs.tmLanguage.json"), "utf8"),
    ) as GrammarShape;
    const commands = new RegExp(grammar.repository.commands.patterns[0]?.match ?? "", "u");
    const settings = new RegExp(grammar.repository.set.patterns[0]?.match ?? "", "u");
    for (const { name } of COMMANDS) expect(commands.test(name)).toBe(true);
    for (const { name } of SETTINGS) expect(settings.test(`Set ${name}`)).toBe(true);
  });

  it("uses VS Code's current line-comment configuration shape", async () => {
    const configuration = JSON.parse(
      await readFile(resolve(root, "language-configuration.json"), "utf8"),
    ) as LanguageConfiguration;
    expect(configuration.comments.lineComment).toEqual({ comment: "#", noIndent: false });
  });
});

function scopesAt(
  grammar: Awaited<ReturnType<typeof loadGrammar>>,
  source: string,
  line: number,
  needle: string,
): readonly string[] {
  const text = source.split("\n")[line] ?? "";
  return tokenAt(grammar, source, line, text.indexOf(needle)).scopes;
}

interface GrammarShape {
  readonly repository: {
    readonly commands: { readonly patterns: readonly Readonly<{ readonly match?: string }>[] };
    readonly set: { readonly patterns: readonly Readonly<{ readonly match?: string }>[] };
  };
}

interface LanguageConfiguration {
  readonly comments: {
    readonly lineComment: { readonly comment: string; readonly noIndent: boolean };
  };
}
