import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runVhs } from "../src/runner.js";

describe("VHS process runner", () => {
  it("passes arguments literally and sends the unsaved tape through stdin", async () => {
    const source = 'Output "demo.gif"\nType "hello"\n';
    const script =
      "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd(),source:s})))";
    const result = await runVhs(
      {
        arguments: ["-e", script, "--", "-"],
        command: process.execPath,
        cwd: process.cwd(),
        input: source,
      },
      new AbortController().signal,
      () => true,
    );
    expect(result).toMatchObject({ cancelled: false, code: 0, truncated: false });
    expect(JSON.parse(result.stdout)).toMatchObject({ args: ["-"], cwd: process.cwd(), source });
  });

  it("refuses untrusted execution and empty executable paths", async () => {
    await expect(
      runVhs(
        { arguments: [], command: "vhs", cwd: process.cwd() },
        new AbortController().signal,
        () => false,
      ),
    ).rejects.toThrow("Trust this workspace");
    await expect(
      runVhs(
        { arguments: [], command: "", cwd: process.cwd() },
        new AbortController().signal,
        () => true,
      ),
    ).rejects.toThrow("cannot be empty");
  });

  it("does not spawn an already cancelled job", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runVhs(
        { arguments: [], command: "/missing/vhs", cwd: process.cwd() },
        controller.signal,
        () => true,
      ),
    ).resolves.toMatchObject({ cancelled: true, code: null });
  });

  it("reports missing executables and nonzero exits", async () => {
    await expect(
      runVhs(
        { arguments: [], command: join(tmpdir(), "missing-vhs"), cwd: process.cwd() },
        new AbortController().signal,
        () => true,
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const result = await runVhs(
      {
        arguments: ["-e", "process.stderr.write('bad tape');process.exit(7)"],
        command: process.execPath,
        cwd: process.cwd(),
      },
      new AbortController().signal,
      () => true,
    );
    expect(result).toMatchObject({ code: 7, stderr: "bad tape", stdout: "" });
  });

  it("cancels a process and its descendant", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vhs-runner-"));
    const ready = join(directory, "ready");
    const childPid = join(directory, "child.pid");
    const script =
      "const{spawn}=require('node:child_process'),{writeFileSync}=require('node:fs');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(process.argv[1],String(c.pid));writeFileSync(process.argv[2],'');setInterval(()=>{},1000)";
    const controller = new AbortController();
    const result = runVhs(
      { arguments: ["-e", script, childPid, ready], command: process.execPath, cwd: directory },
      controller.signal,
      () => true,
    );
    try {
      await waitForFile(ready);
      const pid = Number(await readFile(childPid, "utf8"));
      expect(Number.isSafeInteger(pid)).toBe(true);
      controller.abort();
      await expect(result).resolves.toMatchObject({ cancelled: true });
      await waitForExit(pid);
    } finally {
      controller.abort();
      await result.catch(() => undefined);
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("caps each output stream", async () => {
    const result = await runVhs(
      {
        arguments: [
          "-e",
          "process.stdout.write('x'.repeat(1200000));process.stderr.write('y'.repeat(1200000))",
        ],
        command: process.execPath,
        cwd: process.cwd(),
      },
      new AbortController().signal,
      () => true,
    );
    expect(result).toMatchObject({ code: 0, truncated: true });
    expect(result.stdout).toHaveLength(1_048_576);
    expect(result.stderr).toHaveLength(1_048_576);
  });

  it("stops a process at the configured timeout", async () => {
    const started = performance.now();
    const result = await runVhs(
      {
        arguments: ["-e", "setInterval(()=>{},1000)"],
        command: process.execPath,
        cwd: process.cwd(),
        timeoutMs: 25,
      },
      new AbortController().signal,
      () => true,
    );
    const elapsed = performance.now() - started;

    expect(result).toMatchObject({ cancelled: true, code: null, signal: "SIGTERM" });
    expect(result.durationMs).toBeGreaterThanOrEqual(20);
    expect(elapsed).toBeLessThan(200);
  });
});

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function waitForExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 10));
    } catch {
      return;
    }
  }
  throw new Error(`Process ${pid} was not terminated`);
}
