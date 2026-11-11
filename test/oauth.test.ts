import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import { decrypt, encrypt } from "../src/crypto.ts";
import { SlackCallError } from "../src/slack.ts";
import { Browser, CRON_SECRET, dbSkip, oauthResult, startApp, useDatabase, type TestApp } from "./helpers.ts";

describe("token encryption", () => {
  it("round-trips and fails when bound to a different row", () => {
    const key = randomBytes(32);
    const sealed = encrypt(key, "xoxp-secret", "T1:U1:user");
    assert.equal(decrypt(key, sealed, "T1:U1:user"), "xoxp-secret");
    assert.throws(() => decrypt(key, sealed, "T2:U1:user"));
    assert.throws(() => decrypt(randomBytes(32), sealed, "T1:U1:user"));
  });
});

describe("API", { skip: dbSkip }, () => {
  const db = useDatabase();
  let app: TestApp;
  beforeEach(() => {
    app = startApp(db.pool());
  });

  describe("authentication boundaries", () => {
    it("requires a valid Supabase access token for every account endpoint", async () => {
      const anon = new Browser(app);
      for (const [method, path] of [
        ["GET", "/api/me"],
        ["POST", "/api/slack/install"],
        ["POST", "/api/destination"],
        ["POST", "/api/installations/test"],
        ["POST", "/api/installations/disconnect"],
        ["POST", "/api/account/delete"],
      ] as const) {
        assert.equal((await anon.request(path, { method })).status, 401, path);
        const forged = await anon.request(path, { method, headers: { authorization: "Bearer not-a-session" } });
        assert.equal(forged.status, 401, path);
      }
    });

    it("authenticates the internal delivery endpoint only with the cron secret, never a user session", async () => {
      const user = await Browser.signIn(app);
      const deliver = (authorization?: string) =>
        app.api(
          new Request(`${app.config.siteUrl}/api/internal/deliver`, {
            method: "POST",
            headers: authorization ? { authorization } : {},
          }),
        );
      assert.equal((await deliver()).status, 401);
      assert.equal((await deliver(`Bearer ${user.token}`)).status, 401);
      assert.equal((await deliver(`Bearer ${CRON_SECRET}x`)).status, 401);
      const ok = await deliver(`Bearer ${CRON_SECRET}`);
      assert.equal(ok.status, 200);
      assert.deepEqual(await ok.json(), { processed: 0 });
    });

    it("creates the account on first use and never returns tokens", async () => {
      const b = await Browser.signIn(app);
      await b.connect("T1", "UAUTHOR");
      const res = await b.request("/api/me");
      assert.equal(res.headers.get("content-type"), "application/json");
      assert.equal(res.headers.get("cache-control"), "no-store");
      const text = await res.text();
      assert.ok(!text.includes("xoxp") && !text.includes("xoxb"));
      const me = JSON.parse(text) as { destination: string; installations: { teamName: string }[] };
      assert.equal(me.destination, "same");
      assert.equal(me.installations[0]!.teamName, "Team T1");
    });
  });

  describe("OAuth install", () => {
    it("requests only reactions:read (user) and chat:write (bot) and binds the flow to this browser", async () => {
      const b = await Browser.signIn(app);
      const res = await b.post("/api/slack/install");
      const url = new URL(((await res.json()) as { url: string }).url);
      assert.equal(url.origin + url.pathname, "https://slack.com/oauth/v2/authorize");
      assert.equal(url.searchParams.get("user_scope"), "reactions:read");
      assert.equal(url.searchParams.get("scope"), "chat:write");
      assert.equal(url.searchParams.get("redirect_uri"), `${app.config.siteUrl}/api/slack/oauth/callback`);
      assert.match(url.searchParams.get("state")!, /^[\w-]{43}$/);
      assert.match(
        res.headers.get("set-cookie")!,
        /^reactping_oauth=[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600$/,
      );
    });

    it("uses a Secure __Host- cookie on an https site", async () => {
      app = startApp(db.pool(), "https://reactping.example");
      const b = await Browser.signIn(app);
      const res = await b.post("/api/slack/install");
      assert.match(
        res.headers.get("set-cookie")!,
        /^__Host-reactping_oauth=[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/,
      );
    });

    it("refuses to start an install from another origin or while installs are disabled", async () => {
      const b = await Browser.signIn(app);
      assert.equal((await b.post("/api/slack/install", {}, { origin: "https://evil.example" })).status, 400);
      app.config.installsEnabled = false;
      const disabled = await b.post("/api/slack/install");
      assert.equal(disabled.status, 503);
      assert.deepEqual(await disabled.json(), { error: "installs_disabled" });
    });

    it("links the installation and stores tokens encrypted", async () => {
      const b = await Browser.signIn(app);
      await b.connect("T1", "UAUTHOR");
      const [inst] = await app.store.listInstallations(b.accountId);
      assert.equal(inst!.userToken, "xoxp-T1-UAUTHOR");
      const { rows } = await app.store.pool.query("select user_token, bot_token from reactping.installations");
      assert.ok(!rows[0].user_token.includes("xoxp") && !rows[0].bot_token.includes("xoxb"));
      assert.equal(b.cookie, "", "binding cookie is cleared after the callback");
    });

    it("rejects replayed state", async () => {
      const b = await Browser.signIn(app);
      const state = await b.beginInstall();
      const cookie = b.cookie;
      app.slack.oauthResults.set("c1", oauthResult("T1", "UAUTHOR"));
      assert.equal((await b.callback({ code: "c1", state })).headers.get("location"), "/app?slack=connected");
      b.cookie = cookie;
      assert.equal((await b.callback({ code: "c1", state })).headers.get("location"), "/app?slack=expired");
      assert.equal(app.slack.callsTo("oauthAccess").length, 1);
    });

    it("rejects state completed in another browser, so installs cannot be linked into someone else's account", async () => {
      const victim = await Browser.signIn(app);
      const attacker = await Browser.signIn(app);
      const attackerState = await attacker.beginInstall();
      await victim.beginInstall();
      app.slack.oauthResults.set("c1", oauthResult("T1", "UVICTIM"));
      assert.equal(
        (await victim.callback({ code: "c1", state: attackerState })).headers.get("location"),
        "/app?slack=expired",
      );
      assert.equal(
        (await new Browser(app).callback({ code: "c1", state: attackerState })).headers.get("location"),
        "/app?slack=expired",
      );
      assert.equal(app.slack.callsTo("oauthAccess").length, 0);
      assert.equal((await app.store.listInstallations(attacker.accountId)).length, 0);
      // The original browser can still use its state exactly once.
      app.slack.oauthResults.set("c2", oauthResult("T1", "UATTACKER"));
      assert.equal(
        (await attacker.callback({ code: "c2", state: attackerState })).headers.get("location"),
        "/app?slack=connected",
      );
    });

    it("rejects expired and tampered state", async () => {
      const b = await Browser.signIn(app);
      app.slack.oauthResults.set("c1", oauthResult("T1", "UAUTHOR"));
      const state = await b.beginInstall();
      const cookie = b.cookie;
      assert.equal(
        (await b.callback({ code: "c1", state: `x${state}` })).headers.get("location"),
        "/app?slack=expired",
      );
      app.clock.t += 11 * 60 * 1000;
      b.cookie = cookie;
      assert.equal((await b.callback({ code: "c1", state })).headers.get("location"), "/app?slack=expired");
      assert.equal(app.slack.callsTo("oauthAccess").length, 0);
    });

    it("rejects a binding cookie that does not match the state", async () => {
      const b = await Browser.signIn(app);
      const state = await b.beginInstall();
      b.cookie = `${b.cookie}x`;
      assert.equal((await b.callback({ code: "c1", state })).headers.get("location"), "/app?slack=expired");
    });

    it("refuses grants missing reactions:read and revokes the issued token", async () => {
      const b = await Browser.signIn(app);
      app.slack.oauthResults.set("c1", oauthResult("T1", "UAUTHOR", { userScopes: [] }));
      const res = await b.callback({ code: "c1", state: await b.beginInstall() });
      assert.equal(res.headers.get("location"), "/app?slack=missing_scope");
      assert.equal((await app.store.listInstallations(b.accountId)).length, 0);
      assert.deepEqual(app.slack.callsTo("revoke")[0]!.args, ["xoxp-T1-UAUTHOR"]);
      assert.deepEqual(app.slack.callsTo("revoke")[1]!.args, ["xoxb-T1"]);
    });

    it("rejects Enterprise Grid org-wide installs and failed code exchanges", async () => {
      const b = await Browser.signIn(app);
      app.slack.oauthResults.set("grid", oauthResult("E1", "UAUTHOR", { isEnterpriseInstall: true }));
      assert.equal(
        (await b.callback({ code: "grid", state: await b.beginInstall() })).headers.get("location"),
        "/app?slack=enterprise_unsupported",
      );
      assert.equal(
        (await b.callback({ code: "unknown", state: await b.beginInstall() })).headers.get("location"),
        "/app?slack=oauth_failed",
      );
      assert.equal((await app.store.listInstallations(b.accountId)).length, 0);
    });

    it("handles a denied authorization by consuming state", async () => {
      const b = await Browser.signIn(app);
      const state = await b.beginInstall();
      const cookie = b.cookie;
      assert.equal((await b.callback({ error: "access_denied", state })).headers.get("location"), "/app?slack=denied");
      b.cookie = cookie;
      assert.equal((await b.callback({ code: "c1", state })).headers.get("location"), "/app?slack=expired");
    });
  });

  describe("isolation, destination, disconnect", () => {
    it("does not let one account see, test, disconnect, or route to another account's installation", async () => {
      const alice = await Browser.signIn(app);
      const mallory = await Browser.signIn(app);
      await alice.connect("T1", "UALICE");
      await mallory.connect("T2", "UMALLORY");
      const aliceInst = (await app.store.listInstallations(alice.accountId))[0]!;
      assert.equal((await mallory.post("/api/installations/disconnect", { installation: aliceInst.id })).status, 404);
      assert.equal((await mallory.post("/api/installations/test", { installation: aliceInst.id })).status, 404);
      const route = await mallory.post("/api/destination", { destination: aliceInst.id, crossWorkspaceConsent: true });
      assert.equal(route.status, 400);
      assert.ok(!JSON.stringify(await mallory.json("/api/me")).includes("Team T1"));
      assert.equal((await app.store.getInstallation(aliceInst.id))!.status, "active");
    });

    it("requires explicit consent for a cross-workspace destination", async () => {
      const b = await Browser.signIn(app);
      await b.connect("T1", "UAUTHOR");
      await b.connect("T2", "UAUTHOR2");
      const t2 = (await app.store.listInstallations(b.accountId)).find((i) => i.teamId === "T2")!;
      const denied = await b.post("/api/destination", { destination: t2.id });
      assert.deepEqual(await denied.json(), { error: "consent_required" });
      assert.equal((await app.store.getAccount(b.accountId))!.destinationInstallationId, null);
      await b.post("/api/destination", { destination: t2.id, crossWorkspaceConsent: true });
      const account = (await app.store.getAccount(b.accountId))!;
      assert.equal(account.destinationInstallationId, t2.id);
      assert.ok(account.crossWorkspaceConsentAt);
    });

    it("disconnect revokes tokens, deletes the row, and clears a destination pointing at it", async () => {
      const b = await Browser.signIn(app);
      await b.connect("T1", "UAUTHOR");
      await b.connect("T2", "UAUTHOR2");
      const t2 = (await app.store.listInstallations(b.accountId)).find((i) => i.teamId === "T2")!;
      await b.post("/api/destination", { destination: t2.id, crossWorkspaceConsent: true });
      const res = await b.post("/api/installations/disconnect", { installation: t2.id });
      assert.deepEqual(await res.json(), { revoked: true });
      assert.deepEqual(
        app.slack.callsTo("revoke").map((c) => c.args[0]),
        ["xoxp-T2-UAUTHOR2", "xoxb-T2"],
      );
      assert.equal(await app.store.getInstallation(t2.id), undefined);
      const account = (await app.store.getAccount(b.accountId))!;
      assert.equal(account.destinationInstallationId, null);
      assert.equal(account.crossWorkspaceConsentAt, null);
    });

    it("keeps the shared bot token when another user in the workspace is still connected", async () => {
      const a = await Browser.signIn(app);
      const c = await Browser.signIn(app);
      await a.connect("T1", "UA");
      await c.connect("T1", "UC");
      const inst = (await app.store.listInstallations(a.accountId))[0]!;
      await a.post("/api/installations/disconnect", { installation: inst.id });
      assert.deepEqual(
        app.slack.callsTo("revoke").map((x) => x.args[0]),
        ["xoxp-T1-UA"],
      );
    });

    it("account deletion needs explicit confirmation, then removes everything including the auth user", async () => {
      const b = await Browser.signIn(app);
      await b.connect("T1", "UAUTHOR");
      assert.equal((await b.post("/api/account/delete", {})).status, 400);
      assert.equal((await app.store.listInstallations(b.accountId)).length, 1);
      const res = await b.post("/api/account/delete", { confirm: "delete" });
      assert.deepEqual(await res.json(), { deleted: true, revoked: true, authUserDeleted: true });
      assert.equal(await app.store.getAccount(b.accountId), undefined);
      assert.equal((await app.store.listInstallations(b.accountId)).length, 0);
      const { rowCount } = await app.store.pool.query("select 1 from auth.users where id = $1", [b.accountId]);
      assert.equal(rowCount, 0);
      // A still-unexpired access token for the deleted user is refused rather than recreating the account.
      assert.equal((await b.request("/api/me")).status, 401);
    });

    it("shows the effective same-workspace destination after revocation or adding a workspace without consent", async () => {
      const b = await Browser.signIn(app);
      await b.connect("T1", "UAUTHOR");
      const first = (await app.store.listInstallations(b.accountId))[0]!;
      await b.post("/api/destination", { destination: first.id });
      assert.equal((await b.json("/api/me")).destination, first.id);
      await b.connect("T2", "UOTHER");
      assert.equal((await b.json("/api/me")).destination, "same");
      await b.post("/api/destination", { destination: first.id, crossWorkspaceConsent: true });
      assert.equal((await b.json("/api/me")).destination, first.id);
      await app.store.markRevoked({ id: first.id });
      assert.equal((await b.json("/api/me")).destination, "same");
    });

    it(
      "deletes the login before slow revocations and cleans up different workspaces concurrently",
      { timeout: 5000 },
      async () => {
        const b = await Browser.signIn(app);
        await b.connect("T1", "UAUTHOR");
        await b.connect("T2", "UOTHER");
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let allStarted!: () => void;
        const started = new Promise<void>((resolve) => {
          allStarted = resolve;
        });
        let calls = 0;
        app.slack.revoke = async () => {
          const user = await app.store.pool.query("select 1 from auth.users where id = $1", [b.accountId]);
          assert.equal(user.rowCount, 0, "identity removed before waiting for Slack");
          if (++calls === 4) allStarted();
          await gate;
          throw new SlackCallError("transient", "request_failed");
        };
        const deletion = b.post("/api/account/delete", { confirm: "delete" });
        try {
          await started;
          assert.equal(calls, 4);
          assert.equal(await app.store.getAccount(b.accountId), undefined);
        } finally {
          release();
        }
        const response = await deletion;
        assert.deepEqual(await response.json(), { deleted: true, revoked: false, authUserDeleted: true });
      },
    );

    it("returns untrusted workspace names only as JSON data", async () => {
      const b = await Browser.signIn(app);
      app.slack.oauthResults.set("x", oauthResult("T9", "UX", { teamName: "<script>alert(1)</script>" }));
      await b.callback({ code: "x", state: await b.beginInstall() });
      const res = await b.request("/api/me");
      assert.equal(res.headers.get("content-type"), "application/json");
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      const me = (await res.json()) as { installations: { teamName: string }[] };
      assert.equal(me.installations[0]!.teamName, "<script>alert(1)</script>");
    });
  });

  describe("connection test DM", () => {
    it("sends a clearly labelled connectivity test, at most once a minute", async () => {
      const b = await Browser.signIn(app);
      await b.connect("T1", "UAUTHOR");
      const inst = (await app.store.listInstallations(b.accountId))[0]!;
      assert.equal((await b.post("/api/installations/test", { installation: inst.id })).status, 200);
      const [post] = app.slack.callsTo("postMessage");
      assert.deepEqual(post!.args.slice(0, 2), ["xoxb-T1", "UAUTHOR"]);
      assert.match(String(post!.args[2]), /connection test.*not a reaction notification/i);
      assert.equal((await b.post("/api/installations/test", { installation: inst.id })).status, 429);
      app.clock.t += 60_000;
      assert.equal((await b.post("/api/installations/test", { installation: inst.id })).status, 200);
    });

    it("reports and records a revoked bot token", async () => {
      const b = await Browser.signIn(app);
      await b.connect("T1", "UAUTHOR");
      const inst = (await app.store.listInstallations(b.accountId))[0]!;
      app.slack.postMessage = async () => {
        throw new SlackCallError("revoked", "token_revoked");
      };
      const res = await b.post("/api/installations/test", { installation: inst.id });
      assert.deepEqual([res.status, await res.json()], [409, { error: "revoked" }]);
      assert.equal((await app.store.getInstallation(inst.id))!.status, "revoked");
    });
  });

  describe("schema privileges", () => {
    it("denies the Supabase anon and authenticated roles any access to ReactPing tables", async () => {
      const b = await Browser.signIn(app);
      await b.connect("T1", "UAUTHOR");
      const client = await app.store.pool.connect();
      try {
        for (const role of ["anon", "authenticated"]) {
          await client.query("begin");
          await client.query(`set local role ${role}`);
          await client.query("select set_config('request.jwt.claim.sub', $1, true)", [b.accountId]);
          await assert.rejects(client.query("select * from reactping.installations"), /permission denied/);
          await client.query("rollback");
        }
      } finally {
        client.release();
      }
      const { rows } = await app.store.pool.query(
        "select count(*)::int as n from pg_tables where schemaname = 'reactping' and not rowsecurity",
      );
      assert.equal(rows[0].n, 0, "row level security is enabled on every table");
    });
  });
});
