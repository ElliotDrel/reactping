import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import type { Installation, Store } from "../src/db.ts";
import { DeliveryWorker } from "../src/delivery.ts";
import { SlackCallError } from "../src/slack.ts";
import {
  Browser,
  Clock,
  createAccount,
  dbSkip,
  FakeSlack,
  makeStore,
  oauthResult,
  seedInstallation,
  startApp,
  useDatabase,
} from "./helpers.ts";

const PERMALINK = "https://acme.slack.com/archives/C123/p1700000000000100";

function enqueue(store: Store, source: Installation, eventId = "EvREVIEW1"): Promise<boolean> {
  return store.enqueueDelivery({
    eventId,
    sourceInstallationId: source.id,
    reactorId: "UREACTOR",
    reaction: "tada",
    channelId: "C123",
    messageTs: "1700000000.000100",
  });
}

describe("regressions", { skip: dbSkip }, () => {
  const db = useDatabase();
  let clock: Clock;
  let key: Buffer<ArrayBuffer>;
  let store: Store;
  let slack: FakeSlack;
  let accountId: string;
  let source: Installation;
  let worker: DeliveryWorker;
  beforeEach(async () => {
    clock = new Clock();
    key = randomBytes(32);
    store = makeStore(db.pool(), clock, key);
    slack = new FakeSlack();
    accountId = await createAccount(store);
    source = await seedInstallation(store, accountId, "T1", "UAUTHOR");
    worker = new DeliveryWorker(store, slack, clock.now);
  });

  describe("delivery ordering", () => {
    it("does not deliver after the source is revoked during permalink lookup", async () => {
      slack.getPermalink = async () => {
        await store.markRevoked({ id: source.id });
        return PERMALINK;
      };
      await enqueue(store, source);
      await worker.drain();
      assert.equal(slack.callsTo("postMessage").length, 0);
      assert.equal((await store.getDeliveryStatus(1))?.lastError, "source_changed");
    });

    it("rechecks routing consent after permalink lookup", async () => {
      const destination = await seedInstallation(store, accountId, "T2", "UDEST");
      await store.setDestination(accountId, destination.id, true);
      slack.getPermalink = async () => {
        await store.setDestination(accountId, null, false);
        return PERMALINK;
      };
      await enqueue(store, source);
      await worker.drain();
      assert.equal(slack.callsTo("postMessage")[0]?.args[0], "xoxb-T1");
    });

    it("does not send an old account's event after its source identity moves", async () => {
      slack.getPermalink = async () => {
        const account = await createAccount(store);
        await seedInstallation(store, account, "T1", "UAUTHOR");
        return PERMALINK;
      };
      await enqueue(store, source);
      await worker.drain();
      assert.equal(slack.callsTo("postMessage").length, 0);
    });

    it("fails and revokes the source when permalink lookup reports revoked credentials", async () => {
      slack.getPermalink = async () => {
        throw new SlackCallError("revoked", "token_revoked");
      };
      await enqueue(store, source);
      await worker.drain();
      assert.equal((await store.getInstallation(source.id))?.status, "revoked");
      assert.equal(slack.callsTo("postMessage").length, 0);
      assert.equal((await store.getDeliveryStatus(1))?.lastError, "token_revoked");
    });

    it("keeps the full permalink Retry-After and queue pause across serverless instances", async () => {
      await enqueue(store, source);
      await enqueue(store, source, "EvREVIEW2");
      const throttled = new FakeSlack();
      throttled.getPermalink = async () => {
        throw new SlackCallError("rate_limited", "ratelimited", 3600);
      };
      await new DeliveryWorker(store, throttled, clock.now).drain();
      assert.equal(throttled.callsTo("postMessage").length, 0);
      assert.equal(await store.deliveryPausedUntil(), clock.t + 3_600_000);
      // Another instance: new Store and worker over the same database.
      const recovered = new FakeSlack();
      const other = new DeliveryWorker(makeStore(db.pool(), clock, key), recovered, clock.now);
      clock.t += 16 * 60_000;
      await other.drain();
      assert.equal(recovered.calls.length, 0);
      clock.t += 44 * 60_000;
      await other.drain();
      assert.equal(recovered.callsTo("postMessage").length, 2);
      assert.equal((await store.getDeliveryStatus(1))?.status, "sent");
      assert.equal((await store.getDeliveryStatus(2))?.status, "sent");
    });
  });

  describe("disconnect ordering", () => {
    it("can revoke the retained bot grant after its user's authorization was revoked", async () => {
      const app = startApp(db.pool());
      const b = await Browser.signIn(app);
      await b.connect("T1", "UAUTHOR");
      const inst = (await app.store.listInstallations(b.accountId))[0]!;
      await app.store.markRevoked({ id: inst.id }, "user");
      assert.equal((await app.store.getInstallation(inst.id))?.botToken, "xoxb-T1");
      const response = await b.post("/api/installations/disconnect", { installation: inst.id });
      assert.deepEqual(await response.json(), { revoked: true });
      assert.deepEqual(
        app.slack.callsTo("revoke").map((call) => call.args[0]),
        ["xoxb-T1"],
      );
    });

    it("does not revoke a shared bot grant when another active user's rejected install is cleaned up", async () => {
      const app = startApp(db.pool());
      const existing = await Browser.signIn(app);
      await existing.connect("T1", "UEXISTING");
      const b = await Browser.signIn(app);
      app.slack.oauthResults.set("missing-scope", oauthResult("T1", "UNEW", { userScopes: [] }));
      const response = await b.callback({ code: "missing-scope", state: await b.beginInstall() });
      assert.equal(response.headers.get("location"), "/app?slack=missing_scope");
      assert.deepEqual(
        app.slack.callsTo("revoke").map((call) => call.args[0]),
        ["xoxp-T1-UNEW"],
      );
      assert.equal((await app.store.findActiveInstallation("T1", "UEXISTING"))?.botToken, "xoxb-T1");
    });

    it("removes the local installation before asking Slack to revoke its tokens", async () => {
      const app = startApp(db.pool());
      const b = await Browser.signIn(app);
      await b.connect("T1", "UAUTHOR");
      const inst = (await app.store.listInstallations(b.accountId))[0]!;
      await enqueue(app.store, inst);
      app.slack.revoke = async () => {
        assert.equal(await app.store.getInstallation(inst.id), undefined);
        assert.equal((await app.store.pendingDeliveries()).length, 0);
        throw new SlackCallError("transient", "request_failed");
      };
      const response = await b.post("/api/installations/disconnect", { installation: inst.id });
      assert.deepEqual(await response.json(), { revoked: false });
    });

    it("deletes all local account data, including OAuth state, before remote revocation", async () => {
      const app = startApp(db.pool());
      const b = await Browser.signIn(app);
      await b.connect("T1", "UAUTHOR");
      await b.connect("T2", "UDEST");
      await b.beginInstall();
      app.slack.revoke = async () => {
        assert.equal(await app.store.getAccount(b.accountId), undefined);
        assert.equal((await app.store.listInstallations(b.accountId)).length, 0);
        assert.equal((await app.store.pool.query("select 1 from reactping.oauth_states")).rowCount, 0);
      };
      assert.equal((await b.post("/api/account/delete", { confirm: "delete" })).status, 200);
    });
  });
});
