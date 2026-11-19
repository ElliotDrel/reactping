import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import pg from "pg";
import { homeView } from "../src/messages.ts";
import { CONNECT_PATH, resultPage, type Outcome } from "../src/pages.ts";
import { Browser, startApp } from "./helpers.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const pages = readdirSync(new URL("public/", root)).filter((f) => f.endsWith(".html"));
const html = Object.fromEntries(pages.map((f) => [f, read(`public/${f}`)]));

/** [href, visible text] for every link in a page. */
function links(page: string): [string, string][] {
  return [...page.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a\s*>/g)].map((m) => [
    m[1]!,
    m[2]!
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  ]);
}

const REPO = "https://github.com/ElliotDrel/reactping/blob/main/";

/**
 * Every source link on the site, and text its line range must contain. When code moves, this fails until the
 * link is updated, so a privacy claim can never point readers at the wrong lines.
 */
const SOURCE_LINKS: Record<string, RegExp[]> = {
  "src/slack.ts#L3-L4": [/BOT_SCOPES = \["chat:write"\]/, /USER_SCOPES = \["reactions:read"\]/],
  "src/handler.ts#L376-L410": [/async function deliver\(/, /item_user: authorId, reaction/, /postMessage\(/],
  "src/slack.ts#L113-L160": [/return \{/, /oauthAccess/, /authTest/, /postMessage/, /publishHome/, /revoke/],
  "supabase/migrations/20261113000000_reactping_slack_installations.sql#L14-L24": [
    /create table reactping_slack\.installations/,
    /primary key \(team_id, user_id\)/,
  ],
  "src/db.ts#L82-L83": [/encrypt\(this\.tokenKey, install\.botToken/, /encrypt\(this\.tokenKey, install\.userToken/],
  "vercel.json#L17-L18": [/Content-Security-Policy/, /default-src 'none'/],
};

describe("website", () => {
  it("sends every Add to Slack link through the /connect instructions", () => {
    let count = 0;
    for (const [file, page] of Object.entries(html)) {
      for (const [href, text] of links(page)) {
        if (/add to slack/i.test(text)) {
          count++;
          assert.equal(href, CONNECT_PATH, `${file}: "${text}"`);
        }
        if (file !== "connect.html") assert.notEqual(href, "/api/slack/install", `${file} skips /connect`);
      }
    }
    assert.ok(count >= 3);
    assert.ok(existsSync(new URL("public/connect.html", root)), "cleanUrls serves /connect from connect.html");
  });

  it("explains workspace choice, repeats, self-connection, and admin approval before continuing to OAuth", () => {
    const page = html["connect.html"]!;
    assert.deepEqual(
      links(page).find(([, text]) => text === "Continue to Slack"),
      ["/api/slack/install", "Continue to Slack"],
    );
    for (const phrase of [/workspace name in the top-right/, /Allow/, /Repeat for each workspace/, /admin approval/]) {
      assert.match(page, phrase);
    }
    assert.match(page, /Everyone connects for themselves/);
  });

  it("keeps the homepage short, script-free, and headed by the product name without an eyebrow", () => {
    const page = html["index.html"]!;
    assert.match(page, /<h1>Reaction notifications for Slack<\/h1>/);
    assert.doesNotMatch(page, /eyebrow/);
    // Counts <main> only, so header and footer navigation links don't spend the content budget.
    const words = /<main[\s\S]*<\/main>/
      .exec(page)![0]
      .replace(/<svg[\s\S]*?<\/svg>/g, "")
      .replace(/<[^>]+>/g, " ")
      .split(/\s+/)
      .filter(Boolean).length;
    // Whole-page limit was raised from 110 (Nov 16) to 150, 230, and 260 (Nov 17); then 235 words of <main> (its size
    // when the footer gained a link back to elliotdrel.com), and 265 for the search-intent Q&A "How do I get notified
    // when someone reacts to my Slack message?" (Nov 17). Long-form content belongs on /how-it-works and /security.
    assert.ok(words <= 265, `homepage <main> has ${words} words`);
    // JSON-LD is data, not code: browsers never run it, so the CSP still blocks every script.
    for (const [file, page] of Object.entries(html)) {
      assert.doesNotMatch(
        page.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, ""),
        /<script/i,
        file,
      );
    }
    const csp = JSON.parse(read("vercel.json")).headers[0].headers.find(
      (h: { key: string }) => h.key === "Content-Security-Policy",
    ).value;
    assert.match(csp, /default-src 'none'/);
    assert.doesNotMatch(csp, /script-src/);
  });

  it("links privacy claims to source lines that still say what the claim needs", () => {
    const found = new Set(
      Object.values(html)
        .flatMap(links)
        .map(([href]) => href)
        .filter((href) => href.startsWith(REPO))
        .map((href) => href.slice(REPO.length))
        .filter((path) => path.includes("#L")),
    );
    assert.deepEqual([...found].sort(), Object.keys(SOURCE_LINKS).sort(), "update SOURCE_LINKS with the site");
    for (const [link, patterns] of Object.entries(SOURCE_LINKS)) {
      const [path, range] = link.split("#");
      const [from, to] = range!.match(/\d+/g)!.map(Number);
      const lines = read(path!)
        .split("\n")
        .slice(from! - 1, to)
        .join("\n");
      // The range must start exactly where the code does, so drift of even one line fails.
      assert.match(lines.split("\n")[0]!, patterns[0]!, `${link} no longer starts at ${patterns[0]}`);
      for (const pattern of patterns) assert.match(lines, pattern, `${link} no longer shows ${pattern}`);
    }
  });

  it("gives every shareable page complete link-preview tags with absolute URLs to real files", () => {
    // iMessage, X, and Slack drop or shrink previews when og:image is relative, missing, or not 1200x630.
    for (const file of ["index.html", "how-it-works.html", "security.html", "privacy.html", "connect.html"]) {
      const page = html[file]!;
      const meta = (key: string) => new RegExp(`(?:property|name)="${key}"\\s+content="([^"]+)"`).exec(page)?.[1];
      for (const key of ["og:title", "og:description", "og:url", "og:image", "twitter:card", "twitter:image"]) {
        assert.ok(meta(key), `${file} is missing ${key}`);
      }
      assert.equal(meta("twitter:card"), "summary_large_image", file);
      assert.equal(meta("og:image:width"), "1200", file);
      assert.equal(meta("og:image:height"), "630", file);
      for (const key of ["og:url", "og:image", "twitter:image"]) {
        assert.match(meta(key)!, /^https:\/\//, `${file} ${key} must be absolute`);
      }
      const image = new URL(meta("og:image")!).pathname;
      assert.ok(existsSync(new URL(`public${image}`, root)), `${file} og:image ${image} does not exist`);
      assert.match(page, /<link rel="apple-touch-icon" href="\/assets\/apple-touch-icon\.png" \/>/, file);
    }
    assert.ok(existsSync(new URL("public/assets/apple-touch-icon.png", root)));
  });

  it("lets search engines index exactly the canonical pages, all listed in the sitemap", () => {
    // A canonical URL means "index me"; anything without one (404, feedback form) stays noindex.
    const sitemap = read("public/sitemap.xml");
    const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!).sort();
    const canonical = pages
      .map((f) => [f, /<link rel="canonical" href="([^"]+)"/.exec(html[f]!)?.[1]] as const)
      .filter(([, url]) => url);
    assert.deepEqual(listed, canonical.map(([, url]) => url!).sort());
    for (const file of pages) {
      const noindex = /<meta name="robots" content="[^"]*noindex/.test(html[file]!);
      assert.equal(noindex, !canonical.some(([f]) => f === file), file);
    }
    assert.doesNotMatch(read("vercel.json"), /X-Robots-Tag/);
    assert.match(read("public/robots.txt"), /^Disallow: \/api\/$/m);
    assert.doesNotMatch(read("public/robots.txt"), /^Disallow: \/$/m);
    const origin = new URL(canonical.find(([f]) => f === "index.html")![1]!).origin;
    assert.ok(read("public/robots.txt").includes(`\nSitemap: ${origin}/sitemap.xml\n`), "robots.txt Sitemap line");
    // Old hosts send pages (never /api/, which Slack may still call there) to the one canonical origin.
    const redirects = JSON.parse(read("vercel.json")).redirects as { destination: string }[];
    assert.ok(redirects.length > 0);
    for (const r of redirects) assert.equal(r.destination, `${origin}/:path`);
  });

  it("keeps structured data and llms.txt true to the visible site", () => {
    // Search engines penalize JSON-LD that says something the page doesn't, so the FAQ must match word for word.
    const page = html["index.html"]!;
    const text = (s: string) =>
      s
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page)![1]!);
    const byType = (type: string) => ld["@graph"].find((n: { "@type": string }) => n["@type"] === type);
    const faq = /<section class="faq[\s\S]*?<\/section>/.exec(page)![0];
    const visible = [...faq.matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)].map((m) => [
      text(m[1]!),
      text(m[2]!),
    ]);
    const structured = byType("FAQPage").mainEntity.map((q: { name: string; acceptedAnswer: { text: string } }) => [
      q.name,
      q.acceptedAnswer.text,
    ]);
    assert.deepEqual(structured, visible);
    const app = byType("WebApplication");
    assert.equal(app.description, /name="description"\s+content="([^"]+)"/.exec(page)![1]);
    assert.equal(app.offers.price, "0");
    assert.match(page, /Free forever/);
    // llms.txt may only point at pages that exist and are indexable.
    const sitemap = read("public/sitemap.xml");
    const llms = read("public/llms.txt");
    for (const [, url] of llms.matchAll(/\((https:\/\/reactping\.com[^)]*)\)/g)) {
      assert.ok(url === "https://reactping.com/connect" || sitemap.includes(`<loc>${url}</loc>`), url);
    }
  });

  it("styles every link to another page as a button, except the header's text links", () => {
    // Elliot (Nov 17): links to other pages are buttons, never inline text. The header nav keeps text links (he
    // reverted header buttons the same day); the logo and skip link are exempt too.
    for (const [file, page] of Object.entries(html)) {
      const header = /<nav aria-label="Main">[\s\S]*?<\/nav>/.exec(page)?.[0] ?? "";
      for (const [href, text] of links(header)) {
        if (text !== "Add to Slack") assert.doesNotMatch(header, new RegExp(`class="btn[^"]*" href="${href}"`), file);
      }
      for (const tag of page.replace(header, "").match(/<a\b[^>]*>/g) ?? []) {
        if (/class="(brand|skip-link)"/.test(tag)) continue;
        assert.match(tag, /class="btn\b/, `${file}: ${tag.replace(/\s+/g, " ")}`);
      }
    }
  });

  it("offers feedback from every page header and a homepage section", () => {
    for (const [file, page] of Object.entries(html)) {
      if (file === "connect.html" || file === "404.html") continue;
      const header = /<header[\s\S]*?<\/header>/.exec(page)![0];
      assert.ok(
        links(header).some(([href, text]) => href === "/feedback" && text === "Feedback"),
        file,
      );
    }
    const section = /<section[^>]*id="feedback"[\s\S]*?<\/section>/.exec(html["index.html"]!)![0];
    assert.deepEqual(links(section), [["/feedback", "Send feedback"]]);
  });

  it("only links to files that exist in the repository", () => {
    for (const page of Object.values(html)) {
      for (const [href] of links(page).filter(([h]) => h.startsWith(REPO))) {
        assert.ok(existsSync(new URL(href.slice(REPO.length).split("#")[0]!, root)), href);
      }
    }
  });
});

