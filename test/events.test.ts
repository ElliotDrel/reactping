import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Browser, reactionEvent, seedInstallation, signedEvent, startApp, type TestApp } from "./helpers.ts";

let app: TestApp;
let accountId: string;
beforeEach(async () => {
  app = await startApp();
  accountId = app.store.createAccountSession().session.accountId;
  seedInstallation(app.store, accountId, "T1", "UAUTHOR");
});
afterEach(() => app.close());

const pending = () => app.store.dueDeliveries(100);

describe("request verification", () => {
  it("answers the URL verification challenge", async () => {
    const res = await signedEvent(app, { type: "url_verification", challenge: "abc123" });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "abc123");
  });

  it("rejects bad signatures and stale timestamps", async () => {
    assert.equal((await signedEvent(app, reactionEvent("T1"), { secret: "wrong" })).status, 401);
    const stale = Math.floor(app.clock.t / 1000) - 6 * 60;
    assert.equal((await signedEvent(app, reactionEvent("T1"), { timestamp: stale })).status, 401);
    const unsigned = await fetch(`${app.baseUrl}/slack/events`, { method: "POST", body: "{}" });
    assert.equal(unsigned.status, 401);
    assert.equal(pending().length, 0);
  });
});

describe("reaction filtering and routing", () => {
  it("enqueues a reaction on a connected author's message, routed by item_user not authorizations", async () => {
    const res = await signedEvent(app, reactionEvent("T1"));
    assert.equal(res.status, 200);
    const [d] = pending();
    assert.equal(d!.reactorId, "UREACTOR");
    assert.equal(d!.sourceInstallationId, app.store.findActiveInstallation("T1", "UAUTHOR")!.id);
  });

  it("stores only minimal metadata", async () => {
    await signedEvent(app, reactionEvent("T1"));
    const row = app.store.db.prepare("SELECT * FROM deliveries").get() as Record<string, unknown>;
    assert.deepEqual(Object.keys(row).sort(), [
      "attempts",
      "channel_id",
      "created_at",
      "event_id",
      "id",
      "last_error",
      "message_ts",
      "next_attempt_at",
      "reaction",
      "reactor_id",
      "source_installation_id",
      "status",
    ]);
  });

  it("ignores self reactions, non-message items, unknown authors, and wrong-team authors", async () => {
    await signedEvent(app, reactionEvent("T1", { user: "UAUTHOR" }));
    await signedEvent(app, reactionEvent("T1", { item: { type: "file", file: "F1" } }));
    await signedEvent(app, reactionEvent("T1", { item_user: "USOMEONEELSE" }));
    await signedEvent(app, reactionEvent("T2"));
    const webhookMessage = reactionEvent("T1") as { event: Record<string, unknown> };
    delete webhookMessage.event.item_user;
    await signedEvent(app, webhookMessage);
    assert.equal(pending().length, 0);
  });

  it("deduplicates Slack retries by event and recipient", async () => {
    const event = reactionEvent("T1", { event_id: "EvDUPLICATE1" });
    assert.equal((await signedEvent(app, event)).status, 200);
    assert.equal((await signedEvent(app, event)).status, 200);
    assert.equal(pending().length, 1);
  });

  it("includes self-reactions only in testing mode and still deduplicates retries", async () => {
    app.config.includeSelfReactions = true;
    const event = reactionEvent("T1", { user: "UAUTHOR", event_id: "EvSELFTEST1" });
    assert.equal((await signedEvent(app, event)).status, 200);
    assert.equal((await signedEvent(app, event)).status, 200);
    assert.equal(pending().length, 1);
    assert.equal(pending()[0]!.reactorId, "UAUTHOR");
    const settings = new Browser(app);
    await settings.start();
    assert.match(await (await settings.request("/settings")).text(), /Testing mode:/);
  });

  it("keeps testing mode limited to connected authors in the matching workspace", async () => {
    app.config.includeSelfReactions = true;
    await signedEvent(app, reactionEvent("T1", { item_user: "UOTHER", user: "UOTHER" }));
    await signedEvent(app, reactionEvent("T2", { user: "UAUTHOR" }));
    assert.equal(pending().length, 0);
  });

  it("routes a reaction only to the author's own installation", async () => {
    const other = app.store.createAccountSession().session.accountId;
    seedInstallation(app.store, other, "T1", "UREACTOR");
    await signedEvent(app, reactionEvent("T1"));
    const ds = pending();
    assert.equal(ds.length, 1);
    assert.equal(app.store.getInstallation(ds[0]!.sourceInstallationId)!.accountId, accountId);
  });

  it("returns 500 when it cannot record the event so Slack retries", async () => {
    app.store.db.exec("DROP TABLE deliveries");
    assert.equal((await signedEvent(app, reactionEvent("T1"))).status, 500);
  });
});

describe("revocation events", () => {
  it("tokens_revoked marks the user's installation revoked, wipes tokens, and stops routing", async () => {
    await signedEvent(app, {
      type: "event_callback",
      team_id: "T1",
      event_id: "EvREVOKE1",
      event: { type: "tokens_revoked", tokens: { oauth: ["UAUTHOR"], bot: [] } },
    });
    const [inst] = app.store.listInstallations(accountId);
    assert.equal(inst!.status, "revoked");
    assert.equal(inst!.userToken, null);
    assert.equal(inst!.botToken, "xoxb-T1");
    await signedEvent(app, reactionEvent("T1"));
    assert.equal(pending().length, 0);
  });

  it("app_uninstalled revokes every installation in that workspace only", async () => {
    seedInstallation(app.store, accountId, "T2", "UAUTHOR2");
    await signedEvent(app, {
      type: "event_callback",
      team_id: "T1",
      event_id: "EvUNINST1",
      event: { type: "app_uninstalled" },
    });
    const byTeam = Object.fromEntries(app.store.listInstallations(accountId).map((i) => [i.teamId, i.status]));
    assert.deepEqual(byTeam, { T1: "revoked", T2: "active" });
  });
});
