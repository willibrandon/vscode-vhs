import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const lock = JSON.parse(await readFile(resolve(root, "data/upstream-lock.json"), "utf8"));
const vhs = process.env.VHS_UPSTREAM ?? resolve(root, "../vhs");
const treeSitter = process.env.TREE_SITTER_VHS_UPSTREAM ?? resolve(root, "../tree-sitter-vhs");

const revision = (path) =>
  execFileSync("git", ["-C", path, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.equal(revision(vhs), lock.vhs.commit, "VHS source does not match data/upstream-lock.json");
assert.equal(
  revision(treeSitter),
  lock.treeSitterVhs.commit,
  "tree-sitter-vhs source does not match data/upstream-lock.json",
);

const themes = JSON.parse(await readFile(resolve(root, "data/themes.json"), "utf8"));
assert.equal(themes.count, 348, "The reviewed VHS theme count changed");
assert.equal(themes.names.length, themes.count, "Theme count does not match generated names");