describe("OAuth result pages", () => {
  const outcomes: Outcome[] = ["connected", "cancelled", "expired", "failed", "enterprise", "scopes"];

  it("offers Open in Slack and Add another workspace after success", async () => {
    const page = await resultPage("connected", 200, "c=; Max-Age=0", "https://slack.com/app_redirect?app=A1&team=T1")
      .text()
      .then(links);
    assert.deepEqual(page, [
      ["/", "ReactPing"],
      ["https://slack.com/app_redirect?app=A1&amp;team=T1", "Open ReactPing in Slack"],
      // Elliot: skip /connect here; the person just went through it, so go straight to Slack's approval page.
      ["/api/slack/install", "Add another workspace"],
    ]);
  });

  it("still offers Add another workspace when no Slack link can be built", async () => {
    const page = links(await resultPage("connected", 200, "c=; Max-Age=0").text());
    assert.ok(page.some(([href, text]) => href === "/api/slack/install" && text === "Add another workspace"));
    assert.ok(!page.some(([, text]) => text === "Open ReactPing in Slack"));
  });

  it("retries failures through /connect, never straight to OAuth", async () => {
    for (const outcome of outcomes) {
      const res = resultPage(outcome, 400, "c=; Max-Age=0");
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
      assert.match(res.headers.get("content-security-policy")!, /default-src 'none'/);
      const page = links(await res.text());
      if (outcome !== "connected") assert.ok(!page.some(([href]) => href.includes("/api/slack/install")), outcome);
      if (outcome !== "connected")
        assert.ok(page.some(([href, text]) => href === CONNECT_PATH && text === "Try again"));
    }
  });

  it("points a disconnected Home tab at the /connect instructions", () => {
    const view = JSON.stringify(homeView({ connected: false, siteUrl: "https://r.test", includeSelfReactions: false }));
    assert.match(view, /https:\/\/r\.test\/connect\|add ReactPing to Slack/);
  });
});

describe("routes without a database", () => {
  // These paths fail closed before any query; the pool never connects.
  const app = startApp(new pg.Pool({ connectionString: "postgres://unused@127.0.0.1:1/none" }));

  it("rejects a callback from a browser that never started the flow, with a retry through /connect", async () => {
    const res = await new Browser(app).callback({ code: "c", state: "s".repeat(43) });
    assert.equal(res.status, 400);
    assert.match(res.headers.get("set-cookie")!, /Max-Age=0/);
    const page = await res.text();
    assert.match(page, /This link expired/);
    assert.ok(links(page).some(([href, text]) => href === CONNECT_PATH && text === "Try again"));
    assert.equal(app.slack.calls.length, 0);
  });

  it("shows the cancelled page when the person declines on Slack", async () => {
    const browser = new Browser(app);
    const res = await browser.callback({ error: "access_denied", state: await browser.beginInstall() });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Nothing was installed/);
    assert.equal(app.slack.calls.length, 0);
  });
});
