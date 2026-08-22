import { describe, expect, it } from "vitest";
import {
  artifactReferences,
  completionsAt,
  documentSymbols,
  hoverAt,
  parseVhs,
  versionDiagnostics,
} from "../src/index.js";

describe("language intelligence", () => {
  it("offers settings and all built-in themes from the registry", () => {
    const settingDocument = parseVhs("Set ");
    expect(
      completionsAt(settingDocument, settingDocument.text.length).map(({ label }) => label),
    ).toContain("WaitPattern");

    const themeDocument = parseVhs("Set Theme ");
    const themes = completionsAt(themeDocument, themeDocument.text.length);
    expect(themes).toHaveLength(349);
    expect(themes.some(({ label }) => label === "Charmbracelet")).toBe(true);
    expect(themes.map(({ label }) => label)).toContain("3024 Night");
  });

  it("shows behavior and defaults in hover documentation", () => {
    const document = parseVhs("Set TypingSpeed 50ms");
    expect(hoverAt(document, 5)?.markdown).toContain("Default: `50ms`");
    expect(hoverAt(document, 1)?.markdown).toContain("Changes a VHS recording setting");
    const type = parseVhs('Type "hello"');
    expect(hoverAt(type, 1)?.markdown).toContain("`Type[@<Duration>] <Text>`");
  });

  it("returns useful document symbols", () => {
    const document = parseVhs(
      "Set Width 1200 Source setup.tape Output demo.gif Screenshot ready.png",
    );
    expect(documentSymbols(document).map(({ detail }) => detail)).toEqual([
      "Width 1200",
      "setup.tape",
      "demo.gif",
      "ready.png",
    ]);
  });

  it("discovers every released output artifact class", () => {
    const document = parseVhs(
      "Output demo.gif Output demo.mp4 Output demo.webm Output demo.txt Output frames/ Screenshot shot.png",
    );
    expect(artifactReferences(document).map(({ kind }) => kind)).toEqual([
      "image",
      "video",
      "video",
      "text",
      "frames",
      "screenshot",
    ]);
  });

  it("warns when selected VHS is older than used syntax", () => {
    const document = parseVhs("ScrollUp 2 Enter");
    expect(versionDiagnostics(document, "0.10.0").map(({ code }) => code)).toEqual([
      "unsupported-version",
    ]);
    expect(versionDiagnostics(document, "0.11.0")).toEqual([]);
    expect(versionDiagnostics(document, "latest")).toEqual([]);
  });
});
