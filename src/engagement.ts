import type { Store } from "./db.ts";
import type { SlackApi, SlackMessage } from "./slack.ts";
import { hmac } from "./crypto.ts";
import {
  APP, CHANNEL, TEAM, TS, USER, SHARE_MODAL, TEST_TEXT, commandText, installCard, menu,
  shareFallback, shareView, testResult, valid,
} from "./menu.ts";

type Context = { team: string; user: string; channel?: string; thread?: string; app?: string; response?: string; welcome?: boolean };
export type Interaction = {
  type?: unknown;
  team?: { id?: unknown } | null;
  user?: { id?: unknown; team_id?: unknown } | null;
  is_enterprise_install?: unknown;
  api_app_id?: unknown;
  actions?: { action_id?: unknown; value?: unknown }[];
  channel?: { id?: unknown };
  container?: { channel_id?: unknown; thread_ts?: unknown };
  message?: { thread_ts?: unknown };
  response_url?: unknown;
  trigger_id?: unknown;
  view?: { callback_id?: unknown; state?: { values?: { destination?: { conversation?: { selected_conversation?: unknown } } } } };
  response_urls?: { block_id?: unknown; action_id?: unknown; channel_id?: unknown; response_url?: unknown }[];
};

export function responseUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (url.origin !== "https://hooks.slack.com" || url.username || url.password || url.search || url.hash) return;
    if (!/^\/(commands|actions|app|app-actions)\/[A-Z0-9]+\/[^/]+\/[^/]+$/.test(url.pathname)) return;
    return url.href;
  } catch { return; }
}
export function createEngagement(store: Store, slack: SlackApi, site: string, key: Buffer) {
  const claim = (id: string) => store.claimEngagement(hmac(key, id, "hex"));
  async function privateReply(ctx: Context, message: SlackMessage): Promise<void> {
    if (ctx.response) {
      try { await slack.respond(ctx.response, message, "ephemeral"); return; } catch { /* native fallback */ }
    }
    const bot = await store.workspaceBot(ctx.team);
    if (!bot) return;
    if (ctx.channel && !ctx.welcome) {
      try { await slack.postEphemeral(bot.botToken, ctx.channel, ctx.user, message, ctx.thread); return; } catch { /* DM fallback */ }
    }
    await slack.postMessage(bot.botToken, ctx.user, message.text, { blocks: message.blocks });
  }
  async function share(ctx: Context, confirm = false): Promise<void> {
    const card = installCard(site, ctx.team);
    try {
      if (ctx.response) await slack.respond(ctx.response, card, "in_channel");
      else {
        const bot = await store.workspaceBot(ctx.team);
        if (!bot || !ctx.channel || ctx.channel.startsWith("D")) throw new Error("share_unavailable");
        await slack.postMessage(bot.botToken, ctx.channel, card.text, { blocks: card.blocks, threadTs: ctx.thread });
      }
    } catch {
      await privateReply(ctx, shareFallback(site, ctx.team));
      return;
    }
    if (confirm) await privateReply(ctx, { text: "✅ Shared successfully!" });
  }
  async function test(ctx: Context): Promise<void> {
    const installation = await store.get(ctx.team, ctx.user);
    if (!installation) { await privateReply(ctx, menu(site, ctx.team, false)); return; }
    const bot = await store.workspaceBot(ctx.team);
    let success = false;
    try { await slack.postMessage(installation.botToken, ctx.user, TEST_TEXT); success = true; } catch { /* report failure */ }
    await privateReply(ctx, testResult(site, ctx.team, ctx.app ?? bot?.appId ?? null, success));
  }
  async function dispatch(ctx: Context, command: string): Promise<void> {
    if (command === "install") { await share(ctx); return; }
    if (command === "test") { await test(ctx); return; }
    const connected = Boolean(await store.get(ctx.team, ctx.user));
    await privateReply(ctx, menu(site, ctx.team, connected, command !== "" && command !== "help"));
  }
  async function mention(team: string, event: { user?: unknown; text?: unknown; channel?: unknown; ts?: unknown; thread_ts?: unknown; bot_id?: unknown; subtype?: unknown; user_team?: unknown }, app: unknown, eventId: unknown): Promise<void> {
    if (!valid(event.user, USER) || !valid(event.channel, CHANNEL) || !valid(event.ts, TS) ||
        typeof event.text !== "string" || event.bot_id || event.subtype ||
        (event.user_team !== undefined && event.user_team !== team) ||
        typeof eventId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) return;
    if (!await claim(`mention:${team}:${eventId}`)) return;
    const thread = valid(event.thread_ts, TS) ? event.thread_ts : event.ts;
    await dispatch({ team, user: event.user, channel: event.channel, thread, app: valid(app, APP) ? app : undefined }, commandText(event.text, true));
  }
  async function slash(form: URLSearchParams, raw: string): Promise<void> {
    const team = form.get("team_id"), user = form.get("user_id"), channel = form.get("channel_id");
    if (form.get("command") !== "/reactping" || !valid(team, TEAM) || !valid(user, USER) ||
        !valid(channel, CHANNEL) || form.get("is_enterprise_install") === "true") return;
    if (!await claim(`slash:${raw}`)) return;
    const app = form.get("api_app_id");
    await dispatch({ team, user, channel, app: valid(app, APP) ? app : undefined, response: responseUrl(form.get("response_url")) }, commandText(form.get("text") ?? "", false));
  }
  function context(payload: Interaction): Context | undefined {
    const team = payload.team?.id, user = payload.user?.id;
    if (!valid(team, TEAM) || !valid(user, USER) || payload.is_enterprise_install === true ||
        (payload.user?.team_id !== undefined && payload.user.team_id !== team)) return;
    const channel = payload.channel?.id ?? payload.container?.channel_id;
    const thread = payload.container?.thread_ts ?? payload.message?.thread_ts;
    return { team, user, channel: valid(channel, CHANNEL) ? channel : undefined,
      thread: valid(thread, TS) ? thread : undefined, app: valid(payload.api_app_id, APP) ? payload.api_app_id : undefined,
      response: responseUrl(payload.response_url), welcome: payload.actions?.[0]?.value === "welcome" };
  }
  async function openShare(payload: Interaction, raw: string): Promise<void> {
    const ctx = context(payload);
    if (!ctx || !await claim(`action:${raw}`)) return;
    if (!await store.get(ctx.team, ctx.user)) { await privateReply(ctx, menu(site, ctx.team, false)); return; }
    const bot = await store.workspaceBot(ctx.team);
    if (bot && typeof payload.trigger_id === "string") {
      try { await slack.openView(bot.botToken, payload.trigger_id, shareView(site, ctx.team)); return; } catch { /* fallback */ }
    }
    await privateReply(ctx, shareFallback(site, ctx.team));
  }
  async function action(payload: Interaction, raw: string): Promise<void> {
    const ctx = context(payload);
    if (!ctx) return;
    const action = payload.actions?.[0]?.action_id;
    if (payload.type === "view_submission" && payload.view?.callback_id === SHARE_MODAL) {
      if (!await claim(`view:${raw}`) || !await store.get(ctx.team, ctx.user)) return;
      const dest = payload.view.state?.values?.destination?.conversation?.selected_conversation;
      if (!valid(dest, CHANNEL)) return;
      const target = payload.response_urls?.find(r => r.block_id === "destination" && r.action_id === "conversation" && r.channel_id === dest);
      const reply = responseUrl(target?.response_url);
      if (!reply) { await privateReply(ctx, shareFallback(site, ctx.team)); return; }
      try { await slack.respond(reply, installCard(site, ctx.team), "in_channel"); }
      catch { await privateReply(ctx, shareFallback(site, ctx.team)); return; }
      await privateReply(ctx, { text: "✅ Shared successfully!" });
      return;
    }
    if (payload.type !== "block_actions" || (action !== "rp_test" && action !== "rp_share")) return;
    if (!await claim(`action:${raw}`)) return;
    if (action === "rp_test") { await test(ctx); return; }
    if (!await store.get(ctx.team, ctx.user)) { await privateReply(ctx, menu(site, ctx.team, false)); return; }
    if (ctx.welcome || !ctx.channel) { await privateReply(ctx, shareFallback(site, ctx.team)); return; }
    await share(ctx, true);
  }
  return { mention, slash, action, openShare };
}
