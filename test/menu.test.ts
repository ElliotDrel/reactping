import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { responseUrl } from "../src/engagement.ts";
import {
  commandWord,
  installCard,
  menu,
  shareFallback,
  shareView,
  testResult,
  welcomeMenu,
  type SlackMessage,
} from "../src/menu.ts";

const SITE = "https://reactping.example.test";
type Button = { text: { text: string }; style?: string; url?: string };

/** Section text and buttons, in display order, as Slack would render them. */
function render(message: SlackMessage): { text: string[]; buttons: string[]; primary: string[]; context: string[] } {
  const blocks = (message.blocks ?? []) as {
    type: string;
    text?: { text: string };
    elements?: (Button & { text: unknown })[];
  }[];
  const buttons = blocks.flatMap((b) => (b.type === "actions" ? (b.elements as Button[]) : []));
  return {
    text: blocks.flatMap((b) => (b.type === "section" ? [b.text!.text] : [])),
    buttons: buttons.map((b) => b.text.text),
    primary: buttons.filter((b) => b.style === "primary").map((b) => b.text.text),
    context: blocks.flatMap((b) => (b.type === "context" ? (b.elements as { text: string }[]).map((e) => e.text) : [])),
  };
}

describe("approved Slack menus (issue #5)", () => {
  it("flow 1: connected menu copy and button order", () => {
    assert.deepEqual(render(menu(SITE, "T1", true)), {
      text: ["✅ You're connected!\n\nI'll notify you whenever someone reacts to your messages."],
      buttons: ["Send test notification", "Share ReactPing", "Give feedback"],
      primary: [],
      context: [],
    });
  });

  it("flow 2: unconnected menu with a green Connect for this workspace and no test action", () => {
    const message = menu(SITE, "T1", false);
    assert.deepEqual(render(message), {
      text: [
        "Hey! 👋 I send you a DM whenever someone reacts to your Slack messages.\n\nYou're not connected yet. Connect your account to get started!",
      ],
      buttons: ["Connect ReactPing", "Give feedback"],
      primary: ["Connect ReactPing"],
      context: ["Free · Already available in this workspace"],
    });
    assert.match(JSON.stringify(message), /\/api\/slack\/install\?team=T1"/);
  });

  it("flow 8: unknown commands get the help line with the connected actions", () => {
    const help = render(menu(SITE, "T1", true, true));
    assert.deepEqual(help.text, ["Here's what I can help you with:"]);
    assert.deepEqual(help.buttons, render(menu(SITE, "T1", true)).buttons);
    assert.deepEqual(render(menu(SITE, "T1", false, true)), render(menu(SITE, "T1", false)));
  });

  it("flows 1.2 and 3: one generic install card, with nothing personal in it", () => {
    const card = installCard(SITE, "T1");
    assert.deepEqual(render(card), {
      text: ["*Never miss a reaction 🔔*\n\nGet a DM whenever someone reacts to your Slack messages."],
      buttons: ["Connect ReactPing"],
      primary: ["Connect ReactPing"],
      context: ["Free · Already available in this workspace"],
    });
    assert.doesNotMatch(JSON.stringify(card), /U[A-Z0-9]{6,}|xox/);
  });

  it("flow 2.1 step 3: the welcome DM reuses the connected actions in order", () => {
    const welcome = render(welcomeMenu(SITE, "fallback"));
    assert.deepEqual(welcome.text, [
      "Welcome to ReactPing! 🎉\n\nYou're all set. Whenever someone reacts to your messages, I'll notify you here.",
    ]);
    assert.deepEqual(welcome.buttons, ["Send test notification", "Share ReactPing", "Give feedback"]);
    assert.match(welcome.context[0]!, /Best effort/);
    assert.match(JSON.stringify(welcomeMenu(SITE, "x")), /utm_medium=welcome_dm/);
    assert.match(JSON.stringify(menu(SITE, "T1", true)), /utm_medium=slack_menu/);
  });

  it("flows 1.1 and 10: test success opens the right DM; failure offers retry and report", () => {
    assert.deepEqual(render(testResult(SITE, "T1", "AREACTPING", true)), {
      text: ["✅ Test notification sent!"],
      buttons: ["Open DM ↗"],
      primary: [],
      context: [],
    });
    assert.match(JSON.stringify(testResult(SITE, "T1", "AREACTPING", true)), /app_redirect\?app=AREACTPING&team=T1/);
    assert.deepEqual(render(testResult(SITE, "T1", undefined, true)).buttons, []);
    assert.deepEqual(render(testResult(SITE, "T1", "AREACTPING", false)), {
      text: ["⚠️ Couldn't send your test notification."],
      buttons: ["Try again", "Report a problem"],
      primary: [],
      context: [],
    });
  });

  it("flow 6: the share modal picks a conversation first and shows the real link", () => {
    const view = shareView(SITE, "T1");
    assert.equal((view as { submit?: { text: string } }).submit?.text, "Share ReactPing");
    const [select, link] = view.blocks as { element?: { type: string; response_url_enabled: boolean } }[];
    assert.equal(select!.element!.type, "conversations_select");
    assert.equal(select!.element!.response_url_enabled, true);
    assert.match(JSON.stringify(link), /Copy installation link.*install\?team=T1/);
    assert.match(shareFallback(SITE, "T1").text, /https:\/\/reactping\.example\.test\/api\/slack\/install\?team=T1$/);
  });

  it("reads the command word after a mention or slash command", () => {
    assert.equal(commandWord("<@U0BOT> Install "), "install");
    assert.equal(commandWord("<@U0BOT>"), "");
    assert.equal(commandWord(" settings"), "settings");
  });

  it("accepts only Slack's response hosts", () => {
    assert.ok(responseUrl("https://hooks.slack.com/actions/T1/123/abc"));
    for (const url of [
      "http://hooks.slack.com/actions/T1/123/abc",
      "https://hooks.slack.com.evil.test/actions/T1/123/abc",
      "https://user@hooks.slack.com/actions/T1/123/abc",
      "https://hooks.slack.com/actions/T1/123/abc?x=1",
      "not a url",
      42,
    ]) {
      assert.equal(responseUrl(url), undefined, String(url));
    }
  });
});
