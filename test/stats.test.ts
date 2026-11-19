import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  Browser,
  dbSkip,
  disconnectAction,
  eventEnvelope,
  reactionEvent,
  seed,
  SITE,
  signedAction,
  signedEvent,
  startApp,
  useDatabase,
  type TestApp,
} from "./helpers.ts";

describe("usage counts", { skip: dbSkip }, () => {
  const db = useDatabase();
  let app: TestApp;
  beforeEach(() => {
    app = startApp(db.pool());
  });

  const activity = async () =>
    (await db.pool().query(`select team_id, event, installs from reactping_slack.activity order by id`)).rows.map(
      (r) => [r.team_id, r.event, r.installs],
    );

  it("logs connects, disconnects, and uninstalls by workspace only, never by user", async () => {
    await new Browser(app).connect("T1", "UAUTHOR");
    await app.settle();
    await signedAction(app, disconnectAction("T1", "UAUTHOR"));
    await app.settle();
    await seed(app, "T2", "U1");
    await seed(app, "T2", "U2");
    await signedEvent(app, eventEnvelope("T2", { type: "app_uninstalled" }));
    await signedEvent(app, eventEnvelope("T2", { type: "app_uninstalled" })); // retry: nothing left to count
    await app.settle();
    assert.deepEqual(await activity(), [
      ["T1", "connected", 1],
      ["T1", "disconnected", 1],
      ["T2", "uninstalled", 2],
    ]);
    const columns = await db
      .pool()
      .query(`select column_name from information_schema.columns where table_name = 'activity'`);
    assert.ok(!columns.rows.some((r) => /user/.test(r.column_name)), "no user column");
  });

  it("counts delivered notifications only, and reports totals as an SVG image", async () => {
    await seed(app, "T1", "UAUTHOR");
    await seed(app, "T2", "UAUTHOR");
    await signedEvent(app, reactionEvent("T1"));
    await signedEvent(app, reactionEvent("T1", { item_user: "UNOBODY" })); // not delivered
    await app.settle();
    app.slack.postMessage = async () => {
      throw new Error("boom");
    };
    await signedEvent(app, reactionEvent("T2")); // failed delivery
    await app.settle();
    assert.deepEqual(await app.store.stats(), { workspaces: 2, notifications: 1 });

    const res = await app.handler(new Request(`${SITE}/api/stats`));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type")!, /image\/svg\+xml/);
    assert.match(res.headers.get("cache-control")!, /s-maxage=300/);
    const svg = await res.text();
    assert.match(svg, /2 workspaces/);
    assert.match(svg, /1 reaction notification<\/tspan> sent/);
  });

  it("counts every reaction's outcome by hour and reports outages on /api/health", async () => {
    const health = async () => {
      const res = await app.handler(new Request(`${SITE}/api/health`));
      assert.equal(res.headers.get("cache-control"), "no-store");
      return [res.status, await res.json()];
    };
    assert.deepEqual(await health(), [503, { ok: false, problem: "no_events_24h", last24h: {} }]);

    await seed(app, "T1", "UAUTHOR");
    await signedEvent(app, reactionEvent("T1")); // sent
    await signedEvent(app, reactionEvent("T1", { user: "UAUTHOR" })); // own reaction
    await signedEvent(app, reactionEvent("T1", { item_user: "UNOBODY" })); // author not connected
    await signedEvent(app, reactionEvent("T1", { item: { type: "file", file: "F1" } })); // not a message
    await app.settle();
    const ok = { sent: 1, self: 1, not_connected: 1, ignored: 1 };
    assert.deepEqual(await health(), [200, { ok: true, problem: null, last24h: ok }]);

    app.slack.postMessage = async () => {
      throw new Error("boom");
    };
    await signedEvent(app, reactionEvent("T1"));
    await app.settle();
    assert.deepEqual(await health(), [
      503,
      { ok: false, problem: "notifications_failing", last24h: { ...ok, failed: 1 } },
    ]);

    // Failures stop alerting after 2 hours; the totals cover 24.
    app.clock.t += 3 * 3600_000;
    assert.deepEqual(await health(), [200, { ok: true, problem: null, last24h: { ...ok, failed: 1 } }]);
    app.clock.t += 24 * 3600_000;
    assert.equal((await health())[0], 503);
  });
});
