import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Store, type Installation } from "../src/db.ts";
import { DeliveryWorker, MAX_ATTEMPTS, formatNotification } from "../src/delivery.ts";
import { SlackCallError } from "../src/slack.ts";
import { Clock, FakeSlack, seedInstallation } from "./helpers.ts";

process.env.NODE_ENV = "test";

let store: Store;
let slack: FakeSlack;
let clock: Clock;
let worker: DeliveryWorker;
let accountId: string;
let t1: Installation;

let n = 0;
function enqueue(source: Installation = t1): number {
  store.enqueueDelivery({
    eventId: `EvTEST${++n}`,
    sourceInstallationId: source.id,
    reactorId: "UREACTOR",
    reaction: "tada",
    channelId: "C123",
    messageTs: "1700000000.000100",
  });
  return Number((store.db.prepare("SELECT max(id) AS id FROM deliveries").get() as { id: number }).id);
}

beforeEach(() => {
  clock = new Clock();
  store = new Store(":memory:", randomBytes(32), clock.now);
  slack = new FakeSlack();
  worker = new DeliveryWorker(store, slack, clock.now);
  accountId = store.createAccountSession().session.accountId;
  t1 = seedInstallation(store, accountId, "T1", "UAUTHOR");
});
afterEach(() => store.close());

describe("delivery routing", () => {
  it("DMs the author in the source workspace by default, mentioning the reactor", async () => {
    const id = enqueue();
    await worker.runOnce();
    const [post] = slack.callsTo("postMessage");
    assert.deepEqual(post!.args.slice(0, 2), ["xoxb-T1", "UAUTHOR"]);
    assert.match(String(post!.args[2]), /^<@UREACTOR> reacted :tada: to your message in \*Team T1\*\. <https:\/\/acme/);
    assert.equal(slack.callsTo("getPermalink")[0]!.args[0], "xoxp-T1-UAUTHOR");
    assert.equal(store.getDeliveryStatus(id)!.status, "sent");
  });

  it("does not send across workspaces without consent", async () => {
    const t2 = seedInstallation(store, accountId, "T2", "UAUTHOR2");
    store.setDestination(accountId, t2.id, false);
    enqueue();
    await worker.runOnce();
    assert.equal(slack.callsTo("postMessage")[0]!.args[1], "UAUTHOR");
  });

  it("sends across workspaces with consent using a neutral actor label", async () => {
    const t2 = seedInstallation(store, accountId, "T2", "UAUTHOR2");
    store.setDestination(accountId, t2.id, true);
    enqueue();
    await worker.runOnce();
    const [post] = slack.callsTo("postMessage");
    assert.deepEqual(post!.args.slice(0, 2), ["xoxb-T2", "UAUTHOR2"]);
    assert.match(String(post!.args[2]), /^Someone reacted :tada: to your message in \*Team T1\*/);
    assert.ok(!String(post!.args[2]).includes("UREACTOR"));
  });

  it("falls back to the source workspace if the chosen destination is revoked", async () => {
    const t2 = seedInstallation(store, accountId, "T2", "UAUTHOR2");
    store.setDestination(accountId, t2.id, true);
    store.markRevoked({ id: t2.id });
    enqueue();
    await worker.runOnce();
    assert.equal(slack.callsTo("postMessage")[0]!.args[0], "xoxb-T1");
  });

  it("uses the archive URL fallback when chat.getPermalink fails", async () => {
    slack.getPermalink = async () => {
      throw new SlackCallError("permanent", "channel_not_found");
    };
    enqueue();
    await worker.runOnce();
    assert.match(
      String(slack.callsTo("postMessage")[0]!.args[2]),
      /<https:\/\/acme\.slack\.com\/archives\/C123\/p1700000000000100\|View message>/,
    );
  });

  it("escapes mrkdwn control characters from Slack-provided names", () => {
    const text = formatNotification(
      { reactorId: "U1", reaction: "x" },
      { ...t1, teamName: "<!channel> & co" },
      false,
      null,
    );
    assert.ok(text.includes("&lt;!channel&gt; &amp; co"));
    assert.ok(!text.includes("<!channel>"));
  });

  it("skips deliveries whose source was disconnected or revoked", async () => {
    const id = enqueue();
    store.markRevoked({ id: t1.id });
    await worker.runOnce();
    assert.equal(slack.callsTo("postMessage").length, 0);
    assert.equal(store.getDeliveryStatus(id)!.lastError, "source_revoked");
  });
});

describe("retries", () => {
  it("honors Retry-After on rate limits and pauses the batch", async () => {
    let calls = 0;
    slack.postMessage = async () => {
      calls++;
      if (calls === 1) throw new SlackCallError("rate_limited", "ratelimited", 30);
    };
    const first = enqueue();
    enqueue();
    await worker.runOnce();
    assert.equal(calls, 1);
    clock.t += 29_000;
    await worker.runOnce();
    assert.equal(calls, 1);
    clock.t += 1_000;
    await worker.runOnce();
    assert.equal(calls, 3);
    assert.equal(store.getDeliveryStatus(first)!.status, "sent");
  });

  it("retries ambiguous transient failures with bounded backoff, then gives up", async () => {
    let calls = 0;
    slack.postMessage = async () => {
      calls++;
      throw new SlackCallError("transient", "request_failed");
    };
    const id = enqueue();
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
      await worker.runOnce();
      clock.t += 16 * 60_000;
    }
    assert.equal(calls, MAX_ATTEMPTS);
    assert.deepEqual(store.getDeliveryStatus(id), {
      status: "failed",
      attempts: MAX_ATTEMPTS,
      lastError: "request_failed",
    });
  });

  it("does not retry permanent errors", async () => {
    slack.postMessage = async () => {
      throw new SlackCallError("permanent", "channel_not_found");
    };
    const id = enqueue();
    await worker.runOnce();
    clock.t += 60 * 60_000;
    await worker.runOnce();
    assert.equal(store.getDeliveryStatus(id)!.attempts, 1);
    assert.equal(store.getDeliveryStatus(id)!.status, "failed");
  });

  it("marks the destination revoked on auth errors", async () => {
    slack.postMessage = async () => {
      throw new SlackCallError("revoked", "token_revoked");
    };
    enqueue();
    await worker.runOnce();
    assert.equal(store.getInstallation(t1.id)!.status, "revoked");
    assert.equal(store.getInstallation(t1.id)!.botToken, null);
  });

  it("survives a restart: pending rows persist and are retried by a new worker", async () => {
    slack.postMessage = async () => {
      throw new SlackCallError("transient", "request_failed");
    };
    const id = enqueue();
    await worker.runOnce();
    const restarted = new DeliveryWorker(store, new FakeSlack(), clock.now);
    clock.t += 60_000;
    await restarted.runOnce();
    assert.equal(store.getDeliveryStatus(id)!.status, "sent");
  });
});

describe("retention", () => {
  it("purges event data, sessions, and OAuth state past their TTL", () => {
    enqueue();
    store.createOAuthState("nonce", "hash");
    clock.t += 49 * 60 * 60 * 1000;
    store.purgeExpired(48 * 60 * 60 * 1000);
    const count = (table: string) =>
      Number((store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
    assert.equal(count("deliveries"), 0);
    assert.equal(count("oauth_states"), 0);
    assert.equal(count("sessions"), 1);
    clock.t += 30 * 24 * 60 * 60 * 1000;
    store.purgeExpired(48 * 60 * 60 * 1000);
    assert.equal(count("sessions"), 0);
  });
});
