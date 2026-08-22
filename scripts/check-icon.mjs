import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

const svg = await readFile(new URL("../media/icon.svg", import.meta.url));
const expected = await sharp(svg)
  .resize(256, 256)
  .png({ compressionLevel: 9, palette: true })
  .toBuffer();
const actual = await readFile(new URL("../media/icon.png", import.meta.url));
assert.deepEqual(actual, expected, "media/icon.png must be generated from media/icon.svg");
