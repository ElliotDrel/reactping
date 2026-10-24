import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt } from "../src/crypto.ts";
import { Browser, oauthResult, startApp, type TestApp } from "./helpers.ts";

let app: TestApp;
beforeEach(async () => (app = await startApp()));
afterEach(() => app.close());

describe("sessions and CSRF", () => {
  it("sets an HttpOnly SameSite session cookie and requires a session for settings", async () => {
    const anon = new Browser(app);
    assert.equal((await anon.request("/settings")).headers.get("location"), "/");
    const res = await anon.post("/start", {});
    assert.match(res.headers.get("set-cookie")!, /HttpOnly; SameSite=Lax/);
    assert.equal((await anon.request("/settings")).status, 200);
    const settings = await anon.request("/settings");
    assert.equal(settings.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  });

  it("rejects mutations without a valid CSRF token or from another origin", async () => {
    const b = new Browser(app);
    await b.start();
    assert.equal((await b.post("/slack/install", {})).status, 403);
    assert.equal((await b.post("/slack/install", { csrf: "wrong" })).status, 403);
    const csrf = await b.csrf();
    assert.equal((await b.post("/slack/install", { csrf }, { origin: "https://evil.example" })).status, 403);
    assert.equal((await b.post("/slack/install", { csrf })).status, 303);
  });
});

describe("OAuth install", () => {
  it("requests only reactions:read (user) and chat:write (bot) with a signed state", async () => {
    const b = new Browser(app);
    await b.start();
    const res = await b.post("/slack/install", { csrf: await b.csrf() });
    const url = new URL(res.headers.get("location")!);
    assert.equal(url.origin + url.pathname, "https://slack.com/oauth/v2/authorize");
    assert.equal(url.searchParams.get("user_scope"), "reactions:read");
    assert.equal(url.searchParams.get("scope"), "chat:write");
    assert.equal(url.searchParams.get("redirect_uri"), `${app.baseUrl}/slack/oauth/callback`);
    assert.match(url.searchParams.get("state")!, /^[\w-]+\.[0-9a-f]{64}$/);
  });

  it("links the installation and stores tokens encrypted", async () => {
    const b = new Browser(app);
    await b.start();
    await b.connect("T1", "UAUTHOR");
    const [inst] = app.store.listInstallations(b.accountId());
    assert.equal(inst!.userToken, "xoxp-T1-UAUTHOR");
    const raw = app.store.db.prepare("SELECT user_token, bot_token FROM installations").get() as Record<string, string>;
    assert.ok(!raw.user_token!.includes("xoxp") && !raw.bot_token!.includes("xoxb"));
    assert.ok(!(await (await b.request("/settings")).text()).includes("xoxp"));
  });

  it("rejects replayed state", async () => {
    const b = new Browser(app);
    await b.start();
    const state = await b.beginInstall();
    app.slack.oauthResults.set("c1", oauthResult("T1", "UAUTHOR"));
    assert.equal((await b.callback({ code: "c1", state })).status, 303);
    assert.equal((await b.callback({ code: "c1", state })).status, 400);
    assert.equal(app.slack.callsTo("oauthAccess").length, 1);
  });

  it("rejects state from another session, so installs cannot be linked into someone else's account", async () => {
    const victim = new Browser(app);
    const attacker = new Browser(app);
    await victim.start();
    await attacker.start();
    const attackerState = await attacker.beginInstall();
    app.slack.oauthResults.set("c1", oauthResult("T1", "UVICTIM"));
    assert.equal((await victim.callback({ code: "c1", state: attackerState })).status, 400);
    assert.equal((await new Browser(app).callback({ code: "c1", state: attackerState })).status, 400);
    assert.equal(app.slack.callsTo("oauthAccess").length, 0);
    // The original session can still use its state exactly once.
    app.slack.oauthResults.set("c2", oauthResult("T1", "UATTACKER"));
    assert.equal((await attacker.callback({ code: "c2", state: attackerState })).status, 303);
  });

  it("rejects expired and tampered state", async () => {
    const b = new Browser(app);
    await b.start();
    app.slack.oauthResults.set("c1", oauthResult("T1", "UAUTHOR"));
    const state = await b.beginInstall();
    const [nonce, sig] = state.split(".");
    assert.equal((await b.callback({ code: "c1", state: `${nonce}.${"0".repeat(64)}` })).status, 400);
    assert.equal((await b.callback({ code: "c1", state: `x${nonce}.${sig}` })).status, 400);
    app.clock.t += 11 * 60 * 1000;
    assert.equal((await b.callback({ code: "c1", state })).status, 400);
  });

  it("refuses grants missing reactions:read and revokes the issued token", async () => {
    const b = new Browser(app);
    await b.start();
    app.slack.oauthResults.set("c1", oauthResult("T1", "UAUTHOR", { userScopes: [] }));
    const res = await b.callback({ code: "c1", state: await b.beginInstall() });
    assert.equal(res.headers.get("location"), "/settings?notice=missing_scope");
    assert.equal(app.store.listInstallations(b.accountId()).length, 0);
    assert.deepEqual(app.slack.callsTo("revoke")[0]!.args, ["xoxp-T1-UAUTHOR"]);
    assert.deepEqual(app.slack.callsTo("revoke")[1]!.args, ["xoxb-T1"]);
  });

  it("handles a cancelled authorization by consuming state", async () => {
    const b = new Browser(app);
    await b.start();
    const state = await b.beginInstall();
    assert.equal(
      (await b.callback({ error: "access_denied", state })).headers.get("location"),
      "/settings?notice=cancelled",
    );
    assert.equal((await b.callback({ code: "c1", state })).status, 400);
  });
});

describe("isolation, destination, disconnect", () => {
  it("does not let one account disconnect or route to another account's installation", async () => {
    const alice = new Browser(app);
    const mallory = new Browser(app);
    await alice.start();
    await mallory.start();
    await alice.connect("T1", "UALICE");
    await mallory.connect("T2", "UMALLORY");
    const aliceInst = app.store.listInstallations(alice.accountId())[0]!;
    const csrf = await mallory.csrf();
    assert.equal((await mallory.post("/installations/disconnect", { csrf, installation: aliceInst.id })).status, 404);
    assert.equal(
      (await mallory.post("/destination", { csrf, destination: aliceInst.id, cross_workspace_consent: "yes" })).status,
      400,
    );
    assert.ok(!(await (await mallory.request("/settings")).text()).includes("Team T1"));
    assert.equal(app.store.getInstallation(aliceInst.id)!.status, "active");
  });

  it("requires explicit consent for a cross-workspace destination", async () => {
    const b = new Browser(app);
    await b.start();
    await b.connect("T1", "UAUTHOR");
    await b.connect("T2", "UAUTHOR2");
    const t2 = app.store.listInstallations(b.accountId()).find((i) => i.teamId === "T2")!;
    const csrf = await b.csrf();
    const denied = await b.post("/destination", { csrf, destination: t2.id });
    assert.equal(denied.headers.get("location"), "/settings?notice=consent_required");
    assert.equal(app.store.getAccount(b.accountId())!.destinationInstallationId, null);
    await b.post("/destination", { csrf, destination: t2.id, cross_workspace_consent: "yes" });
    const account = app.store.getAccount(b.accountId())!;
    assert.equal(account.destinationInstallationId, t2.id);
    assert.ok(account.crossWorkspaceConsentAt);
  });

  it("disconnect revokes tokens, deletes the row, and clears a destination pointing at it", async () => {
    const b = new Browser(app);
    await b.start();
    await b.connect("T1", "UAUTHOR");
    await b.connect("T2", "UAUTHOR2");
    const t2 = app.store.listInstallations(b.accountId()).find((i) => i.teamId === "T2")!;
    const csrf = await b.csrf();
    await b.post("/destination", { csrf, destination: t2.id, cross_workspace_consent: "yes" });
    const res = await b.post("/installations/disconnect", { csrf, installation: t2.id });
    assert.equal(res.headers.get("location"), "/settings?notice=disconnected");
    assert.deepEqual(
      app.slack.callsTo("revoke").map((c) => c.args[0]),
      ["xoxp-T2-UAUTHOR2", "xoxb-T2"],
    );
    assert.equal(app.store.getInstallation(t2.id), undefined);
    const account = app.store.getAccount(b.accountId())!;
    assert.equal(account.destinationInstallationId, null);
    assert.equal(account.crossWorkspaceConsentAt, null);
  });

  it("keeps the shared bot token when another user in the workspace is still connected", async () => {
    const a = new Browser(app);
    const c = new Browser(app);
    await a.start();
    await c.start();
    await a.connect("T1", "UA");
    await c.connect("T1", "UC");
    const inst = app.store.listInstallations(a.accountId())[0]!;
    await a.post("/installations/disconnect", { csrf: await a.csrf(), installation: inst.id });
    assert.deepEqual(
      app.slack.callsTo("revoke").map((x) => x.args[0]),
      ["xoxp-T1-UA"],
    );
  });

  it("account deletion removes everything and ends the session", async () => {
    const b = new Browser(app);
    await b.start();
    await b.connect("T1", "UAUTHOR");
    const accountId = b.accountId();
    await b.post("/account/delete", { csrf: await b.csrf() });
    assert.equal(app.store.getAccount(accountId), undefined);
    assert.equal(app.store.listInstallations(accountId).length, 0);
    assert.equal((await b.request("/settings")).headers.get("location"), "/");
  });

  it("escapes untrusted workspace names in HTML", async () => {
    const b = new Browser(app);
    await b.start();
    app.slack.oauthResults.set("x", oauthResult("T9", "UX", { teamName: "<script>alert(1)</script>" }));
    await b.callback({ code: "x", state: await b.beginInstall() });
    const body = await (await b.request("/settings")).text();
    assert.ok(!body.includes("<script>alert"));
    assert.ok(body.includes("&lt;script&gt;"));
  });
});

describe("token encryption", () => {
  it("round-trips and fails when bound to a different row", () => {
    const key = randomBytes(32);
    const sealed = encrypt(key, "xoxp-secret", "T1:U1:user");
    assert.equal(decrypt(key, sealed, "T1:U1:user"), "xoxp-secret");
    assert.throws(() => decrypt(key, sealed, "T2:U1:user"));
    assert.throws(() => decrypt(randomBytes(32), sealed, "T1:U1:user"));
  });
});
