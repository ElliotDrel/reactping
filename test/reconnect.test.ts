import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { BOT_SCOPES } from "../src/slack.ts";
import { dbSkip, seed, SITE, startApp, useDatabase, type TestApp } from "./helpers.ts";

const SECRET = "cron-secret-for-tests";
const DAY = 24 * 3_600_000;

describe("reconnect reminders (daily cron)", { skip: dbSkip }, () => {
  const db = useDatabase();
  let app: TestApp;
  beforeEach(async () => {
    app = startApp(db.pool(), { cronSecret: SECRET });
    await seed(app, "T1", "UAUTHOR");
    await seed(app, "T1", "UOTHER");
  });

  const run = async (auth = `Bearer ${SECRET}`) => {
    const res = await app.handler(
      new Request(`${SITE}/api/cron/reconnect`, { headers: auth ? { authorization: auth } : {} }),
    );
    return { status: res.status, body: res.status === 200 ? await res.json() : null };
  };
  const dmsTo = () => app.slack.callsTo("postMessage").map((c) => c.args[1]);
  const rows = async () =>
    (
      await db
        .pool()
        .query("select user_id, bot_scopes, reconnect_prompts from reactping_slack.installations order by user_id")
    ).rows;

  it("refuses requests without the cron secret, and stays off when none is configured", async () => {
    assert.equal((await run("")).status, 401);
    assert.equal((await run("Bearer wrong")).status, 401);
    app = startApp(db.pool());
    assert.equal((await run()).status, 401);
    assert.equal(app.slack.calls.length, 0);
  });

  it("DMs everyone in an outdated workspace twice at most, a week apart, with a link that preselects it", async () => {
    app.slack.botScopes = ["chat:write"];
    assert.deepEqual((await run()).body, { workspaces: 1, outdated: 1, sent: 2, failed: 0 });
    assert.deepEqual(dmsTo().sort(), ["UAUTHOR", "UOTHER"]);
    const [, , text, options] = app.slack.callsTo("postMessage")[0]!.args as [
      string,
      string,
      string,
      { blocks: unknown },
    ];
    assert.match(text, /Reconnect to turn it on: https:\/\/reactping\.example\.test\/api\/slack\/install\?team=T1$/);
    assert.match(
      JSON.stringify(options.blocks),
      /"url":"https:\/\/reactping\.example\.test\/api\/slack\/install\?team=T1"/,
    );
    assert.deepEqual(await rows(), [
      { user_id: "UAUTHOR", bot_scopes: ["chat:write"], reconnect_prompts: 1 },
      { user_id: "UOTHER", bot_scopes: ["chat:write"], reconnect_prompts: 1 },
    ]);

    app.clock.t += 6 * DAY;
    assert.equal((await run()).body.sent, 0, "not again within a week");
    app.clock.t += DAY;
    assert.equal((await run()).body.sent, 2, "one follow-up after a week");
    app.clock.t += 30 * DAY;
    assert.equal((await run()).body.sent, 0, "never a third");
    assert.equal(dmsTo().length, 4);
  });

  it("records an up-to-date workspace's scopes, sends nothing, and resets earlier reminder counts", async () => {
    app.slack.botScopes = ["chat:write"];
    await run();
    app.slack.botScopes = [...BOT_SCOPES];
    app.clock.t += 8 * DAY;
    assert.deepEqual((await run()).body, { workspaces: 1, outdated: 0, sent: 0, failed: 0 });
    assert.equal(dmsTo().length, 2, "only the first run's DMs");
    for (const row of await rows()) {
      assert.deepEqual(row.bot_scopes, BOT_SCOPES);
      assert.equal(row.reconnect_prompts, 0);
    }
  });

  it("counts a failed DM as that reminder, and skips a workspace whose scopes Slack doesn't report", async () => {
    app.slack.botScopes = ["chat:write"];
    const postMessage = app.slack.postMessage.bind(app.slack);
    app.slack.postMessage = async () => {
      throw new Error("channel_not_found");
    };
    assert.deepEqual((await run()).body, { workspaces: 1, outdated: 1, sent: 0, failed: 2 });
    app.slack.postMessage = postMessage;
    assert.equal((await run()).body.sent, 0, "claimed reminders aren't resent the same week");
    app.clock.t += 7 * DAY;
    assert.equal((await run()).body.sent, 2, "the follow-up still goes out");

    app.slack.authTest = async () => ({ teamId: "T1", url: null });
    app.clock.t += 30 * DAY;
    assert.deepEqual((await run()).body, { workspaces: 1, outdated: 0, sent: 0, failed: 0 });
  });

  it("never sends twice when runs overlap, and a stale incomplete check can't undo a reconnect", async () => {
    app.slack.botScopes = ["chat:write"];
    const [a, b] = await Promise.all([run(), run()]);
    assert.equal(a.body.sent + b.body.sent, 2);
    assert.equal(dmsTo().length, 2);

    await app.store.setBotScopes("T1", [...BOT_SCOPES], BOT_SCOPES);
    await app.store.setBotScopes("T1", ["chat:write"], BOT_SCOPES);
    assert.ok((await rows()).every((r) => r.bot_scopes.length === BOT_SCOPES.length));
    app.clock.t += 8 * DAY;
    assert.deepEqual(await app.store.claimReconnectPrompts("T1", BOT_SCOPES, 2, 7 * DAY), []);
  });
});
