export const requiredMainWorkflows = ["CI", "CodeQL", "Development container", "Docs"];

export function githubReleaseFailures({ head, mainRef, tagObject, tagRef, workflowRuns }) {
  const failures = [];
  if (tagRef?.object?.type !== "tag") failures.push("release tag is not annotated");
  if (tagObject?.object?.sha !== head) failures.push("release tag does not point to HEAD");
  if (mainRef?.object?.sha !== head) failures.push("release commit is not the current main head");

  const latestByName = new Map();
  for (const run of workflowRuns ?? []) {
    if (
      run?.head_branch !== "main" ||
      run?.head_sha !== head ||
      run?.event !== "push" ||
      typeof run?.name !== "string"
    ) {
      continue;
    }
    const existing = latestByName.get(run.name);
    if (existing === undefined || Number(run.id ?? 0) > Number(existing.id ?? 0)) {
      latestByName.set(run.name, run);
    }
  }
  for (const name of requiredMainWorkflows) {
    const run = latestByName.get(name);
    if (run?.conclusion !== "success") {
      failures.push(`${name} workflow has not passed on main`);
    }
  }
  return failures;
}
