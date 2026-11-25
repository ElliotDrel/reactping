import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { BOT_SCOPES } from "../src/slack.ts";
import { dbSkip, seed, signedAction, SITE, startApp, useDatabase, type TestApp } from "./helpers.ts";

const SECRET = "cron-secret-for-tests";
const DAY = 24 * 3_600_000;
const HOOK = "https://hooks.slack.com/actions/T1/1/abc";

describe("announcements (daily cron)", { skip: dbSkip }, () => {
  const db = useDatabase();
  let app: TestApp;
  beforeEach(async () => {
    await db.pool().query("truncate reactping_slack.announcements restart identity");
    app = startApp(db.pool(), { cronSecret: SECRET });
    app.slack.botScopes = [...BOT_SCOPES];
    await seed(app, "T1", "UAUTHOR");
    await seed(app, "T2", "UOTHER");
  });

  const at = (ms: number) => new Date(app.clock.t + ms);
  const announce = (text: string, sendAfter = at(0), createdAt = at(0)) =>
    db
      .pool()
      .query("insert into reactping_slack.announcements (text, send_after, created_at) values ($1, $2, $3)", [
        text,
        sendAfter,
        createdAt,
      ]);
  const run = async () => {
    const res = await app.handler(
      new Request(`${SITE}/api/cron/daily`, { headers: { authorization: `Bearer ${SECRET}` } }),
    );
    return (await res.json()).announcement;
  };
  const sent = () => app.slack.callsTo("postMessage").map((c) => [c.args[1], c.args[2]]);

  it("sends the newest due announcement once to everyone connected before it, with a mute button", async () => {
    await announce("Old news");
    await announce("🎄 Happy holidays from ReactPing!", at(0), at(1));
    app.clock.t += 1;
    assert.deepEqual(await run(), { id: 2, sent: 2, failed: 0 });
    assert.deepEqual(sent().sort(), [
      ["UAUTHOR", "🎄 Happy holidays from ReactPing!"],
      ["UOTHER", "🎄 Happy holidays from ReactPing!"],
    ]);
    const blocks = JSON.stringify((app.slack.callsTo("postMessage")[0]!.args[3] as { blocks: unknown }).blocks);
    assert.match(blocks, /"action_id":"rp_mute".*"Mute announcements"/);

    assert.deepEqual(await run(), { id: 2, sent: 0, failed: 0 }, "never twice, and older ones are skipped");
  });

  it("waits for send_after, and skips people who connected after it was written", async () => {
    await announce("Scheduled", at(DAY), at(-DAY));
    assert.deepEqual(await run(), { id: 0, sent: 0, failed: 0 });
    app.clock.t += DAY;
    assert.deepEqual(await run(), { id: 1, sent: 0, failed: 0 }, "both connected after it was written");
  });

  it("never sends twice when runs overlap, and a failed DM isn't retried", async () => {
    await announce("Update");
    app.clock.t += 1;
    const [a, b] = await Promise.all([run(), run()]);
    assert.equal(a.sent + b.sent, 2);

    await announce("Second");
    app.clock.t += 1;
    app.slack.postMessage = async () => {
      throw new Error("channel_not_found");
    };
    assert.deepEqual(await run(), { id: 2, sent: 0, failed: 2 });
    assert.deepEqual(await run(), { id: 2, sent: 0, failed: 0 });
  });

  it("still sends the announcement when the reconnect step fails", async () => {
    await announce("Still goes out");
    app.clock.t += 1;
    app.store.teams = async () => {
      throw new Error("connection terminated");
    };
    const res = await app.handler(
      new Request(`${SITE}/api/cron/daily`, { headers: { authorization: `Bearer ${SECRET}` } }),
    );
    assert.equal(res.status, 500, "the run shows as failed in Vercel Cron");
    const body = await res.json();
    assert.equal(body.reconnect, null);
    assert.deepEqual(body.announcement, { id: 1, sent: 2, failed: 0 });
  });

  it("mutes only the person who taps Mute, for their own workspace, and confirms privately", async () => {
    const mute = (user: Record<string, string>) =>
      signedAction(app, {
        type: "block_actions",
        team: { id: user.team_id },
        user,
        response_url: HOOK,
        actions: [{ action_id: "rp_mute" }],
      });
    assert.equal((await mute({ id: "UAUTHOR", team_id: "T1" })).status, 200);
    await mute({ id: "UOTHER", team_id: "T9" });
    await app.settle();
    const [reply] = app.slack.callsTo("respond");
    assert.deepEqual(reply!.args.slice(0, 2), [
      HOOK,
      { text: "🔕 Announcements muted. Your reaction DMs keep coming." },
    ]);

    await announce("After mute");
    app.clock.t += 1;
    assert.deepEqual(await run(), { id: 1, sent: 1, failed: 0 });
    assert.deepEqual(sent(), [["UOTHER", "After mute"]]);
  });
});
