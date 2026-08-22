import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { parseVhs } from "@vhs/language-core";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);
const vhs = process.env["VHS_BIN"] ?? "vhs";
const root = resolve(import.meta.dirname, "../..");

describe("official VHS 0.11.0 conformance", () => {
  it("accepts the complete official command fixture internally and with vhs validate", async () => {
    const path = resolve(root, "test/fixtures/upstream/vhs/all.tape");
    const source = await readFile(path, "utf8");
    expect(parseVhs(source).diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
    await expect(
      execute(vhs, ["validate", path], { cwd: root, timeout: 30_000 }),
    ).resolves.toMatchObject({ stderr: "" });
  });

  it("matches the released parser for newer commands and same-line command sequences", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vhs-conformance-"));
    const path = join(directory, "complete.tape");
    const sourcePath = join(directory, "setup.tape");
    const source = `Output "demo.gif"
Set WaitTimeout 15s
Set WaitPattern /ready\\/now/
Set CursorBlink true
Env DEMO "yes"
Require echo
Source "setup.tape"
Type "one" Sleep 500ms Enter Hide Ctrl+Shift+Right Show
Wait+Screen@2s /ready/
ScrollUp 2 ScrollDown 2
Copy "value" Paste
Screenshot "ready.png"
`;
    try {
      await writeFile(sourcePath, 'Type "setup"\n', "utf8");
      await writeFile(path, source, "utf8");
      expect(parseVhs(source).diagnostics.filter(({ severity }) => severity === "error")).toEqual(
        [],
      );
      await expect(
        execute(vhs, ["validate", path], { cwd: directory, timeout: 30_000 }),
      ).resolves.toMatchObject({ stderr: "" });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects the same malformed tape as the released parser", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vhs-invalid-"));
    const path = join(directory, "invalid.tape");
    const source = "Set CursorBlink maybe\nScreenshot shot.jpg\n";
    try {
      await writeFile(path, source, "utf8");
      expect(
        parseVhs(source)
          .diagnostics.filter(({ severity }) => severity === "error")
          .map(({ code }) => code),
      ).toEqual(["expected-boolean", "screenshot-extension"]);
      await expect(
        execute(vhs, ["validate", path], { cwd: directory, timeout: 30_000 }),
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("matches released duration, Wait, modifier, and output edge cases", async () => {
    const accepted = `Sleep 0
Sleep 0m
Set TypingSpeed 0ms
Set WaitTimeout 0m
Set WaitPattern /(?P<ready>ready)/
Type@0m "ready"
Enter@0ms 0
ScrollDown@0ms 0
Wait+Screen@1ms /(?P<ready>ready)/
Env NAME.WITH.DOTS "value"
Output demo.MP4
`;
    await expectBoth(accepted, true);

    for (const rejected of [
      "Wait@0ms",
      "Wait+Window",
      "Wait@nope",
      "Wait /[/",
      "Set WaitPattern /[/",
      "Set TypingSpeed 1m",
      "Sleep nope",
      "Type@1s",
      "Copy 10",
      "Enter nope",
      "Ctrl+Shift+C+Alt",
      "Alt+Space",
      "Shift+Space",
      "Output frames",
      "Output folder.name/frames",
      "Output 123.gif",
      "Screenshot shot.PNG",
      "Source setup.txt",
      "Env NAME 10",
    ])
      await expectBoth(`${rejected}\n`, false);
  });

  it("validates Source paths from the process working directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vhs-source-cwd-"));
    const tapeDirectory = join(directory, "vhs");
    const tape = join(tapeDirectory, "demo.tape");
    try {
      await mkdir(tapeDirectory);
      await writeFile(join(tapeDirectory, "setup.tape"), 'Type "setup"\n', "utf8");
      await writeFile(tape, "Source vhs/setup.tape\n", "utf8");
      await expect(
        execute(vhs, ["validate", tape], { cwd: directory, timeout: 30_000 }),
      ).resolves.toMatchObject({ stderr: "" });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

async function expectBoth(source: string, accepted: boolean): Promise<void> {
  const internal = parseVhs(source).diagnostics.filter(({ severity }) => severity === "error");
  expect(internal.length === 0, source.trim()).toBe(accepted);

  const directory = await mkdtemp(join(tmpdir(), "vhs-case-"));
  const path = join(directory, "case.tape");
  try {
    await writeFile(path, source, "utf8");
    let official = true;
    try {
      await execute(vhs, ["validate", path], { cwd: directory, timeout: 30_000 });
    } catch {
      official = false;
    }
    expect(official, source.trim()).toBe(accepted);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
