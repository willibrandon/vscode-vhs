import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { githubReleaseFailures } from "./release-checks.mjs";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const changelog = await readFile(resolve(root, "CHANGELOG.md"), "utf8");
const expectedTag = `v${manifest.version}`;
const actualTag = process.env.GITHUB_REF_NAME ?? "";
const expectedExtensionId = "willibrandon.vhs";
const failures = [];

if (actualTag !== expectedTag)
  failures.push(`tag ${JSON.stringify(actualTag)} must equal ${expectedTag}`);
if (
  !new RegExp(`^## \\[${escapeRegex(manifest.version)}\\] - \\d{4}-\\d{2}-\\d{2}$`, "mu").test(
    changelog,
  )
) {
  failures.push(`CHANGELOG.md must contain a dated ${manifest.version} release heading`);
}
const extensionId = `${manifest.publisher}.${manifest.name}`;
if (expectedExtensionId !== extensionId)
  failures.push(`extension ID must be ${expectedExtensionId}`);
const { stdout: status } = await execute("git", ["status", "--porcelain"], { cwd: root });
if (status !== "") failures.push("release checkout is not clean");
try {
  const { stdout: tag } = await execute("git", ["describe", "--exact-match", "--tags", "HEAD"], {
    cwd: root,
  });
  if (tag.trim() !== expectedTag)
    failures.push(`HEAD is tagged ${tag.trim()}, expected ${expectedTag}`);
} catch {
  failures.push("HEAD does not have an exact release tag");
}

try {
  const { stdout: objectType } = await execute(
    "git",
    ["cat-file", "-t", `refs/tags/${expectedTag}`],
    { cwd: root },
  );
  if (objectType.trim() !== "tag") failures.push("release tag must be annotated");
} catch {
  failures.push("release tag object is unavailable");
}

if (process.env.GITHUB_ACTIONS === "true") {
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const { stdout: headOutput } = await execute("git", ["rev-parse", "HEAD"], { cwd: root });
  const head = headOutput.trim();
  if (!/^[^/]+\/[^/]+$/u.test(repository)) {
    failures.push("GITHUB_REPOSITORY is invalid");
  } else {
    try {
      const tagRef = await githubJson(`repos/${repository}/git/ref/tags/${expectedTag}`);
      const tagSha = tagRef?.object?.sha;
      const [tagObject, mainRef, workflows] = await Promise.all([
        typeof tagSha === "string"
          ? githubJson(`repos/${repository}/git/tags/${tagSha}`)
          : Promise.resolve(undefined),
        githubJson(`repos/${repository}/git/ref/heads/main`),
        githubJson(
          `repos/${repository}/actions/runs?head_sha=${head}&branch=main&status=completed&per_page=100`,
        ),
      ]);
      failures.push(
        ...githubReleaseFailures({
          head,
          mainRef,
          tagObject,
          tagRef,
          workflowRuns: workflows?.workflow_runs,
        }),
      );
    } catch (error) {
      failures.push(`GitHub release state could not be verified: ${safeError(error)}`);
    }
  }
}

if (failures.length > 0)
  throw new Error(`Release preconditions failed:\n- ${failures.join("\n- ")}`);
console.log(`Release preconditions passed for ${extensionId} ${manifest.version}.`);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function githubJson(path) {
  const { stdout } = await execute("gh", ["api", path], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout);
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n]+/gu, " ")
    .slice(0, 300);
}
