import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { FEEDBACK_THANKS } from "../src/messages.ts";
import { dbSkip, eventEnvelope, seed, signedEvent, SITE, startApp, useDatabase, type TestApp } from "./helpers.ts";

describe("feedback", { skip: dbSkip }, () => {
  const db = useDatabase();
  let app: TestApp;
  beforeEach(() => {
    app = startApp(db.pool());
  });

  const saved = async () =>
    (
      await db
        .pool()
        .query(`select source, team_id, user_id, name, email, message from reactping_slack.feedback order by id`)
    ).rows;

  const dm = (extra: Record<string, unknown> = {}) =>
    eventEnvelope("T1", {
      type: "message",
      channel_type: "im",
      channel: "D123ABC",
      user: "UAUTHOR",
      text: "  Love it, add digests  ",
      ts: "1700000002.000100",
      ...extra,
    });

  it("saves a DM to ReactPing with the sender's Slack IDs and replies with a thank-you in that DM", async () => {
    await seed(app, "T1", "UOTHER"); // anyone's install provides the workspace's bot token
    const res = await signedEvent(app, dm());
    assert.equal(res.status, 200);
    await app.settle();
    assert.deepEqual(await saved(), [
      { source: "slack", team_id: "T1", user_id: "UAUTHOR", name: null, email: null, message: "Love it, add digests" },
    ]);
    assert.deepEqual(
      app.slack.callsTo("postMessage").map((c) => c.args),
      [["xoxb-T1", "D123ABC", FEEDBACK_THANKS]],
    );
  });

  it("ignores ReactPing's own messages, edits, blanks, and Slack retries", async () => {
    await seed(app, "T1", "UAUTHOR");
    await signedEvent(app, dm({ bot_id: "B1", user: undefined }));
    await signedEvent(app, dm({ subtype: "message_changed" }));
    await signedEvent(app, dm({ text: "   " }));
    await signedEvent(app, dm(), { "x-slack-retry-num": "1" });
    await signedEvent(app, eventEnvelope("T1", { type: "message", channel_type: "channel", user: "U1", text: "hi" }));
    await app.settle();
    assert.deepEqual(await saved(), []);
    assert.equal(app.slack.callsTo("postMessage").length, 0);
  });

  it("saves website feedback with optional name and email, and thanks the sender", async () => {
    const post = (fields: Record<string, string>) =>
      app.handler(
        new Request(`${SITE}/api/feedback`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(fields).toString(),
        }),
      );
    const res = await post({ message: "Great app", name: " Sam ", email: "sam@example.test" });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Thank you so much for your feedback/);
    assert.equal((await post({ message: "No contact", name: "", email: "" })).status, 200);
    assert.equal((await post({ message: "   " })).status, 400);
    assert.deepEqual(await saved(), [
      { source: "website", team_id: null, user_id: null, name: "Sam", email: "sam@example.test", message: "Great app" },
      { source: "website", team_id: null, user_id: null, name: null, email: null, message: "No contact" },
    ]);
  });
});
