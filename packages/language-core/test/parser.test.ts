import { describe, expect, it } from "vitest";
import { COMMANDS, SETTINGS, parseVhs } from "../src/index.js";

describe("parseVhs", () => {
  it("recognizes every released VHS 0.11.0 command", () => {
    const examples: Readonly<Record<string, string>> = {
      Set: "Set Width 1200",
      Sleep: "Sleep 1s",
      Type: 'Type "hello"',
      Enter: "Enter",
      Space: "Space",
      Backspace: "Backspace",
      Delete: "Delete",
      Insert: "Insert",
      Ctrl: "Ctrl+Shift+A",
      Alt: "Alt+Tab",
      Shift: "Shift+Enter",
      Down: "Down",
      Left: "Left",
      Right: "Right",
      Up: "Up",
      PageUp: "PageUp",
      PageDown: "PageDown",
      ScrollUp: "ScrollUp 2",
      ScrollDown: "ScrollDown 2",
      Tab: "Tab",
      Escape: "Escape",
      Hide: "Hide",
      Require: "Require curl",
      Show: "Show",
      Output: "Output demo.gif",
      Wait: "Wait+Screen@2s /ready/",
      Source: "Source setup.tape",
      Screenshot: "Screenshot ready.png",
      Copy: 'Copy "hello"',
      Paste: "Paste",
      Env: 'Env NAME "value"',
    };

    expect(Object.keys(examples).sort()).toEqual(COMMANDS.map(({ name }) => name).sort());
    for (const [name, source] of Object.entries(examples)) {
      const document = parseVhs(source);
      expect(
        document.commands.map((command) => command.name),
        name,
      ).toContain(name);
      expect(
        document.diagnostics.filter(({ severity }) => severity === "error"),
        name,
      ).toEqual([]);
    }
  });

  it("recognizes every released setting without duplicate-setting warnings", () => {
    const values: Readonly<Record<string, string>> = {
      Shell: "bash",
      FontFamily: '"JetBrains Mono"',
      MarginFill: '"#112233"',
      Margin: "10",
      WindowBar: "Rings",
      WindowBarSize: "30",
      BorderRadius: "8",
      FontSize: "22",
      Framerate: "60",
      Height: "600",
      LetterSpacing: "1",
      LineHeight: "1.2",
      PlaybackSpeed: "1",
      TypingSpeed: "50ms",
      Padding: "60",
      Theme: '"3024 Night"',
      Width: "1200",
      LoopOffset: "20%",
      WaitTimeout: "15s",
      WaitPattern: "/>$/",
      CursorBlink: "true",
    };
    expect(Object.keys(values).sort()).toEqual(SETTINGS.map(({ name }) => name).sort());
    const text = Object.entries(values)
      .map(([name, value]) => `Set ${name} ${value}`)
      .join("\n");
    const document = parseVhs(`${text}\nSet Width 900`);
    expect(document.commands).toHaveLength(SETTINGS.length + 1);
    expect(document.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
    expect(document.diagnostics.find(({ code }) => code.includes("duplicate"))).toBeUndefined();
  });

  it("matches official whitespace behavior with several commands on one line", () => {
    const document = parseVhs('Type "one" Sleep 500ms Enter Hide Ctrl+C Show');
    expect(document.commands.map(({ name }) => name)).toEqual([
      "Type",
      "Sleep",
      "Enter",
      "Hide",
      "Ctrl",
      "Show",
    ]);
    expect(document.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
  });

  it("does not treat a newline as a command boundary", () => {
    const document = parseVhs("Type\nhello\nEnter");
    expect(document.commands.map(({ name }) => name)).toEqual(["Type", "Enter"]);
    expect(document.diagnostics.map(({ code }) => code)).toContain("bare-text-continuation");
  });

  it("reports paths that VHS requires developers to quote", () => {
    const numeric = parseVhs("Output 123.gif").diagnostics.find(
      ({ code }) => code === "quote-path",
    );
    const absolute = parseVhs("Output /tmp/demo.gif").diagnostics.find(
      ({ code }) => code === "quote-path",
    );
    expect(numeric?.replacement).toBe('"123.gif"');
    expect(absolute?.replacement).toBe('"/tmp/demo.gif"');
  });

  it("reports ignored late settings while allowing late TypingSpeed", () => {
    const document = parseVhs('Type "go" Set Width 900 Set TypingSpeed 10ms Require git');
    expect(document.diagnostics.map(({ code }) => code)).toEqual(["late-setting", "late-require"]);
  });

  it("validates values and source-related syntax", () => {
    const document = parseVhs(
      "Set Shell nope Set CursorBlink maybe Source part.txt Screenshot shot.jpg Output frames",
    );
    expect(document.diagnostics.map(({ code }) => code)).toEqual([
      "invalid-shell",
      "expected-boolean",
      "source-extension",
      "screenshot-extension",
      "frame-directory-slash",
    ]);
  });

  it("warns when later outputs replace the same artifact class", () => {
    const document = parseVhs(
      "Output first.gif Output second.unknown Output first.txt Output second.ascii",
    );
    expect(document.diagnostics.filter(({ code }) => code === "shadowed-output")).toHaveLength(2);
  });
});
