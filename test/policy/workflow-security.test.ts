import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const workflowsDirectory = resolve(root, ".github/workflows");
const workflowNames = (await readdir(workflowsDirectory))
  .filter((name) => name.endsWith(".yml"))
  .sort();
const workflows = new Map(
  await Promise.all(
    workflowNames.map(
      async (name) => [name, await readFile(resolve(workflowsDirectory, name), "utf8")] as const,
    ),
  ),
);

function workflow(name: string): string {
  const contents = workflows.get(name);
  if (contents === undefined) throw new Error(`Missing workflow ${name}`);
  return contents;
}

describe("workflow supply-chain policy", () => {
  it("pins every external action to an immutable commit", () => {
    expect(workflows.size).toBeGreaterThan(0);
    for (const [name, contents] of workflows) {
      const actions = [...contents.matchAll(/^\s*uses:\s*([^\s#]+).*$/gmu)].map(
        ([, action]) => action,
      );
      expect(actions.length, `${name} has no auditable action references`).toBeGreaterThan(0);
      for (const action of actions) {
        expect(action, `${name}: ${action}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/u);
      }
    }
  });

  it("starts read-only and scopes write permissions to the jobs that need them", () => {
    for (const [name, contents] of workflows) {
      expect(contents, name).toMatch(/^permissions:\n {2}contents: read$/mu);
      expect(contents, name).not.toContain("pull_request_target:");
      if (name !== "docs.yml" && name !== "release.yml" && name !== "upstream-drift.yml") {
        expect(contents, name).not.toMatch(
          /^\s+(?:attestations|contents|id-token|issues|pages): write$/mu,
        );
      }
    }

    expect(workflow("docs.yml")).toContain(
      "permissions:\n      pages: write\n      id-token: write",
    );
    expect(workflow("release.yml")).toContain(
      "permissions:\n      attestations: write\n      contents: write\n      id-token: write",
    );
    expect(workflow("upstream-drift.yml")).toContain(
      "permissions:\n      contents: read\n      issues: write",
    );
  });

  it("disables persisted checkout credentials everywhere", () => {
    for (const [name, contents] of workflows) {
      const checkoutCount = [...contents.matchAll(/uses: actions\/checkout@/gu)].length;
      const disabledCredentialCount = [...contents.matchAll(/persist-credentials:\s*false/gu)]
        .length;
      expect(disabledCredentialCount, name).toBe(checkoutCount);
    }
  });

  it("keeps pull requests away from publishing credentials and deployment jobs", () => {
    expect(workflow("release.yml")).toContain('tags: ["v*.*.*"]');
    expect(workflow("release.yml")).not.toContain("pull_request:");
    expect(workflow("docs.yml")).toContain(
      "if: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}",
    );
    for (const [name, contents] of workflows) {
      if (name === "release.yml") continue;
      expect(contents, name).not.toContain("secrets.VSCE_PAT");
      expect(contents, name).not.toContain("secrets.OVSX_PAT");
    }
  });

  it("keeps security review and dependency updates enabled", async () => {
    expect(workflow("dependency-review.yml")).toContain("fail-on-severity: moderate");
    expect(workflow("codeql.yml")).toContain("queries: security-and-quality");

    const dependabot = await readFile(resolve(root, ".github/dependabot.yml"), "utf8");
    for (const ecosystem of ["npm", "github-actions", "docker"]) {
      expect(dependabot).toContain(`package-ecosystem: ${ecosystem}`);
    }
  });
});
