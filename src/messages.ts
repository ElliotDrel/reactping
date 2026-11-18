import type { View } from "@slack/web-api";

export const DISCONNECT_ACTION = "disconnect";

const CHANNEL_ID = /^[CGD][A-Z0-9]{2,31}$/;
/** Slack message timestamps: seconds, a dot, and exactly six digits of microseconds. Kept as text. */
const MESSAGE_TS = /^(\d{1,12})\.(\d{6})$/;
const WORKSPACE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.slack\.com$/;

/** Escapes Slack mrkdwn control characters in text that ReactPing did not write. */
export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Accepts only https://<workspace>.slack.com/ (as returned by auth.test) and returns it normalized. */
export function parseWorkspaceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const plain = !url.username && !url.password && !url.port && !url.search && !url.hash && url.pathname === "/";
  return url.protocol === "https:" && plain && WORKSPACE_HOST.test(url.hostname) ? `https://${url.hostname}/` : null;
}

/**
 * Slack's archive link for a message, built from validated parts without a Slack API call. The timestamp is
 * concatenated as text ("1700000000.000100" -> "p1700000000000100"); converting it to a number would lose digits.
 */
export function messageLink(workspaceUrl: string, channel: string, ts: string): string | null {
  const base = parseWorkspaceUrl(workspaceUrl);
  const parts = MESSAGE_TS.exec(ts);
  if (!base || !parts || !CHANNEL_ID.test(channel)) return null;
  return `${base}archives/${channel}/p${parts[1]}${parts[2]}`;
}

export const PREVIEW_CHARS = 160;

/**
 * One line of a message's text for the DM: Slack markup reduced to its label (`<url|label>` -> label,
 * `<@U1>` -> @U1), whitespace collapsed, cut at a word boundary with an ellipsis, then escaped.
 */
export function messagePreview(text: string | null | undefined): string | null {
  if (!text) return null;
  const plain = text
    .replace(/<([^<>|]*)\|([^<>]*)>/g, "$2")
    .replace(/<([^<>]*)>/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return null;
  if (plain.length <= PREVIEW_CHARS) return escapeMrkdwn(plain);
  const cut = plain.slice(0, PREVIEW_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${escapeMrkdwn((space > PREVIEW_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd())}…`;
}

export function reactionNotification(
  reactorId: string,
  reaction: string,
  link: string,
  preview?: string | null,
): string {
  const line = `<@${escapeMrkdwn(reactorId)}> reacted :${escapeMrkdwn(reaction)}: to <${escapeMrkdwn(link)}|your message>`;
  return preview ? `${line}\n>"${preview}"` : line;
}

/** Instant reply to any DM someone sends ReactPing; the DM itself is saved as feedback. */
export const FEEDBACK_THANKS =
  "Thank you so much for your feedback. We will take it into account and get back to you ASAP.";

export const WELCOME_TEXT =
  "Welcome to ReactPing. You're connected in this workspace: when someone else reacts to one of your messages, " +
  "I'll DM you here with the emoji, who reacted, and a link back. Notifications are best effort, so an occasional " +
  "one can be missed, and nothing is backfilled. Open the ReactPing *Home* tab to disconnect. " +
  "Have feedback? Just reply here.";

const BEST_EFFORT =
  "Best effort: if Slack can't reach ReactPing, or a DM fails, that notification is skipped and never backfilled. " +
  "ReactPing never stores message text.";

export function homeView(options: { connected: boolean; siteUrl: string; includeSelfReactions: boolean }): View {
  if (!options.connected) {
    return {
      type: "home",
      blocks: [
        { type: "header", text: { type: "plain_text", text: "ReactPing" } },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Not connected.* You won't get reaction DMs in this workspace. To connect again, <${escapeMrkdwn(options.siteUrl)}/connect|add ReactPing to Slack>.`,
          },
        },
      ],
    };
  }
  return {
    type: "home",
    blocks: [
      { type: "header", text: { type: "plain_text", text: "ReactPing" } },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Connected.* When someone else reacts to one of your messages in this workspace, ReactPing DMs you here with the emoji, who reacted, and a link back.\n\n*Have feedback?* Send ReactPing a message in the Messages tab.",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: options.includeSelfReactions
              ? `${BEST_EFFORT} Testing mode is on: your own reactions also notify you.`
              : BEST_EFFORT,
          },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: DISCONNECT_ACTION,
            style: "danger",
            text: { type: "plain_text", text: "Disconnect" },
            confirm: {
              title: { type: "plain_text", text: "Disconnect ReactPing?" },
              text: {
                type: "mrkdwn",
                text: "You'll stop getting reaction DMs in this workspace and your stored Slack tokens are deleted. Nobody else's connection changes.",
              },
              confirm: { type: "plain_text", text: "Disconnect" },
              deny: { type: "plain_text", text: "Cancel" },
              style: "danger",
            },
          },
        ],
      },
    ],
  };
}
