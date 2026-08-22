import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

const outputLimit = 1_048_576;
const defaultTimeout = 900_000;

export interface VhsRunOptions {
  readonly arguments: readonly string[];
  readonly command: string;
  readonly cwd: string;
  readonly input?: string;
  readonly timeoutMs?: number;
}

export interface VhsRunResult {
  readonly cancelled: boolean;
  readonly code: number | null;
  readonly durationMs: number;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly stdout: string;
  readonly truncated: boolean;
}

export function runVhs(
  options: VhsRunOptions,
  signal: AbortSignal,
  isTrusted: () => boolean,
): Promise<VhsRunResult> {
  if (!isTrusted()) return Promise.reject(new Error("Trust this workspace before running VHS."));
  if (options.command.trim().length === 0)
    return Promise.reject(new Error("vhs.executablePath cannot be empty."));
  if (signal.aborted) {
    return Promise.resolve({
      cancelled: true,
      code: null,
      durationMs: 0,
      signal: null,
      stderr: "",
      stdout: "",
      truncated: false,
    });
  }
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let cancelled = false;
    let settled = false;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(options.command, [...options.arguments], {
        cwd: options.cwd,
        detached: process.platform !== "win32",
        shell: false,
        windowsHide: true,
        stdio: "pipe",
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const append = (current: string, chunk: Buffer): string => {
      if (current.length >= outputLimit) {
        truncated = true;
        return current;
      }
      const next = current + chunk.toString("utf8");
      if (next.length <= outputLimit) return next;
      truncated = true;
      return next.slice(0, outputLimit);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    const finish = (code: number | null, exitSignal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      resolve({
        cancelled,
        code,
        durationMs: Math.round(performance.now() - started),
        signal: exitSignal,
        stderr,
        stdout,
        truncated,
      });
    };

    const terminate = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          shell: false,
          stdio: "ignore",
          windowsHide: true,
        });
        killer.unref();
      } else if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
        const force = setTimeout(() => {
          try {
            if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }, 2_000);
        force.unref();
      }
    };

    const abort = (): void => {
      cancelled = true;
      terminate();
    };
    const timeout = setTimeout(abort, options.timeoutMs ?? defaultTimeout);
    timeout.unref();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted || !isTrusted()) abort();

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", finish);
    if (options.input === undefined) child.stdin.end();
    else child.stdin.end(options.input, "utf8");
  });
}
