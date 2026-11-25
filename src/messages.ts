import type { View } from "@slack/web-api";

export const DISCONNECT_ACTION = "disconnect";
export const MUTE_ACTION = "rp_mute";
export const MUTED_TEXT = "🔕 Announcements muted. Your reaction DMs keep coming.";

/** An announcement DM: the text as written (Slack mrkdwn), with a way to stop future ones. */
export function announcementMessage(text: string): { text: string; blocks: View["blocks"] } {
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      {
        type: "actions",
        elements: [
          { type: "button", action_id: MUTE_ACTION, text: { type: "plain_text", text: "Mute announcements" } },
        ],
      },
    ],
  };
}

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
 * One line of a message's text for the DM, whitespace collapsed, cut at a word boundary with an ellipsis, then
 * escaped. User and channel mentions stay Slack markup (`<@U1>`, `<#C1>`) so Slack shows names, not IDs; they
 * can't notify anyone from a DM the mentioned people aren't in. Other markup becomes plain text: `<url|label>` ->
 * label, `<!here>` -> @here, `<url>` -> url. Mentions ride through cutting and escaping as \uE000…\uE001 tokens.
 */
export function messagePreview(text: string | null | undefined): string | null {
  if (!text) return null;
  const plain = text
    .replace(/[\uE000\uE001]/g, "")
    .replace(/<([@#][UWC][A-Z0-9]+)(?:\|[^<>]*)?>/g, "\uE000$1\uE001")
    .replace(/<([^<>|]*)\|([^<>]*)>/g, "$2")
    .replace(/<!([^<>]*)>/g, "@$1")
    .replace(/<([^<>]*)>/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return null;
  let preview = plain;
  if (plain.length > PREVIEW_CHARS) {
    const cut = plain.slice(0, PREVIEW_CHARS);
    const space = cut.lastIndexOf(" ");
    // A cut through a mention token drops the partial token rather than showing a broken ID.
    preview = `${(space > PREVIEW_CHARS / 2 ? cut.slice(0, space) : cut).replace(/\uE000[^\uE001]*$/, "").trimEnd()}…`;
  }
  return escapeMrkdwn(preview).replace(/\uE000([^\uE001]+)\uE001/g, "<$1>");
}

export function reactionNotification(
  reactorId: string,
  reaction: string,
  link: string,
  preview?: string | null,
  total?: number,
): string {
  const emoji = `:${escapeMrkdwn(reaction)}:`;
  // The running total makes "react if you're coming" polls readable from the DM alone.
  const count = total && total > 1 ? ` · ${total} ${emoji} total` : "";
  const line = `<@${escapeMrkdwn(reactorId)}> reacted ${emoji} to <${escapeMrkdwn(link)}|your message>${count}`;
  return preview ? `${line}\n>"${preview}"` : line;
}

/**
 * The website feedback form, linked from Slack. UTM tags say which Slack message it was opened from; the form's
 * handler reads them back from the Referer, so feedback from Slack can be told apart from direct website visits.
 */
export function feedbackLink(siteUrl: string, medium: "welcome_dm" | "home_tab"): string {
  return `${siteUrl}/feedback?utm_source=slack&utm_medium=${medium}`;
}

/** ReactPing can't read replies (no message-history permission), so feedback goes through the website form. */
export function welcomeText(siteUrl: string): string {
  return (
    "Welcome to ReactPing. You're connected in this workspace: when someone else reacts to one of your messages, " +
    "I'll DM you here with the emoji, who reacted, and a link back. Notifications are best effort, so an occasional " +
    "one can be missed, and nothing is backfilled. Open the ReactPing *Home* tab to disconnect.\n\n" +
    `*Have feedback or found a bug?* Tell us with this short form: <${escapeMrkdwn(feedbackLink(siteUrl, "welcome_dm"))}|send feedback>. ` +
    "Replies to this DM aren't read, so please use the form."
  );
}

const BEST_EFFORT =
  "Best effort: if Slack can't reach ReactPing, or a DM fails, that notification is skipped and never backfilled. " +
  "ReactPing never stores message text.";

/** Shown while the workspace's bot lacks scopes added since it was installed (mentions and /reactping). */
export function upgradeBlocks(reconnectUrl: string): View["blocks"] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*New:* mention @ReactPing or type `/reactping` to send yourself a test notification or share ReactPing with teammates. Your workspace needs one quick reconnect to turn it on. Your reaction DMs keep working either way.",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "Reconnect ReactPing" },
          url: reconnectUrl,
        },
      ],
    },
  ];
}

export function homeView(options: {
  connected: boolean;
  siteUrl: string;
  includeSelfReactions: boolean;
  reconnectUrl?: string;
}): View {
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
          text: `*Connected.* When someone else reacts to one of your messages in this workspace, ReactPing DMs you here with the emoji, who reacted, and a link back.\n\n*Have feedback or found a bug?* Tell us with this short form: <${escapeMrkdwn(feedbackLink(options.siteUrl, "home_tab"))}|send feedback>.`,
        },
      },
      ...(options.reconnectUrl ? upgradeBlocks(options.reconnectUrl) : []),
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
