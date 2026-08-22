import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  WorkspaceIndex,
  relativeSourcePath,
  sourceCycle,
  sourceOccurrences,
  sourceTarget,
} from "../src/workspace-index.js";

describe("VHS workspace source index", () => {
  it("merges dirty open documents over saved workspace snapshots", () => {
    const index = new WorkspaceIndex();
    index.replace([{ text: 'Type "saved"', uri: "file:///workspace/main.tape" }]);
    const open = TextDocument.create("file:///workspace/main.tape", "vhs", 2, 'Type "dirty"');
    expect(index.merged([open]).get(open.uri)?.text).toBe('Type "dirty"');
  });

  it("resolves sources and finds all references to the same tape", () => {
    const index = new WorkspaceIndex();
    index.replace([
      { text: "Source parts/setup.tape", uri: "file:///workspace/main.tape" },
      { text: "Source setup.tape", uri: "file:///workspace/parts/other.tape" },
      { text: 'Type "ready"', uri: "file:///workspace/parts/setup.tape" },
    ]);
    const occurrences = sourceOccurrences(index.merged([]));
    expect(occurrences.map(({ target }) => target)).toEqual([
      "file:///workspace/parts/setup.tape",
      "file:///workspace/parts/setup.tape",
    ]);
    expect(sourceTarget("file:///workspace/main.tape", "parts/setup.tape")).toBe(
      "file:///workspace/parts/setup.tape",
    );
  });

  it("detects source cycles without treating a missing target as a cycle", () => {
    const cyclic = new WorkspaceIndex();
    cyclic.replace([
      { text: "Source b.tape", uri: "file:///workspace/a.tape" },
      { text: "Source a.tape", uri: "file:///workspace/b.tape" },
    ]);
    expect(sourceCycle(cyclic.merged([]), "file:///workspace/a.tape")).toBe(true);

    const missing = new WorkspaceIndex();
    missing.replace([{ text: "Source missing.tape", uri: "file:///workspace/a.tape" }]);
    expect(sourceCycle(missing.merged([]), "file:///workspace/a.tape")).toBe(false);
  });

  it("computes portable paths for file rename edits", () => {
    expect(
      relativeSourcePath(
        "file:///workspace/tapes/main.tape",
        "file:///workspace/shared/setup.tape",
      ),
    ).toBe("../shared/setup.tape");
    expect(
      relativeSourcePath("file:///workspace/main.tape", "vscode-vfs://github/setup.tape"),
    ).toBeUndefined();
  });
});
