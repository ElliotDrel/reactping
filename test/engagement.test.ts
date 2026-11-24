import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  dbSkip,
  eventEnvelope,
  seed,
  signedAction,
  signedEvent,
  signedPost,
  SITE,
  startApp,
  useDatabase,
  type TestApp,
} from "./helpers.ts";

const CHANNEL = "C123ABC";
const HOOK = "https://hooks.slack.com/commands/T1/123/abc";
const MENTION_TS = "1700000000.000100";

describe("Slack mentions, /reactping, and menu buttons", { skip: dbSkip }, () => {
  const db = useDatabase();
  let app: TestApp;
  beforeEach(async () => {
    app = startApp(db.pool());
    await seed(app, "T1", "UAUTHOR");
  });

  const slash = (user: string, text: string, extra: Record<string, string> = {}) =>
    signedPost(
      app,
      "/api/slack/commands",
      new URLSearchParams({
        command: "/reactping",
        team_id: "T1",
        user_id: user,
        channel_id: CHANNEL,
        text,
        response_url: HOOK,
        api_app_id: "AREACTPING",
        ...extra,
      }).toString(),
      { contentType: "application/x-www-form-urlencoded" },
    );
  const mention = (user: string, text: string, extra: Record<string, unknown> = {}) =>
    eventEnvelope("T1", { type: "app_mention", user, text, channel: CHANNEL, ts: MENTION_TS, ...extra });
  const button = (action: string, extra: Record<string, unknown> = {}) => ({
    type: "block_actions",
    team: { id: "T1" },
    user: { id: "UAUTHOR", team_id: "T1" },
    api_app_id: "AREACTPING",
    channel: { id: CHANNEL },
    container: { channel_id: CHANNEL, thread_ts: MENTION_TS },
    response_url: HOOK,
    trigger_id: "123.456.abc",
    actions: [{ action_id: action }],
    ...extra,
  });
  /** What each respond call sent: its visibility, thread, and message text. */
  const responses = () =>
    app.slack.callsTo("respond").map((c) => {
      const [url, message, options] = c.args as [string, { text: string }, { visibility: string; threadTs?: string }];
      return { url, visibility: options.visibility, thread: options.threadTs, text: message.text };
    });

  it("flows 4, 5, 8: /reactping answers privately, and only `install` is public", async () => {
    await slash("UAUTHOR", "");
    await slash("UOTHER", "");
    await slash("UAUTHOR", "settings");
    await slash("UAUTHOR", "install");
    await app.settle();
    assert.deepEqual(
      responses().map((r) => [r.visibility, r.text.split("\n")[0]]),
      [
        ["ephemeral", "✅ You're connected!"],
        ["ephemeral", "Hey! 👋 I send you a DM whenever someone reacts to your Slack messages."],
        ["ephemeral", "Here's what I can help you with:"],
        ["in_channel", "Never miss a reaction 🔔 Get a DM whenever someone reacts to your Slack messages."],
      ],
    );
    assert.equal(app.slack.callsTo("postMessage").length, 0);
  });

  it("rejects unsigned commands, forged response URLs, and Enterprise installs", async () => {
    const unsigned = await app.handler(new Request(`${SITE}/api/slack/commands`, { method: "POST", body: "x" }));
    assert.equal(unsigned.status, 401);
    await slash("UAUTHOR", "", { response_url: "https://evil.test/commands/T1/1/a" });
    await slash("UAUTHOR", "", { is_enterprise_install: "true" });
    await slash("UAUTHOR", "", { command: "/other" });
    await app.settle();
    assert.equal(app.slack.calls.length, 0);
  });

  it("flows 1-3: mentions reply privately in the mention's thread; install posts the card there", async () => {
    await signedEvent(app, mention("UAUTHOR", "<@U0BOT>"));
    await signedEvent(app, mention("UOTHER", "<@U0BOT> hello"));
    await signedEvent(app, mention("UOTHER", "<@U0BOT> install", { thread_ts: "1699999999.000001" }));
    await app.settle();
    const ephemeral = app.slack.callsTo("postEphemeral").map((c) => c.args);
    assert.deepEqual(
      ephemeral.map(([token, channel, user, message, thread]) => [
        token,
        channel,
        user,
        (message as { text: string }).text.split("\n")[0],
        thread,
      ]),
      [
        ["xoxb-T1", CHANNEL, "UAUTHOR", "✅ You're connected!", MENTION_TS],
        [
          "xoxb-T1",
          CHANNEL,
          "UOTHER",
          "Hey! 👋 I send you a DM whenever someone reacts to your Slack messages.",
          MENTION_TS,
        ],
      ],
    );
    const [card] = app.slack.callsTo("postMessage");
    assert.equal(card!.args[1], CHANNEL);
    assert.match(String(card!.args[2]), /Never miss a reaction/);
    assert.equal((card!.args[3] as { threadTs: string }).threadTs, "1699999999.000001");
  });

  it("ignores Slack retries, bot messages, people from other organizations, and workspaces with no bot token", async () => {
    await signedEvent(app, mention("UAUTHOR", "<@U0BOT>"), { "x-slack-retry-num": "1", "x-slack-retry-reason": "x" });
    await signedEvent(app, mention("UAUTHOR", "<@U0BOT>", { bot_id: "B1" }));
    await signedEvent(app, mention("UAUTHOR", "<@U0BOT>", { subtype: "bot_message" }));
    await signedEvent(app, mention("UEXTERNAL", "<@U0BOT>", { user_team: "T2" }));
    await signedEvent(app, { ...mention("UAUTHOR", "<@U0BOT>"), team_id: "T9" });
    await app.settle();
    assert.equal(app.slack.calls.length, 0);
  });

  it("flow 1.1: sends the test only to the connected requester and never counts it as a reaction", async () => {
    await signedAction(app, button("rp_test"));
    await signedAction(app, button("rp_test", { user: { id: "UOTHER", team_id: "T1" } }));
    await app.settle();
    const dms = app.slack.callsTo("postMessage");
    assert.equal(dms.length, 1);
    assert.deepEqual(dms[0]!.args.slice(0, 2), ["xoxb-T1", "UAUTHOR"]);
    assert.match(String(dms[0]!.args[2]), /^🧪 \*Test notification\*/);
    assert.deepEqual(
      responses().map((r) => [r.visibility, r.text.split("\n")[0]]),
      [
        ["ephemeral", "✅ Test notification sent!"],
        ["ephemeral", "Hey! 👋 I send you a DM whenever someone reacts to your Slack messages."],
      ],
    );
    assert.equal((await app.store.stats()).notifications, 0);
  });

  it("flow 10: a failed test says so and offers a retry", async () => {
    app.slack.postMessage = async () => {
      throw new Error("channel_not_found");
    };
    await signedAction(app, button("rp_test"));
    await app.settle();
    assert.deepEqual(
      responses().map((r) => r.text),
      ["⚠️ Couldn't send your test notification."],
    );
    const [, message] = app.slack.callsTo("respond")[0]!.args as [string, { blocks: unknown[] }];
    assert.match(JSON.stringify(message.blocks), /"Try again".*"action_id":"rp_test".*"Report a problem"/);
  });

  it("flow 1.2: shares publicly in the menu's thread, then confirms privately", async () => {
    await signedAction(app, button("rp_share"));
    await app.settle();
    assert.deepEqual(
      responses().map((r) => [r.visibility, r.thread, r.text.slice(0, 22)]),
      [
        ["in_channel", MENTION_TS, "Never miss a reaction "],
        ["ephemeral", MENTION_TS, "✅ Shared successfully!"],
      ],
    );
  });

  it("flow 5: when Slack refuses the public post, offers the link instead of a false success", async () => {
    const respond = app.slack.respond.bind(app.slack);
    app.slack.respond = async (url, message, options) => {
      if (options.visibility === "in_channel") throw new Error("channel_not_found");
      return respond(url, message, options);
    };
    await signedAction(app, button("rp_share"));
    await app.settle();
    const texts = responses().map((r) => r.text);
    assert.equal(texts.length, 1);
    assert.match(
      texts[0]!,
      /^Copy this link to share ReactPing: https:\/\/reactping\.example\.test\/api\/slack\/install\?team=T1$/,
    );
  });

  it("flow 6: sharing from a DM opens the destination picker instead of posting there", async () => {
    await signedAction(app, button("rp_share", { channel: { id: "D123BOT" }, container: { channel_id: "D123BOT" } }));
    const [open] = app.slack.callsTo("openView");
    assert.deepEqual(open!.args.slice(0, 2), ["xoxb-T1", "123.456.abc"]);
    await app.settle();
    assert.equal(app.slack.callsTo("respond").length, 0);

    app.slack.openView = async () => {
      throw new Error("expired_trigger_id");
    };
    await signedAction(app, button("rp_share", { channel: { id: "D123BOT" }, container: { channel_id: "D123BOT" } }));
    await app.settle();
    assert.match(responses()[0]!.text, /^Copy this link/);
  });

  it("flow 6: posts to the chosen conversation only, through its own response URL", async () => {
    const chosen = "https://hooks.slack.com/app/T1/1/chosen";
    const submission = (selected: string, response_url = chosen) => ({
      type: "view_submission",
      team: { id: "T1" },
      user: { id: "UAUTHOR", team_id: "T1" },
      view: {
        callback_id: "rp_share_destination",
        state: { values: { destination: { conversation: { selected_conversation: selected } } } },
      },
      response_urls: [{ block_id: "destination", action_id: "conversation", channel_id: "C0CHOSEN", response_url }],
    });
    const res = await signedAction(app, submission("C0CHOSEN"));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "", "an empty 200 closes the modal");
    await signedAction(app, submission("C0OTHER"));
    await signedAction(app, submission("C0CHOSEN", "https://evil.test/app/T1/1/x"));
    await app.settle();
    assert.deepEqual(
      responses().map((r) => [r.url, r.visibility, r.text.slice(0, 22)]),
      [
        [chosen, "in_channel", "Never miss a reaction "],
        [chosen, "ephemeral", "✅ Shared successfully!"],
      ],
    );
    assert.equal(app.slack.callsTo("postMessage").length, 0);
  });

  it("ignores buttons from another workspace's user, unknown actions, and Enterprise installs", async () => {
    await signedAction(app, button("rp_test", { user: { id: "UAUTHOR", team_id: "T2" } }));
    await signedAction(app, button("rp_test", { is_enterprise_install: true }));
    await signedAction(app, button("rp_unknown"));
    await app.settle();
    assert.equal(app.slack.calls.length, 0);
  });
});
