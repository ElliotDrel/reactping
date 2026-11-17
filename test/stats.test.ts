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
});
