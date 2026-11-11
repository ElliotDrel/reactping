import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { beforeEach, describe, it } from "node:test";
import { LEASE_MS, type Installation, type Store } from "../src/db.ts";
import { DeliveryWorker, MAX_ATTEMPTS, formatNotification } from "../src/delivery.ts";
import { SlackCallError } from "../src/slack.ts";
import { Clock, createAccount, dbSkip, FakeSlack, makeStore, seedInstallation, useDatabase } from "./helpers.ts";

describe("delivery worker", { skip: dbSkip }, () => {
  const db = useDatabase();
  let store: Store;
  let slack: FakeSlack;
  let clock: Clock;
  let worker: DeliveryWorker;
  let accountId: string;
  let t1: Installation;
  let key: Buffer<ArrayBuffer>;

  let n = 0;
  async function enqueue(source: Installation = t1): Promise<number> {
    await store.enqueueDelivery({
      eventId: `EvTEST${++n}`,
      sourceInstallationId: source.id,
      reactorId: "UREACTOR",
      reaction: "tada",
      channelId: "C123",
      messageTs: "1700000000.000100",
    });
    const { rows } = await store.pool.query("select max(id)::int as id from reactping.deliveries");
    return Number(rows[0].id);
  }

  beforeEach(async () => {
    clock = new Clock();
    key = randomBytes(32);
    store = makeStore(db.pool(), clock, key);
    slack = new FakeSlack();
    worker = new DeliveryWorker(store, slack, clock.now);
    accountId = await createAccount(store);
    t1 = await seedInstallation(store, accountId, "T1", "UAUTHOR");
  });

  describe("routing", () => {
    it("DMs the author in the source workspace by default, mentioning the reactor", async () => {
      const id = await enqueue();
      await worker.drain();
      const [post] = slack.callsTo("postMessage");
      assert.deepEqual(post!.args.slice(0, 2), ["xoxb-T1", "UAUTHOR"]);
      assert.match(
        String(post!.args[2]),
        /^<@UREACTOR> reacted :tada: to your message in \*Team T1\*\. <https:\/\/acme/,
      );
      assert.equal(slack.callsTo("getPermalink")[0]!.args[0], "xoxp-T1-UAUTHOR");
      assert.equal((await store.getDeliveryStatus(id))!.status, "sent");
    });

    it("does not send across workspaces without consent", async () => {
      const t2 = await seedInstallation(store, accountId, "T2", "UAUTHOR2");
      await store.setDestination(accountId, t2.id, false);
      await enqueue();
      await worker.drain();
      assert.equal(slack.callsTo("postMessage")[0]!.args[1], "UAUTHOR");
    });

    it("sends across workspaces with consent using a neutral actor label", async () => {
      const t2 = await seedInstallation(store, accountId, "T2", "UAUTHOR2");
      await store.setDestination(accountId, t2.id, true);
      await enqueue();
      await worker.drain();
      const [post] = slack.callsTo("postMessage");
      assert.deepEqual(post!.args.slice(0, 2), ["xoxb-T2", "UAUTHOR2"]);
      assert.match(String(post!.args[2]), /^Someone reacted :tada: to your message in \*Team T1\*/);
      assert.ok(!String(post!.args[2]).includes("UREACTOR"));
    });

    it("falls back to the source workspace if the chosen destination is revoked", async () => {
      const t2 = await seedInstallation(store, accountId, "T2", "UAUTHOR2");
      await store.setDestination(accountId, t2.id, true);
      await store.markRevoked({ id: t2.id });
      await enqueue();
      await worker.drain();
      assert.equal(slack.callsTo("postMessage")[0]!.args[0], "xoxb-T1");
    });

    it("uses the archive URL fallback when chat.getPermalink fails", async () => {
      slack.getPermalink = async () => {
        throw new SlackCallError("permanent", "channel_not_found");
      };
      await enqueue();
      await worker.drain();
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
      const id = await enqueue();
      await store.markRevoked({ id: t1.id });
      await worker.drain();
      assert.equal(slack.callsTo("postMessage").length, 0);
      assert.equal((await store.getDeliveryStatus(id))!.lastError, "source_revoked");
    });
  });

  describe("retries", () => {
    it("honors Retry-After on rate limits and pauses the batch", async () => {
      let calls = 0;
      slack.postMessage = async () => {
        calls++;
        if (calls === 1) throw new SlackCallError("rate_limited", "ratelimited", 30);
      };
      const first = await enqueue();
      await enqueue();
      await worker.drain();
      assert.equal(calls, 1);
      clock.t += 29_000;
      await worker.drain();
      assert.equal(calls, 1);
      clock.t += 1_000;
      await worker.drain();
      assert.equal(calls, 3);
      assert.equal((await store.getDeliveryStatus(first))!.status, "sent");
    });

    it("retries ambiguous transient failures with bounded backoff, then gives up", async () => {
      let calls = 0;
      slack.postMessage = async () => {
        calls++;
        throw new SlackCallError("transient", "request_failed");
      };
      const id = await enqueue();
      for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
        await worker.drain();
        clock.t += 16 * 60_000;
      }
      assert.equal(calls, MAX_ATTEMPTS);
      assert.deepEqual(await store.getDeliveryStatus(id), {
        status: "failed",
        attempts: MAX_ATTEMPTS,
        lastError: "request_failed",
      });
    });

    it("persists exponential retry timing between attempts", async () => {
      slack.postMessage = async () => {
        throw new SlackCallError("transient", "request_failed");
      };
      const id = await enqueue();
      await worker.drain();
      const { rows } = await store.pool.query("select next_attempt_at from reactping.deliveries where id = $1", [id]);
      assert.equal((rows[0].next_attempt_at as Date).getTime(), clock.t + 10_000);
      clock.t += 9_999;
      await worker.drain();
      assert.equal((await store.getDeliveryStatus(id))!.attempts, 1);
    });

    it("does not retry permanent errors", async () => {
      slack.postMessage = async () => {
        throw new SlackCallError("permanent", "channel_not_found");
      };
      const id = await enqueue();
      await worker.drain();
      clock.t += 60 * 60_000;
      await worker.drain();
      assert.equal((await store.getDeliveryStatus(id))!.attempts, 1);
      assert.equal((await store.getDeliveryStatus(id))!.status, "failed");
    });

    it("marks the destination revoked on auth errors", async () => {
      slack.postMessage = async () => {
        throw new SlackCallError("revoked", "token_revoked");
      };
      await enqueue();
      await worker.drain();
      assert.equal((await store.getInstallation(t1.id))!.status, "revoked");
      assert.equal((await store.getInstallation(t1.id))!.botToken, null);
    });

    it("survives a restart: pending rows persist and are retried by a new worker", async () => {
      slack.postMessage = async () => {
        throw new SlackCallError("transient", "request_failed");
      };
      const id = await enqueue();
      await worker.drain();
      // A fresh serverless instance: new Store and worker, same database and key.
      const restarted = new DeliveryWorker(makeStore(db.pool(), clock, key), new FakeSlack(), clock.now);
      clock.t += 60_000;
      await restarted.drain();
      assert.equal((await store.getDeliveryStatus(id))!.status, "sent");
    });
  });

  describe("claiming and leases", () => {
    it("never sends one delivery twice when workers drain concurrently", async () => {
      const ids = [];
      for (let i = 0; i < 12; i++) ids.push(await enqueue());
      slack.postMessage = async (token, channel, text) => {
        await sleep(15);
        slack.calls.push({ method: "postMessage", args: [token, channel, text] });
      };
      const workers = Array.from({ length: 4 }, () => new DeliveryWorker(store, slack, clock.now));
      const processed = await Promise.all(workers.map((w) => w.drain()));
      assert.equal(
        processed.reduce((a, b) => a + b, 0),
        12,
      );
      assert.equal(slack.callsTo("postMessage").length, 12);
      for (const id of ids) assert.equal((await store.getDeliveryStatus(id))!.status, "sent");
    });

    it("recovers a delivery whose worker died mid-send once the lease expires", async () => {
      const id = await enqueue();
      const stale = (await store.claimDelivery())!;
      await worker.drain();
      assert.equal(slack.callsTo("postMessage").length, 0, "leased row is not claimable");
      clock.t += LEASE_MS;
      await worker.drain();
      assert.equal(slack.callsTo("postMessage").length, 1);
      assert.deepEqual(await store.getDeliveryStatus(id), { status: "sent", attempts: 2, lastError: null });
      assert.equal(await store.finishDelivery(stale, "failed", "late"), false, "stale lease cannot overwrite");
      assert.equal((await store.getDeliveryStatus(id))!.status, "sent");
    });

    it("fails a delivery that keeps crashing instead of retrying forever", async () => {
      const id = await enqueue();
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await store.claimDelivery();
        clock.t += LEASE_MS;
      }
      await worker.drain();
      assert.equal(slack.callsTo("postMessage").length, 0);
      assert.equal((await store.getDeliveryStatus(id))!.lastError, "attempts_exhausted");
    });
  });

  describe("retention", () => {
    it("purges event data and OAuth state past their TTL", async () => {
      await enqueue();
      await store.createOAuthState(accountId, "nonce", "browser");
      clock.t += 49 * 60 * 60 * 1000;
      await store.purgeExpired(48 * 60 * 60 * 1000);
      const count = async (table: string) =>
        Number((await store.pool.query(`select count(*)::int as n from reactping.${table}`)).rows[0].n);
      assert.equal(await count("deliveries"), 0);
      assert.equal(await count("oauth_states"), 0);
      assert.equal(await count("installations"), 1);
    });
  });
});
