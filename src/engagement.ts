/**
 * Mentions, `/reactping`, and the menu buttons (issue #5). Identity comes only from Slack's signed team and user
 * fields; replies stay in that workspace. Private status goes through Slack's ephemeral responses; only the generic
 * install card is ever posted publicly.
 */
import type { Store } from "./db.ts";
import { log } from "./log.ts";
import {
  commandWord,
  installCard,
  menu,
  SHARE_ACTION,
  SHARE_MODAL,
  SHARED_TEXT,
  shareFallback,
  shareView,
  TEST_ACTION,
  TEST_TEXT,
  testResult,
  type SlackMessage,
} from "./menu.ts";
import { APP_ID, CHANNEL_ID, classifySlackError, TEAM_ID, TS, USER_ID, type SlackApi } from "./slack.ts";

/** Where a request came from: the signed workspace and user, plus where Slack lets ReactPing answer. */
interface Context {
  team: string;
  user: string;
  app?: string;
  channel?: string;
  thread?: string;
  /** Slack's per-request reply URL (commands, buttons). Mentions have none and use the bot token instead. */
  response?: string;
}

export interface Interaction {
  type?: unknown;
  team?: { id?: unknown } | null;
  user?: { id?: unknown; team_id?: unknown } | null;
  is_enterprise_install?: unknown;
  api_app_id?: unknown;
  trigger_id?: unknown;
  response_url?: unknown;
  actions?: { action_id?: unknown }[];
  channel?: { id?: unknown } | null;
  container?: { channel_id?: unknown; thread_ts?: unknown } | null;
  message?: { thread_ts?: unknown } | null;
  view?: {
    callback_id?: unknown;
    state?: { values?: { destination?: { conversation?: { selected_conversation?: unknown } } } };
  } | null;
  response_urls?: { channel_id?: unknown; response_url?: unknown }[];
}

export interface MentionEvent {
  user?: unknown;
  text?: unknown;
  channel?: unknown;
  ts?: unknown;
  thread_ts?: unknown;
  bot_id?: unknown;
  subtype?: unknown;
  /** Set for people from another organization in a shared channel; they never get this workspace's menus. */
  user_team?: unknown;
}

const is = (value: unknown, pattern: RegExp): value is string => typeof value === "string" && pattern.test(value);
const opt = (value: unknown, pattern: RegExp) => (is(value, pattern) ? value : undefined);

