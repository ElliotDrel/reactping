/* global process, URL, document, window */
// Renders launch.html frame by frame. usage:
//   node render.mjs stills 1.0 4.2 ...   -> preview/t_<time>.png
//   node render.mjs video out.mp4 [duration]
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [mode, ...args] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(pathToFileURL(new URL("launch.html", import.meta.url).pathname.slice(1)).href);
await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
await page.evaluate(() => document.fonts.ready);

if (mode === "stills") {
  mkdirSync("preview", { recursive: true });
  for (const t of args) {
    await page.evaluate((t) => window.render(t), Number(t));
    await page.screenshot({ path: `preview/t_${t}.png` });
  }
} else {
  const [out, dur = "19"] = args,
    fps = 30,
    n = Math.round(Number(dur) * fps);
  const ff = spawn(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-f",
      "image2pipe",
      "-framerate",
      String(fps),
      "-c:v",
      "png",
      "-i",
      "-",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "16",
      "-preset",
      "slow",
      "-movflags",
      "+faststart",
      out,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  for (let i = 0; i < n; i++) {
    await page.evaluate((t) => window.render(t), i / fps);
    const buf = await page.screenshot({ type: "png" });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
}
await browser.close();
