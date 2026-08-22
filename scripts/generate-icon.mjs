import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const source = await readFile(new URL("../media/icon.svg", import.meta.url));
const output = fileURLToPath(new URL("../media/icon.png", import.meta.url));
await sharp(source).resize(256, 256).png({ compressionLevel: 9, palette: true }).toFile(output);