/** Only Slack's own response hosts, so a forged payload can't turn ReactPing into a request proxy. */
export function responseUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.origin !== "https://hooks.slack.com" || url.username || url.password || url.search || url.hash)
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function createEngagement(store: Store, slack: SlackApi, site: string) {
  const failed = (step: string) => (error: unknown) =>
    log("warn", "engagement_failed", { step, error: classifySlackError(error).message });

  /**
   * Slack's response URL can't reliably answer inside a thread (it rejects `thread_ts` from an ephemeral menu with
   * `wrong_thread_ts`), so threads use the bot token. A thread only comes from a mention, so the bot is a member.
   */
  const responseOutsideThread = (ctx: Context) => (ctx.thread ? undefined : ctx.response);

  /** Private to the requester: Slack's ephemeral response, else (or if that fails) an ephemeral bot message. */
  async function reply(ctx: Context, message: SlackMessage): Promise<void> {
    const response = responseOutsideThread(ctx);
    if (response) {
      const sent = await slack.respond(response, message, { visibility: "ephemeral" }).then(
        () => true,
        (error: unknown) => (failed("reply")(error), false),
      );
      if (sent) return;
    }
    const bot = await store.workspaceBot(ctx.team);
    if (!bot || !ctx.channel) return log("info", "engagement_unanswered", { reason: "no_bot_token" });
    await slack.postEphemeral(bot, ctx.channel, ctx.user, message, ctx.thread);
  }

  /** Posts the public card where the person asked. Confirms only after Slack accepted it; else offers the link. */
  async function share(ctx: Context, confirm: boolean): Promise<void> {
    const card = installCard(site, ctx.team);
    try {
      const response = responseOutsideThread(ctx);
      if (response) await slack.respond(response, card, { visibility: "in_channel" });
      else {
        const bot = await store.workspaceBot(ctx.team);
        if (!bot || !ctx.channel) throw new Error("no_bot_token");
        await slack.postMessage(bot, ctx.channel, card.text, { blocks: card.blocks, threadTs: ctx.thread });
      }
    } catch (error) {
      failed("share")(error);
      return reply(ctx, shareFallback(site, ctx.team));
    }
    if (confirm) await reply(ctx, { text: SHARED_TEXT });
  }

  /** Sends the test DM with the same token real notifications use, and records nothing as a real reaction. */
  async function test(ctx: Context): Promise<void> {
    const installation = await store.get(ctx.team, ctx.user);
    if (!installation) return reply(ctx, menu(site, ctx.team, false));
    let sent = true;
    await slack.postMessage(installation.botToken, ctx.user, TEST_TEXT).catch((error: unknown) => {
      failed("test")(error);
      sent = false;
    });
    await reply(ctx, testResult(site, ctx.team, ctx.app, sent));
  }

  async function command(ctx: Context, word: string): Promise<void> {
    if (word === "install") return share(ctx, false);
    if (word === "test") return test(ctx);
    const connected = Boolean(await store.get(ctx.team, ctx.user));
    await reply(ctx, menu(site, ctx.team, connected, word !== "" && word !== "help"));
  }

  return {
    /**
     * `app_mention`: Slack only sends it from conversations ReactPing is in. Replies stay where the mention was:
     * inside its thread, or inline for a top-level mention. A private reply in a new thread is invisible, because
     * Slack shows no reply indicator for ephemeral-only threads.
     */
    async mention(team: string, event: MentionEvent, app: unknown): Promise<void> {
      if (!is(event.user, USER_ID) || !is(event.channel, CHANNEL_ID) || !is(event.ts, TS)) return;
      if (typeof event.text !== "string" || event.bot_id !== undefined || event.subtype !== undefined) return;
      if (event.user_team !== undefined && event.user_team !== team) return;
      const ctx = { team, user: event.user, channel: event.channel, app: opt(app, APP_ID) };
      await command({ ...ctx, thread: opt(event.thread_ts, TS) }, commandWord(event.text));
    },

    /** `/reactping [install]`, answered through the command's response URL (works in DMs without membership). */
    async slash(form: URLSearchParams): Promise<void> {
      const team = form.get("team_id");
      const user = form.get("user_id");
      if (form.get("command") !== "/reactping" || !is(team, TEAM_ID) || !is(user, USER_ID)) return;
      if (form.get("is_enterprise_install") === "true") return;
      const response = responseUrl(form.get("response_url"));
      if (!response) return;
      const ctx = { team, user, response, channel: opt(form.get("channel_id"), CHANNEL_ID) };
      await command({ ...ctx, app: opt(form.get("api_app_id"), APP_ID) }, commandWord(form.get("text") ?? ""));
    },

    /**
     * Menu buttons and the share modal. Returns true when it handled the payload. Opening the modal is awaited
     * because Slack's trigger_id expires within seconds; everything else runs after the acknowledgement.
     */
    async interaction(payload: Interaction, background: (task: () => Promise<void>) => void): Promise<boolean> {
      const team = payload.team?.id;
      const user = payload.user?.id;
      const userTeam = payload.user?.team_id;
      if (!is(team, TEAM_ID) || !is(user, USER_ID) || payload.is_enterprise_install === true) return false;
      if (userTeam !== undefined && userTeam !== team) return false;
      const ctx: Context = { team, user, app: opt(payload.api_app_id, APP_ID) };

      if (payload.type === "view_submission" && payload.view?.callback_id === SHARE_MODAL) {
        const destination = payload.view.state?.values?.destination?.conversation?.selected_conversation;
        const target = payload.response_urls?.find((r) => r.channel_id === destination);
        const response = responseUrl(target?.response_url);
        background(async () => {
          // Without a response URL for the chosen conversation there is no private channel to answer on either.
          if (!response) return log("info", "engagement_unanswered", { reason: "no_destination_url" });
          // The confirmation or fallback link appears privately to the sharer in the conversation they chose.
          const posted = await slack.respond(response, installCard(site, team), { visibility: "in_channel" }).then(
            () => true,
            (error: unknown) => (failed("modal")(error), false),
          );
          await slack.respond(response, posted ? { text: SHARED_TEXT } : shareFallback(site, team), {
            visibility: "ephemeral",
          });
        });
        return true;
      }

      const action = payload.actions?.[0]?.action_id;
      if (payload.type !== "block_actions" || (action !== TEST_ACTION && action !== SHARE_ACTION)) return false;
      ctx.channel = opt(payload.channel?.id ?? payload.container?.channel_id, CHANNEL_ID);
      ctx.thread = opt(payload.container?.thread_ts ?? payload.message?.thread_ts, TS);
      ctx.response = responseUrl(payload.response_url);
      if (action === TEST_ACTION) {
        background(() => test(ctx));
        return true;
      }
      // In any DM (including ReactPing's own) ask where to share instead of posting into that DM.
      if (!ctx.channel || ctx.channel.startsWith("D")) {
        const bot = await store.workspaceBot(team);
        const trigger = typeof payload.trigger_id === "string" ? payload.trigger_id : undefined;
        const opened =
          bot && trigger
            ? await slack.openView(bot, trigger, shareView(site, team)).then(
                () => true,
                (error: unknown) => (failed("open_modal")(error), false),
              )
            : false;
        if (!opened) background(() => reply(ctx, shareFallback(site, team)));
        return true;
      }
      background(() => share(ctx, true));
      return true;
    },
  };
}
