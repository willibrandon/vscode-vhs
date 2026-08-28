import { describe, expect, it } from "vitest";
import { GitIgnoreRules } from "../src/git-ignore.js";

describe("workspace Git ignore rules", () => {
  it("excludes root artifact directories without matching path prefixes", () => {
    const rules = new GitIgnoreRules([{ contents: "artifacts/\n", directory: "" }]);

    expect(rules.ignores("artifacts/demo.tape")).toBe(true);
    expect(rules.ignores("artifacts", true)).toBe(true);
    expect(rules.ignores("artifacts-copy/demo.tape")).toBe(false);
  });

  it("lets a nested ignore file override a file rule inherited from the root", () => {
    const rules = new GitIgnoreRules([
      { contents: "*.tape\n", directory: "" },
      { contents: "!keep.tape\n", directory: "tapes" },
    ]);

    expect(rules.ignores("other.tape")).toBe(true);
    expect(rules.ignores("tapes/other.tape")).toBe(true);
    expect(rules.ignores("tapes/keep.tape")).toBe(false);
  });

  it("does not read a nested ignore file below an excluded parent", () => {
    const rules = new GitIgnoreRules([
      { contents: "artifacts/\n", directory: "" },
      { contents: "!demo.tape\n", directory: "artifacts" },
    ]);

    expect(rules.ignores("artifacts/demo.tape")).toBe(true);
  });

  it("supports anchored patterns, comments, escapes, and Windows separators", () => {
    const rules = new GitIgnoreRules([
      {
        contents: "/generated.tape\n# comment\n\\#demo.tape\n",
        directory: "",
      },
    ]);

    expect(rules.ignores("generated.tape")).toBe(true);
    expect(rules.ignores("nested/generated.tape")).toBe(false);
    expect(rules.ignores("#demo.tape")).toBe(true);
    expect(rules.ignores("nested\\demo.tape")).toBe(false);
  });
});
