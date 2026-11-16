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
  "src/handler.ts#L309-L338": [/async function notify\(/, /item_user: authorId, reaction/, /postMessage\(/],
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
    const words = page
      .replace(/<head>[\s\S]*<\/head>/, "")
      .replace(/<svg[\s\S]*?<\/svg>/g, "")
      .replace(/<[^>]+>/g, " ")
      .split(/\s+/)
      .filter(Boolean).length;
    // Raised from 110 on November 16, 2026, when Elliot added Q&A content; still guards against sprawl.
    assert.ok(words <= 150, `homepage has ${words} words`);
    for (const [file, page] of Object.entries(html)) assert.doesNotMatch(page, /<script/i, file);
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
      for (const pattern of patterns) assert.match(lines, pattern, `${link} no longer shows ${pattern}`);
    }
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
      [CONNECT_PATH, "Add another workspace"],
    ]);
  });

  it("still offers Add another workspace when no Slack link can be built", async () => {
    const page = links(await resultPage("connected", 200, "c=; Max-Age=0").text());
    assert.ok(page.some(([href, text]) => href === CONNECT_PATH && text === "Add another workspace"));
    assert.ok(!page.some(([, text]) => text === "Open ReactPing in Slack"));
  });

  it("retries through /connect and never links straight to OAuth", async () => {
    for (const outcome of outcomes) {
      const res = resultPage(outcome, 400, "c=; Max-Age=0");
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
      assert.match(res.headers.get("content-security-policy")!, /default-src 'none'/);
      const page = links(await res.text());
      assert.ok(!page.some(([href]) => href.includes("/api/slack/install")), outcome);
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
