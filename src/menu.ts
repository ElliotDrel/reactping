/** Block Kit for the approved in-Slack menus (issue #5). Pure builders: copy, button labels, and order live here. */
import type { View } from "@slack/web-api";

type Block = View["blocks"][number];
export type SlackMessage = { text: string; blocks?: Block[] };

export const TEST_ACTION = "rp_test";
export const SHARE_ACTION = "rp_share";
export const SHARE_MODAL = "rp_share_destination";
export const TEST_TEXT =
  "🧪 *Test notification*\n\nSomeone reacted 🎉 to your message.\n\nThis is what your future reaction notifications will look like.";
export const SHARED_TEXT = "✅ Shared successfully!";

const section = (text: string): Block => ({ type: "section", text: { type: "mrkdwn", text } });
const footer: Block = {
  type: "context",
  elements: [{ type: "mrkdwn", text: "Free · Already available in this workspace" }],
};
/** One button per actions block, so Slack stacks them vertically in the approved order. */
function button(text: string, action_id: string, extra: { url?: string; style?: "primary" } = {}): Block {
  return { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text }, action_id, ...extra }] };
}

/** A workspace hint for Slack's OAuth screen; Slack treats it as a preference, and the callback trusts only Slack's answer. */
export const installLink = (site: string, team: string) => `${site}/api/slack/install?team=${team}`;
const feedback = (site: string, medium: "welcome_dm" | "slack_menu") =>
  `${site}/feedback?utm_source=slack&utm_medium=${medium}`;
const connect = (site: string, team: string) =>
  button("Connect ReactPing", "rp_connect", { url: installLink(site, team), style: "primary" });

function connectedActions(site: string, medium: "welcome_dm" | "slack_menu"): Block[] {
  return [
    button("Send test notification", TEST_ACTION),
    button("Share ReactPing", SHARE_ACTION),
    button("Give feedback", "rp_feedback", { url: feedback(site, medium) }),
  ];
}

/** The public card: generic copy only, so any teammate who clicks starts OAuth for their own account. */
export function installCard(site: string, team: string): SlackMessage {
  return {
    text: "Never miss a reaction 🔔 Get a DM whenever someone reacts to your Slack messages.",
    blocks: [
      section("*Never miss a reaction 🔔*\n\nGet a DM whenever someone reacts to your Slack messages."),
      connect(site, team),
      footer,
    ],
  };
}

/** The private menu for a mention or `/reactping`; `help` is the reply to an unrecognized command (flow 8). */
export function menu(site: string, team: string, connected: boolean, help = false): SlackMessage {
  if (!connected) {
    const text =
      "Hey! 👋 I send you a DM whenever someone reacts to your Slack messages.\n\nYou're not connected yet. Connect your account to get started!";
    return {
      text,
      blocks: [
        section(text),
        connect(site, team),
        button("Give feedback", "rp_feedback", { url: feedback(site, "slack_menu") }),
        footer,
      ],
    };
  }
  const text = help
    ? "Here's what I can help you with:"
    : "✅ You're connected!\n\nI'll notify you whenever someone reacts to your messages.";
  return { text, blocks: [section(text), ...connectedActions(site, "slack_menu")] };
}

export function welcomeMenu(site: string, fallback: string): SlackMessage {
  return {
    text: fallback,
    blocks: [
      section(
        "Welcome to ReactPing! 🎉\n\nYou're all set. Whenever someone reacts to your messages, I'll notify you here.",
      ),
      ...connectedActions(site, "welcome_dm"),
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Best effort: an occasional notification can be missed and nothing is backfilled. Message text is never stored. Disconnect from the Home tab. Replies to this DM aren't read.",
          },
        ],
      },
    ],
  };
}

/** Flow 1.1 success, or flow 10 failure. `app` comes from Slack's signed payload. */
export function testResult(site: string, team: string, app: string | undefined, sent: boolean): SlackMessage {
  if (!sent) {
    const text = "⚠️ Couldn't send your test notification.";
    return {
      text,
      blocks: [
        section(text),
        button("Try again", TEST_ACTION),
        button("Report a problem", "rp_feedback", { url: feedback(site, "slack_menu") }),
      ],
    };
  }
  const text = "✅ Test notification sent!";
  const open = app
    ? [button("Open DM ↗", "rp_open", { url: `https://slack.com/app_redirect?app=${app}&team=${team}` })]
    : [];
  return { text, blocks: [section(text), ...open] };
}

/** When Slack won't let ReactPing post the card: the real link, selectable, never a false success. */
export function shareFallback(site: string, team: string): SlackMessage {
  const link = installLink(site, team);
  return { text: `Copy this link to share ReactPing: ${link}`, blocks: [section(`Copy installation link:\n${link}`)] };
}

/** Flow 6: the destination picker for shares started from a DM, so the card never lands in ReactPing's own DM. */
export function shareView(site: string, team: string): View {
  return {
    type: "modal",
    callback_id: SHARE_MODAL,
    title: { type: "plain_text", text: "Share ReactPing" },
    submit: { type: "plain_text", text: "Share ReactPing" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "destination",
        label: { type: "plain_text", text: "Who would you like to share ReactPing with?" },
        element: {
          type: "conversations_select",
          action_id: "conversation",
          placeholder: { type: "plain_text", text: "Select a person or channel" },
          response_url_enabled: true,
          filter: {
            include: ["public", "private", "im", "mpim"],
            exclude_bot_users: true,
            exclude_external_shared_channels: true,
          },
        },
      },
      section(`*Copy installation link*\n${installLink(site, team)}`),
    ],
  };
}

/** The lowercased command word: text after the leading @ReactPing mention, or after `/reactping`. */
export function commandWord(text: string): string {
  return text
    .replace(/^\s*<@[A-Z0-9]+>/i, "")
    .trim()
    .toLowerCase();
}
