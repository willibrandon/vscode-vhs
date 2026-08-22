import { rm } from "node:fs/promises";

await Promise.all(
  ["coverage", "dist", "out", ".vscode-test", ".vscode-test-web"].map((path) =>
    rm(path, { force: true, recursive: true }),
  ),
);
