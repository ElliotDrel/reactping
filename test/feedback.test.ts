import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { feedbackLink } from "../src/messages.ts";
import { dbSkip, eventEnvelope, seed, signedEvent, SITE, startApp, useDatabase, type TestApp } from "./helpers.ts";

describe("feedback", { skip: dbSkip }, () => {
  const db = useDatabase();
  let app: TestApp;
  beforeEach(() => {
    app = startApp(db.pool());
  });

  const saved = async () =>
    (await db.pool().query(`select source, name, email, message, status from reactping_slack.feedback order by id`))
      .rows;

  const post = (fields: Record<string, string>, referer?: string) =>
    app.handler(
      new Request(`${SITE}/api/feedback`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          ...(referer ? { referer } : {}),
        },
        body: new URLSearchParams(fields).toString(),
      }),
    );

  it("saves website feedback with optional name and email as new, and thanks the sender", async () => {
    const res = await post({ message: "Great app", name: " Sam ", email: "sam@example.test" }, `${SITE}/feedback`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Thank you so much for your feedback/);
    assert.equal((await post({ message: "No contact", name: "", email: "" })).status, 200);
    assert.equal((await post({ message: "   " })).status, 400);
    assert.deepEqual(await saved(), [
      { source: "website", name: "Sam", email: "sam@example.test", message: "Great app", status: "new" },
      { source: "website", name: null, email: null, message: "No contact", status: "new" },
    ]);
  });

  it("posts each new feedback to the alerts channel, escaped, after responding", async () => {
    await post({ message: "Line one <!channel>\nLine two", email: "sam@example.test" });
    assert.deepEqual(app.alerts, []);
    await app.settle();
    assert.deepEqual(app.alerts, [
      "New ReactPing feedback (website) from sam@example.test:\n>Line one &lt;!channel&gt;\n>Line two",
    ]);
  });

  it("records which Slack link opened the form, and treats anything else as the website", async () => {
    await post({ message: "a" }, feedbackLink(SITE, "welcome_dm"));
    await post({ message: "b" }, feedbackLink(SITE, "home_tab"));
    await post({ message: "c" }, `${SITE}/feedback?utm_source=slack&utm_medium=__proto__`);
    await post({ message: "d" }, "https://elsewhere.test/feedback?utm_source=slack&utm_medium=welcome_dm");
    await post({ message: "e" }, "not a url");
    assert.deepEqual(
      (await saved()).map((row) => row.source),
      ["slack_welcome", "slack_home", "website", "website", "website"],
    );
  });

  it("stamps status_at when Elliot changes a status", async () => {
    await post({ message: "a" });
    const pool = db.pool();
    assert.equal((await pool.query(`select status_at from reactping_slack.feedback`)).rows[0].status_at, null);
    await pool.query(`update reactping_slack.feedback set status = 'resolved', note = 'Shipped'`);
    const [row] = (await pool.query(`select status, status_at, note from reactping_slack.feedback`)).rows;
    assert.equal(row.status, "resolved");
    assert.ok(row.status_at instanceof Date);
    await assert.rejects(pool.query(`update reactping_slack.feedback set status = 'done'`), /check constraint/);
  });

  it("no longer reads DMs to ReactPing: message events are acknowledged and ignored", async () => {
    await seed(app, "T1", "UAUTHOR");
    const res = await signedEvent(
      app,
      eventEnvelope("T1", { type: "message", channel_type: "im", channel: "D123ABC", user: "UAUTHOR", text: "hi" }),
    );
    assert.equal(res.status, 200);
    await app.settle();
    assert.deepEqual(await saved(), []);
    assert.equal(app.slack.callsTo("postMessage").length, 0);
  });
});
