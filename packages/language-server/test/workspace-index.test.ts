import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  WorkspaceIndex,
  relativeSourcePath,
  sourceCycle,
  sourceOccurrences,
  sourceTarget,
  workspaceDirectory,
} from "../src/workspace-index.js";

describe("VHS workspace source index", () => {
  it("merges dirty open documents over saved workspace snapshots", () => {
    const index = new WorkspaceIndex();
    index.replace([{ text: 'Type "saved"', uri: "file:///workspace/main.tape" }]);
    const open = TextDocument.create("file:///workspace/main.tape", "vhs", 2, 'Type "dirty"');
    expect(index.merged([open]).get(open.uri)?.text).toBe('Type "dirty"');
  });

  it("tracks confirmed missing files separately from files omitted by indexing limits", () => {
    const index = new WorkspaceIndex();
    index.replace([], ["file:///workspace/missing.tape"]);
    expect(index.isMissing("file:///workspace/missing.tape")).toBe(true);
    expect(index.isMissing("file:///workspace/skipped.tape")).toBe(false);
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

  it("uses the containing workspace folder as VHS working directory", () => {
    const roots = ["file:///workspace"];
    const source = "file:///workspace/vhs/demo.tape";
    expect(workspaceDirectory(source, roots).toString()).toBe("file:///workspace");
    expect(sourceTarget(source, "vhs/setup.tape", roots)).toBe("file:///workspace/vhs/setup.tape");
    expect(relativeSourcePath(source, "file:///workspace/shared/setup.tape", roots)).toBe(
      "shared/setup.tape",
    );
  });

  it("uses the deepest workspace root and supports absolute paths", () => {
    const source = "file:///workspace/project/vhs/demo.tape";
    const roots = ["file:///workspace", "file:///workspace/project"];
    expect(workspaceDirectory(source, roots).toString()).toBe("file:///workspace/project");
    expect(sourceTarget(source, "/tmp/setup.tape", roots)).toBe("file:///tmp/setup.tape");
  });
});
