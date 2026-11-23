import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { dbSkip, eventEnvelope, seed, signedAction, signedEvent, signedPost, startApp, useDatabase, type TestApp } from "./helpers.ts";

describe("signed Slack engagement", { skip: dbSkip }, () => {
  const db = useDatabase();
  let app: TestApp;
  beforeEach(async () => { app = startApp(db.pool()); await seed(app, "T1", "UAUTHOR"); });
  const channel = "C123ABC";
  const hook = "https://hooks.slack.com/commands/T1/123/abc";
  const slash = (user: string, text: string, team = "T1") => signedPost(app, "/api/slack/commands",
    new URLSearchParams({ team_id: team, user_id: user, channel_id: channel, command: "/reactping", text, response_url: hook, api_app_id: "AREACTPING" }).toString(),
    { contentType: "application/x-www-form-urlencoded" });
  const action = (id: string, user = "UAUTHOR") => ({
    type: "block_actions", team: { id: "T1" }, user: { id: user, team_id: "T1" }, channel: { id: channel },
    api_app_id: "AREACTPING", response_url: hook, actions: [{ action_id: id, value: "conversation" }],
  });
  it("returns private connected/unconnected menus, then shares exactly one public card", async () => {
    await slash("UAUTHOR", ""); await slash("UOTHER", ""); await slash("UAUTHOR", "install"); await slash("UAUTHOR", "install");
    await app.settle();
    const calls = app.slack.callsTo("respond");
    assert.equal(calls.filter(c => c.args[2] === "in_channel").length, 1);
    assert.match(JSON.stringify(calls), /You're connected/);
    assert.match(JSON.stringify(calls), /You're not connected yet/);
    assert.match(JSON.stringify(calls), /Never miss a reaction/);
  });
  it("threads mentions and ignores duplicate deliveries and bot loops", async () => {
    const event = eventEnvelope("T1", { type: "app_mention", user: "UAUTHOR", text: "<@UBOT> install", channel, ts: "1700000000.000100" });
    await signedEvent(app, event); await signedEvent(app, event);
    await signedEvent(app, { ...event, event_id: "Ev2", event: { ...event.event, bot_id: "B1" } });
    await app.settle();
    const posts = app.slack.callsTo("postMessage");
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.args[1], channel);
    assert.match(JSON.stringify(posts), /1700000000.000100/);
  });
  it("tests only the connected requester without counting real reactions", async () => {
    await signedAction(app, action("rp_test")); await signedAction(app, action("rp_test"));
    await signedAction(app, action("rp_test", "UOTHER"));
    await app.settle();
    const posts = app.slack.callsTo("postMessage");
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.args[1], "UAUTHOR");
    assert.match(String(posts[0]!.args[2]), /Test notification/);
    assert.equal((await app.store.stats()).notifications, 0);
  });
  it("rejects unsigned commands and cross-workspace actions", async () => {
    assert.equal((await app.handler(new Request("https://reactping.example.test/api/slack/commands", { method: "POST", body: "x" }))).status, 401);
    await signedAction(app, { ...action("rp_test"), user: { id: "UAUTHOR", team_id: "T2" } });
    await app.settle();
    assert.equal(app.slack.calls.length, 0);
  });
  it("posts a chosen destination card only through its Slack-issued response URL", async () => {
    const payload = {
      type: "view_submission", team: { id: "T1" }, user: { id: "UAUTHOR", team_id: "T1" },
      view: { callback_id: "reactping_share_destination", state: { values: { destination: { conversation: { selected_conversation: "D123ABC" } } } } },
      response_urls: [{ block_id: "destination", action_id: "conversation", channel_id: "D123ABC", response_url: "https://hooks.slack.com/app/AREACTPING/123/abc" }],
    };
    await signedAction(app, payload);
    await signedAction(app, payload);
    await app.settle();
    assert.equal(app.slack.callsTo("respond").length, 1);
    assert.equal(app.slack.callsTo("respond")[0]!.args[2], "in_channel");
    assert.match(JSON.stringify(app.slack.callsTo("respond")), /Never miss a reaction/);
  });
  it("keeps the bot grant after last personal disconnect, removes it on uninstall", async () => {
    await app.store.saveWorkspace("T1", "xoxb-T1", "AREACTPING");
    await app.store.delete("T1", "UAUTHOR");
    assert.equal((await app.store.workspaceBot("T1"))?.botToken, "xoxb-T1");
    await signedEvent(app, eventEnvelope("T1", { type: "app_uninstalled" }));
    await app.settle();
    assert.equal(await app.store.workspaceBot("T1"), undefined);
  });
  it("reports failed tests and opens a share modal from welcome", async () => {
    app.slack.postMessage = async () => { throw new Error("failed"); };
    await signedAction(app, action("rp_test"));
    await app.settle();
    assert.match(JSON.stringify(app.slack.callsTo("respond")), /Couldn't send your test notification/);
    await signedAction(app, { ...action("rp_share"), trigger_id: "123.456.abc", actions: [{ action_id: "rp_share", value: "welcome" }] });
    assert.equal(app.slack.callsTo("openView").length, 1);
  });
});
