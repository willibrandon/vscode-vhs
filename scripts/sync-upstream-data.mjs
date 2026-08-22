import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const upstream = process.env.VHS_UPSTREAM ?? resolve(root, "../vhs");
const treeSitter = process.env.TREE_SITTER_VHS_UPSTREAM ?? resolve(root, "../tree-sitter-vhs");
const themes = JSON.parse(await readFile(resolve(upstream, "themes.json"), "utf8"));

if (!Array.isArray(themes) || themes.length === 0) {
  throw new Error("The VHS theme registry is empty");
}

const names = themes.map((theme) => {
  if (typeof theme?.name !== "string" || theme.name.length === 0) {
    throw new Error("Every VHS theme must have a name");
  }
  return theme.name;
});

await mkdir(resolve(root, "data"), { recursive: true });
await writeFile(
  resolve(root, "data/themes.json"),
  `${JSON.stringify({ source: "vhs/themes.json", count: names.length, names }, null, 2)}\n`,
  "utf8",
);

const vhsFixtures = resolve(root, "test/fixtures/upstream/vhs");
const treeSitterFixtures = resolve(root, "test/fixtures/upstream/tree-sitter-vhs");
await mkdir(vhsFixtures, { recursive: true });
await mkdir(treeSitterFixtures, { recursive: true });
await copyFile(resolve(upstream, "examples/fixtures/all.tape"), resolve(vhsFixtures, "all.tape"));
for (const name of ["all.txt", "commands.txt", "comments.txt", "examples.txt"]) {
  await copyFile(resolve(treeSitter, "test/corpus", name), resolve(treeSitterFixtures, name));
}
