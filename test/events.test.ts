import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { SlackCallError } from "../src/slack.ts";
import {
  dbSkip,
  eventEnvelope,
  reactionEvent,
  seed,
  signedEvent,
  signedPost,
  SITE,
  startApp,
  useDatabase,
  type TestApp,
} from "./helpers.ts";

describe("Slack events", { skip: dbSkip }, () => {
  const db = useDatabase();
  let app: TestApp;
  beforeEach(async () => {
    app = startApp(db.pool());
    await seed(app, "T1", "UAUTHOR");
  });

  const dms = () => app.slack.callsTo("postMessage").map((c) => c.args);

  describe("request checks", () => {
    it("answers Slack's URL verification challenge", async () => {
      const res = await signedEvent(app, { type: "url_verification", challenge: "abc123" });
      assert.deepEqual([res.status, await res.text()], [200, "abc123"]);
    });

    it("rejects missing, invalid, and stale signatures before reading the event", async () => {
      const body = JSON.stringify(reactionEvent("T1"));
      const unsigned = await app.handler(new Request(`${SITE}/api/slack/events`, { method: "POST", body }));
      const wrong = await signedPost(app, "/api/slack/events", body, { secret: "wrong" });
      const stale = await signedPost(app, "/api/slack/events", body, { timestamp: app.clock.t / 1000 - 600 });
      for (const res of [unsigned, wrong, stale]) assert.equal(res.status, 401);
      await app.settle();
      assert.equal(dms().length, 0);
    });

    it("rejects oversized bodies and invalid JSON", async () => {
      const big = await signedPost(app, "/api/slack/events", "x".repeat(300 * 1024));
      assert.equal(big.status, 413);
      assert.equal((await signedPost(app, "/api/slack/events", "{not json")).status, 400);
    });

    it("returns 404 for unknown routes and methods", async () => {
      assert.equal((await app.handler(new Request(`${SITE}/api/slack/events`))).status, 404);
      assert.equal((await app.handler(new Request(`${SITE}/api/nope`))).status, 404);
    });
  });

  describe("reaction notifications", () => {
    it("acknowledges before doing the work, then DMs the author in the same workspace", async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const post = app.slack.postMessage.bind(app.slack);
      app.slack.postMessage = async (...args) => {
        await gate;
        return post(...args);
      };
      const res = await signedEvent(app, reactionEvent("T1", { reaction: "tada" }));
      assert.equal(res.status, 200, "acknowledged while the DM is still blocked");
      assert.equal(app.pending.length, 1);
      release();
      await app.settle();
      assert.deepEqual(dms(), [
        [
          "xoxb-T1",
          "UAUTHOR",
          "<@UREACTOR> reacted :tada: to <https://acme.slack.com/archives/C123ABC/p1700000000000100|your message>",
        ],
      ]);
      assert.equal(app.slack.callsTo("revoke").length, 0);
    });

    it("adds a preview fetched with the author's user token, and falls back without one on failure", async () => {
      app.slack.messageText = "Deployed to prod";
      await signedEvent(app, reactionEvent("T1", { reaction: "tada" }));
      await app.settle();
      const [fetch] = app.slack.callsTo("reactedMessageText");
      assert.deepEqual(fetch!.args, ["xoxp-T1-UAUTHOR", "C123ABC", "1700000000.000100"]);
      assert.match(String(dms()[0]![2]), /\|your message>\n>"Deployed to prod"$/);

      app.slack.reactedMessageText = async () => {
        throw new Error("missing_scope");
      };
      await signedEvent(app, reactionEvent("T1", { reaction: "tada" }));
      await app.settle();
      assert.match(String(dms()[1]![2]), /\|your message>$/);
    });

    it("ignores Slack retries without doing the work again", async () => {
      const res = await signedEvent(app, reactionEvent("T1"), {
        "x-slack-retry-num": "1",
        "x-slack-retry-reason": "http_timeout",
      });
      assert.equal(res.status, 200);
      assert.equal(app.pending.length, 0);
      await app.settle();
      assert.equal(dms().length, 0);
    });

    it("notifies only for other people's reactions to a connected author's messages", async () => {
      await signedEvent(app, reactionEvent("T1", { user: "UAUTHOR" })); // own reaction
      await signedEvent(app, reactionEvent("T1", { item_user: "UNOBODY" })); // author not connected
      await signedEvent(app, reactionEvent("T1", { item: { type: "file", file: "F1" } })); // not a message
      await signedEvent(app, reactionEvent("T1", { reaction: "<!channel>" })); // malformed
      await signedEvent(app, reactionEvent("T1", { item: { type: "message", channel: "C1", ts: "1.5" } }));
      await signedEvent(app, eventEnvelope("T1", { type: "reaction_removed", user: "U2", item_user: "UAUTHOR" }));
      await app.settle();
      assert.equal(dms().length, 0);
    });

    it("never crosses workspaces: the same user ID in another workspace is a different person", async () => {
      await signedEvent(app, reactionEvent("T2"));
      await app.settle();
      assert.equal(dms().length, 0);
      await seed(app, "T2", "UAUTHOR");
      await signedEvent(app, reactionEvent("T2"));
      await app.settle();
      assert.deepEqual(
        dms().map((args) => args.slice(0, 2)),
        [["xoxb-T2", "UAUTHOR"]],
      );
    });

    it("includes self-reactions only in testing mode", async () => {
      const testing = startApp(db.pool(), { includeSelfReactions: true });
      await seed(testing, "T1", "UAUTHOR");
      await signedEvent(testing, reactionEvent("T1", { user: "UAUTHOR" }));
      await testing.settle();
      assert.equal(testing.slack.callsTo("postMessage").length, 1);
    });

    it("drops the installation when Slack says its credentials are dead, and otherwise just logs", async () => {
      app.slack.postMessage = async () => {
        throw new SlackCallError("failed", "channel_not_found");
      };
      await signedEvent(app, reactionEvent("T1"));
      await app.settle();
      assert.ok(await app.store.get("T1", "UAUTHOR"));
      app.slack.postMessage = async () => {
        throw new SlackCallError("revoked", "token_revoked");
      };
      await signedEvent(app, reactionEvent("T1"));
      await app.settle();
      assert.equal(await app.store.get("T1", "UAUTHOR"), undefined);
    });

    it("keeps a fresh reinstall when an older request's DM fails as revoked", async () => {
      app.slack.postMessage = async () => {
        app.clock.t += 1000;
        await seed(app, "T1", "UAUTHOR"); // reinstalled while the DM was in flight
        throw new SlackCallError("revoked", "token_revoked");
      };
      await signedEvent(app, reactionEvent("T1"));
      await app.settle();
      assert.ok(await app.store.get("T1", "UAUTHOR"));
    });
  });

  describe("App Home", () => {
    it("publishes the connected Home view for a connected user, after responding", async () => {
      const res = await signedEvent(
        app,
        eventEnvelope("T1", { type: "app_home_opened", user: "UAUTHOR", tab: "home" }),
      );
      assert.equal(res.status, 200);
      await app.settle();
      const [call] = app.slack.callsTo("publishHome");
      assert.deepEqual(call!.args.slice(0, 2), ["xoxb-T1", "UAUTHOR"]);
      assert.match(JSON.stringify(call!.args[2]), /"action_id":"disconnect"/);
    });

    it("does nothing for the Messages tab or users who are not connected", async () => {
      await signedEvent(app, eventEnvelope("T1", { type: "app_home_opened", user: "UAUTHOR", tab: "messages" }));
      await signedEvent(app, eventEnvelope("T1", { type: "app_home_opened", user: "UOTHER", tab: "home" }));
      await app.settle();
      assert.equal(app.slack.callsTo("publishHome").length, 0);
    });
  });

  describe("lifecycle events", () => {
    beforeEach(async () => {
      await seed(app, "T1", "UOTHER");
      await seed(app, "T2", "UAUTHOR");
    });

    it("app_uninstalled deletes that workspace's installations only, before acknowledging, even on retries", async () => {
      const res = await signedEvent(app, eventEnvelope("T1", { type: "app_uninstalled" }), {
        "x-slack-retry-num": "2",
      });
      assert.equal(res.status, 200);
      assert.equal(await app.store.get("T1", "UAUTHOR"), undefined);
      assert.equal(await app.store.get("T1", "UOTHER"), undefined);
      assert.ok(await app.store.get("T2", "UAUTHOR"));
    });

    it("tokens_revoked for user tokens deletes only those users in that workspace", async () => {
      await signedEvent(app, eventEnvelope("T1", { type: "tokens_revoked", tokens: { oauth: ["UAUTHOR"], bot: [] } }));
      assert.equal(await app.store.get("T1", "UAUTHOR"), undefined);
      assert.ok(await app.store.get("T1", "UOTHER"));
      assert.ok(await app.store.get("T2", "UAUTHOR"));
    });

    it("tokens_revoked for the bot token deletes the whole workspace (nobody can be DMed)", async () => {
      await signedEvent(app, eventEnvelope("T1", { type: "tokens_revoked", tokens: { bot: ["UBOT"] } }));
      assert.equal(await app.store.get("T1", "UOTHER"), undefined);
      assert.ok(await app.store.get("T2", "UAUTHOR"));
    });

    it("returns an error (so Slack retries) when lifecycle cleanup cannot reach the database", async () => {
      app.store.deleteTeam = async () => {
        throw new Error("connection lost");
      };
      const res = await signedEvent(app, eventEnvelope("T1", { type: "app_uninstalled" }));
      assert.equal(res.status, 500);
    });
  });
});
