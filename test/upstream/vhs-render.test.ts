import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const renderEnabled = process.env["VHS_RENDER"] === "1";

describe.runIf(renderEnabled)("real VHS rendering", () => {
  it("renders a valid GIF with ttyd and ffmpeg", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vscode-vhs-render-"));
    const output = join(directory, "demo.gif");
    try {
      const result = await runVhs(
        directory,
        ["-"],
        [
          "Output demo.gif",
          "Set Shell bash",
          "Set Width 640",
          "Set Height 360",
          'Type "printf hello"',
          "Enter",
          "Sleep 200ms",
          "",
        ].join("\n"),
      );
      expect(result.code).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("Creating demo.gif");
      const bytes = await readFile(output);
      expect(bytes.subarray(0, 6).toString("ascii")).toMatch(/^GIF8[79]a$/u);
      expect((await stat(output)).size).toBeGreaterThan(1_000);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 60_000);
});

function runVhs(
  cwd: string,
  arguments_: readonly string[],
  input: string,
): Promise<{ readonly code: number | null; readonly stderr: string; readonly stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env["VHS_BIN"] ?? "vhs", arguments_, {
      cwd,
      env: { ...process.env, VHS_NO_SANDBOX: "1" },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stderr, stdout }));
    child.stdin.end(input);
  });
}
