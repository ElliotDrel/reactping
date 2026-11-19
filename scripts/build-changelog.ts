// Renders CHANGELOG.md into public/changelog.html during `npm run build` (Vercel runs it on every deploy), so
// CHANGELOG.md is the only copy anyone edits. The generated page is gitignored.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

// Entry links are commit hashes. The site styles every link to another page as a button.
const marked = new Marked({
  renderer: {
    link({ href, tokens }) {
      return `<a class="btn btn-quiet btn-small commit" href="${href}">${this.parser.parseInline(tokens)}</a>`;
    },
  },
});

/** The changelog page: one section per released version. [Unreleased] stays off the site until it ships. */
export function renderChangelog(markdown = read("CHANGELOG.md")): string {
  const refs = new Map([...markdown.matchAll(/^\[([^\]]+)\]: (\S+)$/gm)].map((m) => [m[1]!, m[2]!]));
  const releases = markdown
    .split(/^## /m)
    .slice(1)
    .flatMap((section) => {
      const [heading = "", ...rest] = section.split("\n");
      const match = /^\[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/.exec(heading);
      if (!match) return [];
      const [, version, date] = match;
      const body = rest.join("\n").replace(/^\[[^\]]+\]: \S+$/gm, "");
      const day = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
      const id = `v${version}`;
      const full = refs.get(version!)!;
      return `<section class="release" id="${id}">
        <h2>${version} <span class="release-date">${day}</span>
          <a class="btn btn-quiet btn-small anchor" href="#${id}" aria-label="Link to ${version}">#</a></h2>
        ${marked.parse(body, { async: false })}
        <p class="actions"><a class="btn btn-quiet btn-small" href="${full}">${full.includes("/compare/") ? "Full changes" : "Release"} on GitHub</a></p>
      </section>`;
    });
  return read("scripts/changelog-template.html").replace("<!-- releases -->", releases.join("\n"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL("public/changelog.html", root), renderChangelog());
}
