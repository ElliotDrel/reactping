import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { SlackCallError } from "../src/slack.ts";
import {
  dbSkip,
  disconnectAction,
  seed,
  signedAction,
  signedPost,
  SITE,
  startApp,
  useDatabase,
  type TestApp,
} from "./helpers.ts";

describe("App Home Disconnect", { skip: dbSkip }, () => {
  const db = useDatabase();
  let app: TestApp;
  beforeEach(async () => {
    app = startApp(db.pool());
    await seed(app, "T1", "UAUTHOR");
    await seed(app, "T1", "UOTHER");
    await seed(app, "T2", "UAUTHOR");
  });

  it("deletes exactly the signed payload's installation, then revokes its user token and shows Not connected", async () => {
    const res = await signedAction(app, disconnectAction("T1", "UAUTHOR"));
    assert.equal(res.status, 200);
    assert.equal(await app.store.get("T1", "UAUTHOR"), undefined, "deleted before acknowledging");
    assert.ok(await app.store.get("T1", "UOTHER"));
    assert.ok(await app.store.get("T2", "UAUTHOR"));

    await app.settle();
    assert.deepEqual(
      app.slack.callsTo("revoke").map((c) => c.args[0]),
      ["xoxp-T1-UAUTHOR"],
      "the shared bot token is never revoked",
    );
    const [home] = app.slack.callsTo("publishHome");
    assert.deepEqual(home!.args.slice(0, 2), ["xoxb-T1", "UAUTHOR"]);
    assert.match(JSON.stringify(home!.args[2]), /Not connected/);
  });

  it("takes identity only from Slack's team and user fields, never from the action value", async () => {
    const payload = disconnectAction("T1", "UAUTHOR", {
      actions: [{ action_id: "disconnect", value: JSON.stringify({ team: "T2", user: "UOTHER" }) }],
    });
    await signedAction(app, payload);
    assert.equal(await app.store.get("T1", "UAUTHOR"), undefined);
    assert.ok(await app.store.get("T1", "UOTHER"));
    assert.ok(await app.store.get("T2", "UAUTHOR"));
  });

  it("ignores unsigned or forged requests", async () => {
    const body = new URLSearchParams({ payload: JSON.stringify(disconnectAction("T1", "UAUTHOR")) }).toString();
    const unsigned = await app.handler(new Request(`${SITE}/api/slack/interactions`, { method: "POST", body }));
    const forged = await signedPost(app, "/api/slack/interactions", body, {
      secret: "wrong",
      contentType: "application/x-www-form-urlencoded",
    });
    assert.deepEqual([unsigned.status, forged.status], [401, 401]);
    assert.ok(await app.store.get("T1", "UAUTHOR"));
  });

  it("ignores mismatched user workspaces, Enterprise payloads, other actions, and malformed identities", async () => {
    for (const payload of [
      disconnectAction("T1", "UAUTHOR", { user: { id: "UAUTHOR", team_id: "T2" } }),
      disconnectAction("T1", "UAUTHOR", { is_enterprise_install: true }),
      disconnectAction("T1", "UAUTHOR", { actions: [{ action_id: "something_else" }] }),
      disconnectAction("T1", "UAUTHOR", { type: "view_submission" }),
      disconnectAction("T1", "UAUTHOR", { team: { id: "t1;drop" } }),
    ]) {
      assert.equal((await signedAction(app, payload)).status, 200);
    }
    assert.equal((await signedPost(app, "/api/slack/interactions", "payload=%7Bnot", {})).status, 400);
    assert.ok(await app.store.get("T1", "UAUTHOR"));
    await app.settle();
    assert.equal(app.slack.calls.length, 0);
  });

  it("is harmless when the user is already disconnected", async () => {
    await signedAction(app, disconnectAction("T1", "UNKNOWN"));
    await app.settle();
    assert.equal(app.slack.calls.length, 0);
  });

  it("still disconnects locally when Slack revocation fails", async () => {
    app.slack.revoke = async () => {
      throw new SlackCallError("failed", "request_failed");
    };
    await signedAction(app, disconnectAction("T1", "UAUTHOR"));
    await app.settle();
    assert.equal(await app.store.get("T1", "UAUTHOR"), undefined);
    assert.equal(app.slack.callsTo("publishHome").length, 1);
  });

  it("does not revoke or overwrite a reinstall that lands before the follow-up work runs", async () => {
    await signedAction(app, disconnectAction("T1", "UAUTHOR"));
    await seed(app, "T1", "UAUTHOR"); // Slack may return the same user token on a quick reinstall
    await app.settle();
    assert.equal(app.slack.callsTo("revoke").length, 0);
    assert.equal(app.slack.callsTo("publishHome").length, 0);
    assert.ok(await app.store.get("T1", "UAUTHOR"));
  });
});
