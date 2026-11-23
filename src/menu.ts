import type { View } from "@slack/web-api";
import type { SlackMessage } from "./slack.ts";

type Blocks = NonNullable<SlackMessage["blocks"]>;
const section = (text: string): Blocks[number] => ({ type: "section", text: { type: "mrkdwn", text } });
const context = (text: string): Blocks[number] => ({ type: "context", elements: [{ type: "mrkdwn", text }] });
function action(label: string, id: string, opts: { url?: string; value?: string; style?: "primary" } = {}): Blocks[number] {
  return { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: label }, action_id: id, ...opts }] };
}
export const TEAM = /^T[A-Z0-9]{1,31}$/;
export const USER = /^[UW][A-Z0-9]{1,31}$/;
export const CHANNEL = /^[CGD][A-Z0-9]{1,31}$/;
export const APP = /^A[A-Z0-9]{2,31}$/;
export const TS = /^\d{1,12}\.\d{6}$/;
export const valid = (v: unknown, pattern: RegExp): v is string => typeof v === "string" && pattern.test(v);
export const SHARE_MODAL = "reactping_share_destination";
export const TEST_TEXT = "🧪 *Test notification*\n\nSomeone reacted 🎉 to your message.\n\nThis is what your future reaction notifications will look like.";
export const installLink = (site: string, team: string) => `${site}/api/slack/install?team=${encodeURIComponent(team)}`;
const feedback = (site: string, welcome = false) => `${site}/feedback?utm_source=slack&utm_medium=${welcome ? "welcome_dm" : "mention_menu"}`;

export function installCard(site: string, team: string): SlackMessage {
  const text = "Never miss a reaction 🔔\nGet a DM whenever someone reacts to your Slack messages.";
  return { text, blocks: [
    section("*Never miss a reaction 🔔*\nGet a DM whenever someone reacts to your Slack messages."),
    action("Connect ReactPing", "rp_connect", { url: installLink(site, team), style: "primary" }),
    context("Free · Already available in this workspace"),
  ] };
}
function actions(site: string, welcome: boolean): Blocks {
  const value = welcome ? "welcome" : "conversation";
  return [
    action("Send test notification", "rp_test", { value }),
    action("Share ReactPing", "rp_share", { value }),
    action("Give feedback", "rp_feedback", { url: feedback(site, welcome) }),
  ];
}
export function menu(site: string, team: string, connected: boolean, unknown = false): SlackMessage {
  const text = connected
    ? unknown ? "Here's what I can help you with:" : "✅ You're connected!\nI'll notify you whenever someone reacts to your messages."
    : "Hey! 👋 I send you a DM whenever someone reacts to your Slack messages.\n\nYou're not connected yet. Connect your account to get started!";
  return { text, blocks: [section(text), ...(connected ? actions(site, false) : [
    action("Connect ReactPing", "rp_connect", { url: installLink(site, team), style: "primary" }),
    action("Give feedback", "rp_feedback", { url: feedback(site) }),
    context("Free · Already available in this workspace"),
  ])] };
}
export function welcomeMenu(site: string, fallback: string): SlackMessage {
  return { text: fallback, blocks: [
    section("Welcome to ReactPing! 🎉\n\nYou're all set. Whenever someone reacts to your messages, I'll notify you here."),
    ...actions(site, true),
    context("Notifications are best effort, never backfilled, and message text is never stored. Disconnect from the Home tab. Replies to this DM aren't read."),
  ] };
}
export function testResult(site: string, team: string, app: string | null, success: boolean): SlackMessage {
  const text = success ? "✅ Test notification sent!" : "⚠️ Couldn't send your test notification.";
  return { text, blocks: [section(text), ...(success ? (app && APP.test(app) ? [
    action("Open DM", "rp_open", { url: `https://slack.com/app_redirect?app=${app}&team=${team}` }),
  ] : []) : [
    action("Try again", "rp_test", { value: "conversation" }),
    action("Report a problem", "rp_feedback", { url: feedback(site) }),
  ])] };
}
export function shareFallback(site: string, team: string): SlackMessage {
  const link = installLink(site, team);
  return { text: `Copy installation link: ${link}`, blocks: [section("Couldn't share directly. Copy installation link:"), section(link)] };
}
export function shareView(site: string, team: string): View {
  return {
    type: "modal",
    callback_id: SHARE_MODAL,
    title: { type: "plain_text", text: "Share ReactPing" },
    submit: { type: "plain_text", text: "Share ReactPing" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input", block_id: "destination",
        label: { type: "plain_text", text: "Who would you like to share ReactPing with?" },
        element: {
          type: "conversations_select", action_id: "conversation",
          placeholder: { type: "plain_text", text: "Select a person or channel" },
          response_url_enabled: true,
          filter: { exclude_external_shared_channels: true, include: ["public", "private", "im", "mpim"] },
        },
      },
      { type: "section", text: { type: "mrkdwn", text: `*Copy installation link*\n${installLink(site, team)}` } },
    ],
  };
}
export function commandText(text: string, mention: boolean): string {
  return (mention ? text.replace(/^<@[A-Z0-9]+>\s*/i, "") : text).trim().toLowerCase();
}
