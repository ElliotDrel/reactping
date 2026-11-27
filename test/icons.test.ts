import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import sharp from "sharp";
import { resultPage } from "../src/pages.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const source = read("public/assets/favicon.svg").toString();
const manifest = JSON.parse(read("public/site.webmanifest").toString()) as {
  start_url: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};

describe("website icons", () => {
  it("serves the same complete icon set on every built page and standalone result", async () => {
    const built = new URL(".next/server/app/", root);
    const pages = readdirSync(built).filter(
      (file) => file.endsWith(".html") && (!file.startsWith("_") || file === "_not-found.html"),
    );
    const html = pages.map((file) => readFileSync(new URL(file, built), "utf8"));
    for (const outcome of [
      "connected",
      "cancelled",
      "expired",
      "failed",
      "enterprise",
      "scopes",
      "feedback",
    ] as const) {
      html.push(await resultPage(outcome, 200, "").text());
    }
    for (const page of html) {
      const head = page.split("</head>")[0]!;
      assert.match(head, /rel="icon" href="\/favicon\.ico"/);
      assert.match(head, /rel="icon" href="\/assets\/favicon\.svg"/);
      assert.match(head, /rel="apple-touch-icon" href="\/apple-touch-icon\.png" sizes="180x180"/);
      assert.match(head, /rel="mask-icon" href="\/assets\/logo-black\.svg" color="#1f4bff"/);
      assert.match(head, /rel="manifest" href="\/site\.webmanifest"/);
      for (const tag of head.match(/<link\b[^>]*>/g) ?? []) {
        if (!/rel="(?:icon|apple-touch-icon|mask-icon|manifest)"/.test(tag)) continue;
        const href = /href="([^"]+)"/.exec(tag)![1]!;
        assert.ok(read(`public${href}`).length > 0, `missing linked asset ${href}`);
      }
    }
  });

  it("declares real square PNGs for Apple and Android, with opaque full-bleed color icons", async () => {
    assert.equal(manifest.start_url, "/");
    assert.deepEqual(
      manifest.icons.filter((icon) => !icon.purpose).map((icon) => icon.sizes),
      ["192x192", "512x512"],
    );
    for (const icon of manifest.icons) {
      const data = read(`public${icon.src}`);
      const meta = await sharp(data).metadata();
      assert.equal(icon.type, "image/png");
      assert.equal(meta.format, "png");
      assert.equal(icon.sizes, `${meta.width}x${meta.height}`);
      assert.equal(meta.width, meta.height);
      if (icon.purpose !== "monochrome") assert.equal((await sharp(data).stats()).isOpaque, true, icon.src);
    }
    for (const [path, size] of [
      ["public/apple-touch-icon.png", 180],
      ["public/assets/apple-touch-icon-152x152.png", 152],
      ["public/assets/apple-touch-icon-167x167.png", 167],
    ] as const) {
      const metadata = await sharp(read(path)).metadata();
      assert.equal(metadata.width, size);
      assert.equal(metadata.height, size);
      assert.equal((await sharp(read(path)).stats()).isOpaque, true);
    }
    assert.deepEqual(read("public/apple-touch-icon.png"), read("public/assets/apple-touch-icon.png"));
  });

  it("keeps maskable artwork inside the guaranteed central circular safe area", async () => {
    for (const icon of manifest.icons.filter((icon) => icon.purpose === "maskable")) {
      const { data, info } = await sharp(read(`public${icon.src}`))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      assert.ok(info.width >= 192);
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          if (Math.hypot(x + 0.5 - info.width / 2, y + 0.5 - info.height / 2) <= info.width * 0.4) continue;
          const offset = (y * info.width + x) * info.channels;
          assert.deepEqual(
            [...data.subarray(offset, offset + 3)],
            [31, 75, 255],
            `${icon.src} crops artwork at ${x},${y}`,
          );
        }
      }
    }
  });

  it("provides valid legacy ICO frames at 16, 32, 48, and 64 pixels", () => {
    const ico = read("public/favicon.ico");
    assert.equal(ico.readUInt16LE(0), 0);
    assert.equal(ico.readUInt16LE(2), 1);
    assert.equal(ico.readUInt16LE(4), 4);
    let end = 6 + 16 * 4;
    for (const [index, size] of [16, 32, 48, 64].entries()) {
      const entry = 6 + index * 16;
      assert.equal(ico[entry], size);
      assert.equal(ico[entry + 1], size);
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      assert.equal(offset, end);
      assert.equal(length, 40 + size * size * 4 + Math.ceil(size / 32) * 4 * size);
      assert.equal(ico.readUInt32LE(offset), 40);
      assert.equal(ico.readInt32LE(offset + 4), size);
      assert.equal(ico.readInt32LE(offset + 8), size * 2);
      assert.equal(ico.readUInt16LE(offset + 14), 32);
      end += length;
    }
    assert.equal(end, ico.length);
  });

  it("allows the adaptive SVG styles and same-origin manifest under the production CSP", () => {
    assert.match(source, /@media\s*\(prefers-color-scheme: dark\)/);
    const style = /<style>([\s\S]*?)<\/style>/.exec(source)![1]!;
    const digest = createHash("sha256").update(style).digest("base64");
    const config = JSON.parse(read("vercel.json").toString());
    const csp = config.headers[0].headers.find(
      (header: { key: string }) => header.key === "Content-Security-Policy",
    ).value;
    assert.ok(csp.includes(`style-src 'self' 'sha256-${digest}'`), "SVG theme CSS must not be blocked in production");
    assert.ok(csp.includes("manifest-src 'self'"));
    const nextConfig = read("next.config.ts").toString();
    assert.match(nextConfig, /agentRules: false/);
  });
});
