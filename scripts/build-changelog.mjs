/* global URL */
// Copies CHANGELOG.md into public/changelog.html, which shows it as plain text. Run `npm run changelog` after
// editing CHANGELOG.md; test/site.test.ts fails while the page is out of date.
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const page = new URL("public/changelog.html", root);
const markdown = readFileSync(new URL("CHANGELOG.md", root), "utf8");
const escaped = markdown.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const html = readFileSync(page, "utf8").replace(
  /(<pre class="changelog">)[\s\S]*?(<\/pre>)/,
  (_, open, close) => open + escaped + close,
);
writeFileSync(page, html);
