import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { Browser, dbSkip, oauthResult, seed, SITE, startApp, useDatabase, type TestApp } from "./helpers.ts";

describe("Add to Slack", { skip: dbSkip }, () => {
  const db = useDatabase();
  let app: TestApp;
  beforeEach(() => {
    app = startApp(db.pool());
  });

  describe("install", () => {
    it("redirects to Slack with both scope sets and sets a signed, HttpOnly, Secure, Lax state cookie", async () => {
      const res = await app.handler(new Request(`${SITE}/api/slack/install`));
      assert.equal(res.status, 302);
      const location = new URL(res.headers.get("location")!);
      assert.equal(location.origin + location.pathname, "https://slack.com/oauth/v2/authorize");
      assert.equal(location.searchParams.get("scope"), "chat:write");
      assert.equal(location.searchParams.get("user_scope"), "reactions:read");
      assert.equal(location.searchParams.get("redirect_uri"), `${SITE}/api/slack/oauth/callback`);
      const state = location.searchParams.get("state")!;
      const cookie = res.headers.get("set-cookie")!;
      assert.match(cookie, /^__Host-reactping_oauth=v1\./);
      for (const attribute of ["Path=/", "HttpOnly", "SameSite=Lax", "Secure", "Max-Age=600"]) {
        assert.ok(cookie.includes(attribute), attribute);
      }
      // The nonce is in the cookie, but the cookie also carries an expiry and a signature.
      assert.ok(cookie.includes(state) && cookie.split(";")[0]!.split(".").length === 4);
      assert.equal(res.headers.get("cache-control"), "no-store");
    });

    it("moves the flow to the canonical host so the host-only cookie comes back to the callback", async () => {
      const res = await app.handler(new Request("https://reactping-preview.vercel.app/api/slack/install"));
      assert.equal(res.status, 302);
      assert.equal(res.headers.get("location"), `${SITE}/api/slack/install`);
      assert.equal(res.headers.get("set-cookie"), null);
    });

    it("trusts the Host header when Next builds request.url from its own listener", async () => {
      // Under Next, request.url can be http://localhost:3000/... even when the browser asked for the real domain.
      const host = { host: new URL(SITE).host };
      const real = await app.handler(new Request("http://localhost:3000/api/slack/install", { headers: host }));
      assert.match(real.headers.get("location")!, /^https:\/\/slack\.com\/oauth\/v2\/authorize/);
      const preview = { host: "reactping-preview.vercel.app" };
      const moved = await app.handler(new Request("http://localhost:3000/api/slack/install", { headers: preview }));
      assert.equal(moved.headers.get("location"), `${SITE}/api/slack/install`);
    });

    it("needs no sign-in or launch flag", async () => {
      const res = await app.handler(new Request(`${SITE}/api/slack/install`));
      assert.equal(res.status, 302);
    });
  });

  describe("callback", () => {
    it("stores the Slack identity, sends a welcome DM and Home view after responding, and clears the cookie", async () => {
      const browser = new Browser(app);
      const res = await browser.connect("T1", "UAUTHOR");
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /ReactPing is connected/);
      assert.match(html, /https:\/\/slack\.com\/app_redirect\?app=AREACTPING&amp;team=T1/);
      assert.match(html, /href="\/api\/slack\/install">Add another workspace</);
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
      assert.match(res.headers.get("set-cookie")!, /Max-Age=0/);
      assert.equal(app.slack.callsTo("postMessage").length, 0, "welcome waits for waitUntil");

      const stored = await app.store.get("T1", "UAUTHOR");
      assert.deepEqual(
        [stored?.botToken, stored?.userToken, stored?.workspaceUrl],
        ["xoxb-T1", "xoxp-T1-UAUTHOR", "https://acme.slack.com/"],
      );

      await app.settle();
      const [welcome] = app.slack.callsTo("postMessage");
      assert.deepEqual(welcome!.args.slice(0, 2), ["xoxb-T1", "UAUTHOR"]);
      assert.match(String(welcome!.args[2]), /best effort/);
      // Feedback goes through the website form, UTM-tagged so Slack-sourced feedback can be counted.
      assert.ok(String(welcome!.args[2]).includes(`<${SITE}/feedback?utm_source=slack&amp;utm_medium=welcome_dm|`));
      const [home] = app.slack.callsTo("publishHome");
      assert.deepEqual(home!.args.slice(0, 2), ["xoxb-T1", "UAUTHOR"]);
      assert.ok(JSON.stringify(home!.args[2]).includes("/feedback?utm_source=slack&amp;utm_medium=home_tab|"));
      assert.equal(app.slack.callsTo("revoke").length, 0);
    });

    it("keeps each workspace and user separate and replaces tokens on reinstall", async () => {
      await new Browser(app).connect("T1", "UAUTHOR");
      await new Browser(app).connect("T2", "UAUTHOR");
      await new Browser(app).connect("T1", "UOTHER");
      await new Browser(app).connect("T1", "UAUTHOR", { userToken: "xoxp-new", botToken: "xoxb-T1-new" });
      assert.equal((await app.store.get("T1", "UAUTHOR"))?.userToken, "xoxp-new");
      assert.equal((await app.store.get("T2", "UAUTHOR"))?.userToken, "xoxp-T2-UAUTHOR");
      assert.equal((await app.store.get("T1", "UOTHER"))?.userToken, "xoxp-T1-UOTHER");
      const { rows } = await db.pool().query("select count(*)::int as n from reactping_slack.installations");
      assert.equal(rows[0].n, 3);
    });

    it("rejects a callback from another browser, a forged state, or an expired link without calling Slack", async () => {
      const starter = new Browser(app);
      const state = await starter.beginInstall();
      const other = new Browser(app);
      await other.beginInstall();
      app.slack.oauthResults.set("c", oauthResult("T1", "UAUTHOR"));

      const wrongBrowser = await other.callback({ code: "c", state });
      const noCookie = await new Browser(app).callback({ code: "c", state });
      const forged = await starter.callback({ code: "c", state: "x".repeat(43) });
      for (const res of [wrongBrowser, noCookie, forged]) {
        assert.equal(res.status, 400);
        assert.match(await res.text(), /This link expired/);
      }

      const late = new Browser(app);
      const lateState = await late.beginInstall();
      app.clock.t += 10 * 60 * 1000;
      assert.equal((await late.callback({ code: "c", state: lateState })).status, 400);
      assert.equal(app.slack.callsTo("oauthAccess").length, 0);
      assert.equal(await app.store.get("T1", "UAUTHOR"), undefined);
    });

    it("handles cancellation and Slack errors without storing anything", async () => {
      const browser = new Browser(app);
      const cancelled = await browser.callback({ error: "access_denied", state: await browser.beginInstall() });
      assert.equal(cancelled.status, 200);
      assert.match(await cancelled.text(), /Nothing was installed/);
      const failed = await browser.callback({ code: "unknown", state: await browser.beginInstall() });
      assert.equal(failed.status, 502);
      assert.equal((await db.pool().query("select 1 from reactping_slack.installations")).rowCount, 0);
    });

    it("rejects Enterprise Grid and revokes only the new user grant", async () => {
      for (const overrides of [{ isEnterpriseInstall: true }, { enterpriseId: "E123" }]) {
        app.slack.calls = [];
        const res = await new Browser(app).connect("T1", "UAUTHOR", overrides);
        assert.equal(res.status, 400);
        assert.match(await res.text(), /Enterprise Grid/);
        assert.deepEqual(
          app.slack.callsTo("revoke").map((c) => c.args[0]),
          ["xoxp-T1-UAUTHOR"],
        );
      }
      assert.equal(await app.store.get("T1", "UAUTHOR"), undefined);
    });

    it("rejects missing scopes or incomplete identity, never revoking the shared bot token", async () => {
      const cases = [
        { userScopes: [] },
        { botScopes: ["users:read"] },
        { userTokenType: "bot" },
        { userId: "not-a-user" },
        { botToken: null },
      ];
      for (const overrides of cases) {
        app.slack.calls = [];
        const res = await new Browser(app).connect("T1", "UNEW", overrides);
        assert.ok([400, 502].includes(res.status), JSON.stringify(overrides));
        assert.ok(!app.slack.callsTo("revoke").some((c) => String(c.args[0]).startsWith("xoxb")));
      }
      assert.equal(await app.store.get("T1", "UNEW"), undefined);
    });

    it("does not revoke a grant an existing installation still uses when a repeat install is rejected", async () => {
      await seed(app, "T1", "UAUTHOR");
      const res = await new Browser(app).connect("T1", "UAUTHOR", { botScopes: [] });
      assert.equal(res.status, 400);
      assert.equal(app.slack.callsTo("revoke").length, 0);
      assert.ok(await app.store.get("T1", "UAUTHOR"));
    });

    it("requires auth.test to confirm the workspace and return a Slack https URL", async () => {
      app.slack.workspaceUrl = "https://evil.example.test/";
      assert.equal((await new Browser(app).connect("T1", "UAUTHOR")).status, 502);
      app.slack.workspaceUrl = "https://acme.slack.com/";
      app.slack.authTest = async () => ({ teamId: "TOTHER", url: "https://acme.slack.com/" });
      assert.equal((await new Browser(app).connect("T1", "UAUTHOR")).status, 502);
      assert.equal(await app.store.get("T1", "UAUTHOR"), undefined);
    });

    it("rejects malformed codes before calling Slack", async () => {
      const browser = new Browser(app);
      const res = await browser.callback({ code: "bad code<script>", state: await browser.beginInstall() });
      assert.equal(res.status, 400);
      assert.equal(app.slack.callsTo("oauthAccess").length, 0);
    });
  });
});
