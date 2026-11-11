import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  createAccount,
  dbSkip,
  reactionEvent,
  seedInstallation,
  signedEvent,
  startApp,
  useDatabase,
  type TestApp,
} from "./helpers.ts";

describe("Slack events", { skip: dbSkip }, () => {
  const db = useDatabase();
  let app: TestApp;
  let accountId: string;
  beforeEach(async () => {
    app = startApp(db.pool());
    accountId = await createAccount(app.store);
    await seedInstallation(app.store, accountId, "T1", "UAUTHOR");
  });

  const pending = () => app.store.pendingDeliveries();

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
      const unsigned = await app.api(
        new Request(`${app.config.siteUrl}/api/slack/events`, { method: "POST", body: "{}" }),
      );
      assert.equal(unsigned.status, 401);
      assert.equal((await pending()).length, 0);
    });
  });

  describe("reaction filtering and routing", () => {
    it("enqueues a reaction on a connected author's message, routed by item_user not authorizations", async () => {
      const res = await signedEvent(app, reactionEvent("T1"));
      assert.equal(res.status, 200);
      const [d] = await pending();
      assert.equal(d!.reactor_id, "UREACTOR");
      assert.equal(d!.source_installation_id, (await app.store.findActiveInstallation("T1", "UAUTHOR"))!.id);
    });

    it("acknowledges only after the delivery is durable, then tries delivery in the background", async () => {
      const res = await signedEvent(app, reactionEvent("T1"));
      assert.equal(res.status, 200);
      assert.equal((await pending()).length, 1);
      assert.equal(app.slack.callsTo("postMessage").length, 0);
      await app.settle();
      assert.equal(app.slack.callsTo("postMessage").length, 1);
    });

    it("stores only minimal metadata", async () => {
      await signedEvent(app, reactionEvent("T1"));
      const [row] = await pending();
      assert.deepEqual(Object.keys(row!).sort(), [
        "attempts",
        "channel_id",
        "created_at",
        "event_id",
        "id",
        "last_error",
        "lease_token",
        "lease_until",
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
      assert.equal((await pending()).length, 0);
    });

    it("deduplicates Slack retries by event and recipient", async () => {
      const event = reactionEvent("T1", { event_id: "EvDUPLICATE1" });
      assert.equal((await signedEvent(app, event)).status, 200);
      assert.equal((await signedEvent(app, event)).status, 200);
      assert.equal((await pending()).length, 1);
      assert.equal(app.background.length, 1);
    });

    it("includes self-reactions only in testing mode and still deduplicates retries", async () => {
      app.config.includeSelfReactions = true;
      const event = reactionEvent("T1", { user: "UAUTHOR", event_id: "EvSELFTEST1" });
      assert.equal((await signedEvent(app, event)).status, 200);
      assert.equal((await signedEvent(app, event)).status, 200);
      const rows = await pending();
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.reactor_id, "UAUTHOR");
      const health = (await (await app.api(new Request(`${app.config.siteUrl}/api/health`))).json()) as {
        testingMode: boolean;
      };
      assert.equal(health.testingMode, true);
    });

    it("keeps testing mode limited to connected authors in the matching workspace", async () => {
      app.config.includeSelfReactions = true;
      await signedEvent(app, reactionEvent("T1", { item_user: "UOTHER", user: "UOTHER" }));
      await signedEvent(app, reactionEvent("T2", { user: "UAUTHOR" }));
      assert.equal((await pending()).length, 0);
    });

    it("routes a reaction only to the author's own installation", async () => {
      const other = await createAccount(app.store);
      await seedInstallation(app.store, other, "T1", "UREACTOR");
      await signedEvent(app, reactionEvent("T1"));
      const rows = await pending();
      assert.equal(rows.length, 1);
      assert.equal((await app.store.getInstallation(String(rows[0]!.source_installation_id)))!.accountId, accountId);
    });

    it("returns 500 when it cannot record the event so Slack retries", async () => {
      await app.store.pool.query("alter table reactping.deliveries rename to deliveries_moved");
      try {
        assert.equal((await signedEvent(app, reactionEvent("T1"))).status, 500);
      } finally {
        await app.store.pool.query("alter table reactping.deliveries_moved rename to deliveries");
      }
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
      const [inst] = await app.store.listInstallations(accountId);
      assert.equal(inst!.status, "revoked");
      assert.equal(inst!.userToken, null);
      assert.equal(inst!.botToken, "xoxb-T1");
      await signedEvent(app, reactionEvent("T1"));
      assert.equal((await pending()).length, 0);
    });

    it("app_uninstalled revokes every installation in that workspace only", async () => {
      await seedInstallation(app.store, accountId, "T2", "UAUTHOR2");
      await signedEvent(app, {
        type: "event_callback",
        team_id: "T1",
        event_id: "EvUNINST1",
        event: { type: "app_uninstalled" },
      });
      const installs = await app.store.listInstallations(accountId);
      const byTeam = Object.fromEntries(installs.map((i) => [i.teamId, i.status]));
      assert.deepEqual(byTeam, { T1: "revoked", T2: "active" });
    });
  });
});
