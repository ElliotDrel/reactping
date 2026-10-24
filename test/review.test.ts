import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Store, type Installation } from "../src/db.ts";
import { DeliveryWorker } from "../src/delivery.ts";
import { SlackCallError } from "../src/slack.ts";
import { Browser, Clock, FakeSlack, oauthResult, seedInstallation, startApp } from "./helpers.ts";

function enqueue(store: Store, source: Installation, eventId = "EvREVIEW1"): void {
  store.enqueueDelivery({
    eventId,
    sourceInstallationId: source.id,
    reactorId: "UREACTOR",
    reaction: "tada",
    channelId: "C123",
    messageTs: "1700000000.000100",
  });
}

function fixture() {
  const clock = new Clock();
  const store = new Store(":memory:", randomBytes(32), clock.now);
  const slack = new FakeSlack();
  const accountId = store.createAccountSession().session.accountId;
  const source = seedInstallation(store, accountId, "T1", "UAUTHOR");
  return { store, slack, clock, accountId, source, worker: new DeliveryWorker(store, slack, clock.now) };
}

describe("delivery ordering regressions", () => {
  it("does not deliver after the source is revoked during permalink lookup", async () => {
    const f = fixture();
    try {
      f.slack.getPermalink = async () => {
        f.store.markRevoked({ id: f.source.id });
        return "https://acme.slack.com/archives/C123/p1700000000000100";
      };
      enqueue(f.store, f.source);
      await f.worker.runOnce();
      assert.equal(f.slack.callsTo("postMessage").length, 0);
      assert.equal(f.store.getDeliveryStatus(1)?.lastError, "source_changed");
    } finally {
      f.store.close();
    }
  });

  it("rechecks routing consent after permalink lookup", async () => {
    const f = fixture();
    try {
      const destination = seedInstallation(f.store, f.accountId, "T2", "UDEST");
      f.store.setDestination(f.accountId, destination.id, true);
      f.slack.getPermalink = async () => {
        f.store.setDestination(f.accountId, null, false);
        return "https://acme.slack.com/archives/C123/p1700000000000100";
      };
      enqueue(f.store, f.source);
      await f.worker.runOnce();
      assert.equal(f.slack.callsTo("postMessage")[0]?.args[0], "xoxb-T1");
    } finally {
      f.store.close();
    }
  });

  it("does not send an old account's event after its source identity moves", async () => {
    const f = fixture();
    try {
      f.slack.getPermalink = async () => {
        const account = f.store.createAccountSession().session.accountId;
        seedInstallation(f.store, account, "T1", "UAUTHOR");
        return "https://acme.slack.com/archives/C123/p1700000000000100";
      };
      enqueue(f.store, f.source);
      await f.worker.runOnce();
      assert.equal(f.slack.callsTo("postMessage").length, 0);
    } finally {
      f.store.close();
    }
  });

  it("fails and revokes the source when permalink lookup reports revoked credentials", async () => {
    const f = fixture();
    try {
      f.slack.getPermalink = async () => {
        throw new SlackCallError("revoked", "token_revoked");
      };
      enqueue(f.store, f.source);
      await f.worker.runOnce();
      assert.equal(f.store.getInstallation(f.source.id)?.status, "revoked");
      assert.equal(f.slack.callsTo("postMessage").length, 0);
      assert.equal(f.store.getDeliveryStatus(1)?.lastError, "token_revoked");
    } finally {
      f.store.close();
    }
  });

  it("keeps the full permalink Retry-After and queue pause through a real database reopen", async () => {
    const folder = mkdtempSync(join(tmpdir(), "reactping-retry-test-"));
    const path = join(folder, "queue.sqlite");
    const key = randomBytes(32);
    const clock = new Clock();
    let store = new Store(path, key, clock.now);
    try {
      const accountId = store.createAccountSession().session.accountId;
      const source = seedInstallation(store, accountId, "T1", "UAUTHOR");
      enqueue(store, source);
      enqueue(store, source, "EvREVIEW2");
      const throttled = new FakeSlack();
      throttled.getPermalink = async () => {
        throw new SlackCallError("rate_limited", "ratelimited", 3600);
      };
      await new DeliveryWorker(store, throttled, clock.now).runOnce();
      assert.equal(throttled.callsTo("postMessage").length, 0);
      assert.equal(store.deliveryPausedUntil(), clock.t + 3_600_000);
      store.close();
      store = new Store(path, key, clock.now);
      const recovered = new FakeSlack();
      const worker = new DeliveryWorker(store, recovered, clock.now);
      clock.t += 16 * 60_000;
      await worker.runOnce();
      assert.equal(recovered.calls.length, 0);
      clock.t += 44 * 60_000;
      await worker.runOnce();
      assert.equal(recovered.callsTo("postMessage").length, 2);
      assert.equal(store.getDeliveryStatus(1)?.status, "sent");
      assert.equal(store.getDeliveryStatus(2)?.status, "sent");
    } finally {
      store.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("stop waits for the in-flight delivery and leaves the rest queued", async () => {
    const f = fixture();
    try {
      let release!: (value: string) => void;
      f.slack.getPermalink = () =>
        new Promise<string>((resolve) => {
          release = resolve;
        });
      enqueue(f.store, f.source);
      enqueue(f.store, f.source, "EvREVIEW2");
      const run = f.worker.runOnce();
      let stopped = false;
      const stop = f.worker.stop().then(() => {
        stopped = true;
      });
      await Promise.resolve();
      assert.equal(stopped, false);
      release("https://acme.slack.com/archives/C123/p1700000000000100");
      await Promise.all([run, stop]);
      assert.equal(f.slack.callsTo("postMessage").length, 1);
      assert.equal(f.store.dueDeliveries(10).length, 1);
      await f.worker.runOnce();
      assert.equal(f.slack.callsTo("postMessage").length, 1);
    } finally {
      f.store.close();
    }
  });
});

describe("local disconnect ordering", () => {
  it("can revoke the retained bot grant after its user's authorization was revoked", async () => {
    const app = await startApp();
    try {
      const b = new Browser(app);
      await b.start();
      await b.connect("T1", "UAUTHOR");
      const source = app.store.listInstallations(b.accountId())[0]!;
      app.store.markRevoked({ id: source.id }, "user");
      assert.equal(app.store.getInstallation(source.id)?.botToken, "xoxb-T1");
      const response = await b.post("/installations/disconnect", { csrf: await b.csrf(), installation: source.id });
      assert.equal(response.headers.get("location"), "/settings?notice=disconnected");
      assert.deepEqual(
        app.slack.callsTo("revoke").map((call) => call.args[0]),
        ["xoxb-T1"],
      );
    } finally {
      await app.close();
    }
  });

  it("does not revoke a shared bot grant when another active user's rejected install is cleaned up", async () => {
    const app = await startApp();
    try {
      const existing = new Browser(app);
      await existing.start();
      await existing.connect("T1", "UEXISTING");
      const b = new Browser(app);
      await b.start();
      app.slack.oauthResults.set("missing-scope", oauthResult("T1", "UNEW", { userScopes: [] }));
      const response = await b.callback({ code: "missing-scope", state: await b.beginInstall() });
      assert.equal(response.headers.get("location"), "/settings?notice=missing_scope");
      assert.deepEqual(
        app.slack.callsTo("revoke").map((call) => call.args[0]),
        ["xoxp-T1-UNEW"],
      );
      assert.equal(app.store.findActiveInstallation("T1", "UEXISTING")?.botToken, "xoxb-T1");
    } finally {
      await app.close();
    }
  });

  it("removes the local installation before asking Slack to revoke its tokens", async () => {
    const app = await startApp();
    try {
      const b = new Browser(app);
      await b.start();
      await b.connect("T1", "UAUTHOR");
      const source = app.store.listInstallations(b.accountId())[0]!;
      enqueue(app.store, source);
      app.slack.revoke = async () => {
        assert.equal(app.store.getInstallation(source.id), undefined);
        assert.equal(app.store.dueDeliveries(10).length, 0);
        throw new SlackCallError("transient", "request_failed");
      };
      const response = await b.post("/installations/disconnect", { csrf: await b.csrf(), installation: source.id });
      assert.equal(response.headers.get("location"), "/settings?notice=disconnected_local");
    } finally {
      await app.close();
    }
  });

  it("deletes all local account data, including OAuth state, before remote revocation", async () => {
    const app = await startApp();
    try {
      const b = new Browser(app);
      await b.start();
      await b.connect("T1", "UAUTHOR");
      await b.connect("T2", "UDEST");
      await b.beginInstall();
      const accountId = b.accountId();
      app.slack.revoke = async () => {
        assert.equal(app.store.getAccount(accountId), undefined);
        assert.equal(app.store.listInstallations(accountId).length, 0);
        assert.equal(app.store.db.prepare("SELECT * FROM oauth_states").all().length, 0);
      };
      assert.equal((await b.post("/account/delete", { csrf: await b.csrf() })).status, 303);
    } finally {
      await app.close();
    }
  });
});
