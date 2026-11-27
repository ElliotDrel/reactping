/* global console, process */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

const root = new URL("../", import.meta.url);
const source = await readFile(new URL("public/assets/favicon.svg", root), "utf8");
// PNG/ICO are fixed-color fallbacks; only the SVG follows the browser theme.
const light = source.replace(/<style>[\s\S]*?<\/style>/, "");
const artwork = /<g id="mark">([\s\S]*?)<\/g>/.exec(light)?.[1];
if (!artwork) throw new Error("favicon.svg must contain the mark group");
const square = light.replace('rx="8"', "");
const maskable = square.replace('<g id="mark">', '<g id="mark" transform="translate(4.8 4.8) scale(0.7)">');
const monochrome = (color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${artwork.replace(/(?:fill|stroke)="#[a-fA-F0-9]+"/g, (attr) => attr.replace(/#[a-fA-F0-9]+/, color))}</svg>\n`;
// The source viewBox is 32 units. Rasterize at 2x the target, then downsample;
// never enlarge a smaller bitmap if the source or density changes.
const png = (svg, size) =>
  sharp(Buffer.from(svg), { density: (72 * size * 2) / 32 })
    .resize(size, size, { withoutEnlargement: true })
    .png()
    .toBuffer();
const outputs = new Map();
outputs.set("public/assets/favicon-96x96.png", await png(light, 96));
for (const size of [152, 167, 180]) {
  const image = await png(square, size);
  outputs.set(
    size === 180 ? "public/apple-touch-icon.png" : `public/assets/apple-touch-icon-${size}x${size}.png`,
    image,
  );
  // Preserve the old public URL for cached pages and existing bookmarks.
  if (size === 180) outputs.set("public/assets/apple-touch-icon.png", image);
}
for (const size of [192, 512]) {
  outputs.set(`public/assets/icon-${size}x${size}.png`, await png(square, size));
  outputs.set(`public/assets/icon-maskable-${size}x${size}.png`, await png(maskable, size));
}
outputs.set("public/assets/logo-black.svg", Buffer.from(monochrome("#000000")));
outputs.set("public/assets/logo-white.svg", Buffer.from(monochrome("#ffffff")));
outputs.set("public/assets/icon-monochrome-512x512.png", await png(monochrome("#000000"), 512));

// Classic ICO DIB frames, including a 1-bit AND mask for older readers.
// BGRA pixels run bottom-to-top; the DIB height includes both color and mask planes.
const frames = [];
for (const size of [16, 32, 48, 64]) {
  const pixels = await sharp(await png(light, size))
    .ensureAlpha()
    .raw()
    .toBuffer();
  const maskStride = Math.ceil(size / 32) * 4;
  const frame = Buffer.alloc(40 + size * size * 4 + maskStride * size);
  frame.writeUInt32LE(40, 0);
  frame.writeInt32LE(size, 4);
  frame.writeInt32LE(size * 2, 8);
  frame.writeUInt16LE(1, 12);
  frame.writeUInt16LE(32, 14);
  frame.writeUInt32LE(size * size * 4, 20);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = 40 + ((size - y - 1) * size + x) * 4;
      frame[to] = pixels[from + 2];
      frame[to + 1] = pixels[from + 1];
      frame[to + 2] = pixels[from];
      frame[to + 3] = pixels[from + 3];
      if (pixels[from + 3] < 128) {
        const mask = 40 + size * size * 4 + (size - y - 1) * maskStride + Math.floor(x / 8);
        frame[mask] |= 0x80 >> (x % 8);
      }
    }
  }
  frames.push({ size, frame });
}
const directory = Buffer.alloc(6 + 16 * frames.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(frames.length, 4);
let offset = directory.length;
for (const [index, { size, frame }] of frames.entries()) {
  const entry = 6 + index * 16;
  directory[entry] = size;
  directory[entry + 1] = size;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(frame.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
}
outputs.set("public/favicon.ico", Buffer.concat([directory, ...frames.map(({ frame }) => frame)]));

// The production CSP must permit exactly the adaptive SVG's inline CSS.
const config = await readFile(new URL("vercel.json", root), "utf8");
const hash = createHash("sha256")
  .update(/<style>([\s\S]*?)<\/style>/.exec(source)[1])
  .digest("base64");
const updated = config.replace(/style-src 'self'(?: 'sha256-[^']+')?;/, "style-src 'self' 'sha256-" + hash + "';");
outputs.set("vercel.json", Buffer.from(updated));

const check = process.argv.includes("--check");
let stale = false;
for (const [path, data] of outputs) {
  const url = new URL(path, root);
  if (check) {
    const current = await readFile(url).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (!current?.equals(data)) {
      console.error(`Stale or missing icon: ${fileURLToPath(url)}. Run npm run icons:generate.`);
      stale = true;
    }
  } else {
    await writeFile(url, data);
  }
}
if (stale) process.exitCode = 1;
else console.log(`${check ? "Verified" : "Generated"} ${outputs.size} derived files from favicon.svg.`);
