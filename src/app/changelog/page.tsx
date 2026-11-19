// Renders CHANGELOG.md at build time, so CHANGELOG.md is the only copy anyone edits.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Marked } from "marked";
import { Footer, Header, pageMetadata } from "../site.tsx";

export const metadata = pageMetadata({
  title: "ReactPing changelog",
  description: "Every notable change to ReactPing, the Slack app that DMs you when someone reacts to your message.",
  path: "/changelog",
});

// Entry links are commit hashes. The site styles every link to another page as a button.
const marked = new Marked({
  renderer: {
    link({ href, tokens }) {
      return `<a class="btn btn-quiet btn-small commit" href="${href}">${this.parser.parseInline(tokens)}</a>`;
    },
  },
});

/** One entry per released version, newest first. [Unreleased] stays off the site until it ships. */
function releases(markdown: string): { id: string; html: string }[] {
  const refs = new Map([...markdown.matchAll(/^\[([^\]]+)\]: (\S+)$/gm)].map((m) => [m[1]!, m[2]!]));
  return markdown
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
      const html = `<h2>${version} <span class="release-date">${day}</span>
          <a class="btn btn-quiet btn-small anchor" href="#${id}" aria-label="Link to ${version}">#</a></h2>
        ${marked.parse(body, { async: false })}
        <p class="actions"><a class="btn btn-quiet btn-small" href="${full}">${full.includes("/compare/") ? "Full changes" : "Release"} on GitHub</a></p>`;
      return [{ id, html }];
    });
}

export default function Changelog() {
  return (
    <>
      <Header />

      <main id="main" className="page wrap prose">
        <h1>Changelog</h1>
        <p className="lede">Every notable change to ReactPing, newest first.</p>
        {releases(readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8")).map(({ id, html }) => (
          // Markdown from the repository's own CHANGELOG.md, rendered at build time.
          <section key={id} className="release" id={id} dangerouslySetInnerHTML={{ __html: html }} />
        ))}
        <p className="actions">
          <a className="btn btn-quiet btn-small" href="https://github.com/ElliotDrel/reactping/blob/main/CHANGELOG.md">
            CHANGELOG.md on GitHub
          </a>
        </p>
      </main>

      <Footer />
    </>
  );
}
