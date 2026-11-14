import type { Config } from "./config.ts";
import { deriveKey, hmac, safeEqual } from "./crypto.ts";
import type { Installation, Store } from "./db.ts";
import { log } from "./log.ts";
import {
  DISCONNECT_ACTION,
  homeView,
  messageLink,
  parseWorkspaceUrl,
  reactionNotification,
  WELCOME_TEXT,
} from "./messages.ts";
import { createOAuthState, OAUTH_STATE_TTL_SECONDS, verifyOAuthState } from "./oauth-state.ts";
import { resultPage } from "./pages.ts";
import {
  BOT_SCOPES,
  classifySlackError,
  SlackCallError,
  USER_SCOPES,
  type OAuthResult,
  type SlackApi,
} from "./slack.ts";

export interface Deps {
  config: Config;
  store: Store;
  slack: SlackApi;
  /** Runs work after the response is sent (on Vercel: start it and hand the promise to waitUntil). */
  background: (task: () => Promise<unknown>) => void;
  now?: () => number;
}

export type Handler = (request: Request) => Promise<Response>;

/** Slack signs requests with a timestamp; older or future ones are rejected (replay window). */
const MAX_SKEW_SECONDS = 5 * 60;
/** Events and interaction payloads are small; the Home view in block_actions payloads is the largest part. */
export const MAX_BODY_BYTES = 256 * 1024;

const TEAM_ID = /^T[A-Z0-9]{1,31}$/;
const USER_ID = /^[UW][A-Z0-9]{1,31}$/;
const APP_ID = /^A[A-Z0-9]{2,31}$/;
const REACTION = /^[a-z0-9_+'\-:]{1,100}$/;
const OAUTH_CODE = /^[A-Za-z0-9._-]{1,256}$/;

const NO_STORE = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

function plain(status: number, body = ""): Response {
  return new Response(body, { status, headers: { ...NO_STORE, "content-type": "text/plain; charset=utf-8" } });
}

export function verifySlackSignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  nowMs: number,
): boolean {
  if (!timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  return safeEqual(`v0=${hmac(signingSecret, `v0:${timestamp}:${rawBody}`, "hex")}`, signature);
}

/** Reads the raw body (needed byte-for-byte for the signature), refusing anything over `limit`. */
export async function readBody(request: Request, limit = MAX_BODY_BYTES): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

interface SlackEvent {
  type?: unknown;
  user?: unknown;
  reaction?: unknown;
  item_user?: unknown;
  item?: { type?: unknown; channel?: unknown; ts?: unknown };
  tab?: unknown;
  tokens?: { oauth?: unknown; bot?: unknown };
}

/** The four Slack routes. With `deps` null (missing or invalid configuration) every route fails closed. */
export function createHandler(deps: Deps | null): Handler {
  if (!deps) return async () => plain(503, "not_configured");
  const { config, store, slack } = deps;
  const now = deps.now ?? Date.now;
  const stateKey = deriveKey(config.encryptionKey, "oauth-state");
  const secure = config.siteUrl.startsWith("https://");
  // __Host- requires Secure and Path=/ and forbids Domain, so no other host can plant or read the cookie.
  const cookieName = secure ? "__Host-reactping_oauth" : "reactping_oauth";
  const redirectUri = `${config.siteUrl}/api/slack/oauth/callback`;
  const siteHost = new URL(config.siteUrl).host;

  function stateCookie(value: string, maxAge: number): string {
    return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  }

  /** Runs after the response; failures are logged by name only. */
  function background(name: string, task: () => Promise<unknown>): void {
    deps!.background(() =>
      task().catch((error: unknown) =>
        log("error", "background_failed", {
          task: name,
          error: error instanceof SlackCallError ? error.message : (error as Error)?.name,
        }),
      ),
    );
  }

  function home(installation: Pick<Installation, "botToken" | "userId">, connected: boolean): Promise<void> {
    return slack.publishHome(
      installation.botToken,
      installation.userId,
      homeView({ connected, siteUrl: config.siteUrl, includeSelfReactions: config.includeSelfReactions }),
    );
  }

  /** Verifies Slack's signature over the exact raw body. Returns the body, or the error response. */
  async function signedBody(request: Request): Promise<string | Response> {
    const raw = await readBody(request);
    if (raw === null) return plain(413, "too_large");
    const ok = verifySlackSignature(
      config.slackSigningSecret,
      raw,
      request.headers.get("x-slack-request-timestamp"),
      request.headers.get("x-slack-signature"),
      now(),
    );
    return ok ? raw : plain(401, "invalid_signature");
  }

  // Install

  function install(request: Request): Response {
    // The state cookie is host-only, so the flow must start on the host Slack redirects back to.
    if (new URL(request.url).host !== siteHost) {
      return new Response(null, {
        status: 302,
        headers: { ...NO_STORE, location: `${config.siteUrl}/api/slack/install` },
      });
    }
    const { state, cookie } = createOAuthState(stateKey, now());
    const authorize = new URL("https://slack.com/oauth/v2/authorize");
    authorize.searchParams.set("client_id", config.slackClientId);
    authorize.searchParams.set("scope", BOT_SCOPES.join(","));
    authorize.searchParams.set("user_scope", USER_SCOPES.join(","));
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("state", state);
    return new Response(null, {
      status: 302,
      headers: { ...NO_STORE, location: authorize.href, "set-cookie": stateCookie(cookie, OAUTH_STATE_TTL_SECONDS) },
    });
  }

  /** Revokes a user grant from a rejected install, unless it is the grant an existing installation still uses. */
  async function revokeRejectedGrant(result: OAuthResult): Promise<void> {
    if (!result.userToken) return;
    if (result.teamId && result.userId && TEAM_ID.test(result.teamId) && USER_ID.test(result.userId)) {
      const existing = await store.get(result.teamId, result.userId);
      if (existing?.userToken === result.userToken) return;
    }
    await slack.revoke(result.userToken).catch((error: unknown) => {
      log("warn", "revoke_failed", { error: classifySlackError(error).message });
    });
  }

  async function callback(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const clear = stateCookie("", 0);
    const page = (status: number, outcome: Parameters<typeof resultPage>[0], link?: string) =>
      resultPage(outcome, status, clear, link);

    // Wrong browser, expired, forged, or tampered state all look the same.
    if (!verifyOAuthState(stateKey, readCookie(request, cookieName), url.searchParams.get("state"), now())) {
      return page(400, "expired");
    }
    const error = url.searchParams.get("error");
    if (error) return page(error === "access_denied" ? 200 : 400, error === "access_denied" ? "cancelled" : "failed");
    const code = url.searchParams.get("code");
    if (!code || !OAUTH_CODE.test(code)) return page(400, "failed");

    let result: OAuthResult;
    try {
      result = await slack.oauthAccess(code, redirectUri);
    } catch (e) {
      log("warn", "oauth_exchange_failed", { error: classifySlackError(e).message });
      return page(502, "failed");
    }

    if (result.isEnterpriseInstall || result.enterpriseId) {
      await revokeRejectedGrant(result);
      return page(400, "enterprise");
    }
    const { teamId, userId, botToken, userToken } = result;
    if (
      !teamId ||
      !TEAM_ID.test(teamId) ||
      !userId ||
      !USER_ID.test(userId) ||
      !botToken ||
      !userToken ||
      result.userTokenType !== "user"
    ) {
      log("warn", "oauth_incomplete");
      await revokeRejectedGrant(result);
      return page(502, "failed");
    }
    if (
      !USER_SCOPES.every((s) => result.userScopes.includes(s)) ||
      !BOT_SCOPES.every((s) => result.botScopes.includes(s))
    ) {
      await revokeRejectedGrant(result);
      return page(400, "scopes");
    }

    let workspaceUrl: string | null = null;
    try {
      const identity = await slack.authTest(botToken);
      if (identity.teamId === teamId) workspaceUrl = parseWorkspaceUrl(identity.url);
    } catch (e) {
      log("warn", "auth_test_failed", { error: classifySlackError(e).message });
    }
    if (!workspaceUrl) {
      await revokeRejectedGrant(result);
      return page(502, "failed");
    }

    const installation = await store.upsert({ teamId, userId, workspaceUrl, botToken, userToken });
    log("info", "installation_connected", { teamId });
    background("welcome", async () => {
      await slack.postMessage(installation.botToken, installation.userId, WELCOME_TEXT);
      await home(installation, true);
    });
    const appId = result.appId && APP_ID.test(result.appId) ? result.appId : null;
    return page(200, "connected", appId ? `https://slack.com/app_redirect?app=${appId}&team=${teamId}` : undefined);
  }

  // Events

  async function events(request: Request): Promise<Response> {
    const raw = await signedBody(request);
    if (raw instanceof Response) return raw;
    let body: { type?: unknown; challenge?: unknown; team_id?: unknown; event?: SlackEvent };
    try {
      body = JSON.parse(raw);
    } catch {
      return plain(400, "invalid_json");
    }
    if (body.type === "url_verification" && typeof body.challenge === "string" && body.challenge.length <= 200) {
      return plain(200, body.challenge);
    }
    const teamId = body.team_id;
    const event = body.event;
    if (body.type !== "event_callback" || typeof teamId !== "string" || !TEAM_ID.test(teamId) || !event) {
      return plain(200);
    }

    // Lifecycle cleanup is idempotent and runs before the 200, so Slack's retries are welcome here.
    if (event.type === "app_uninstalled") {
      log("info", "app_uninstalled", { teamId, installations: await store.deleteTeam(teamId) });
      return plain(200);
    }
    if (event.type === "tokens_revoked") {
      // A revoked bot token means nobody in the workspace can be DMed; revoked user tokens stop those users only.
      const removed = strings(event.tokens?.bot).length
        ? await store.deleteTeam(teamId)
        : await store.deleteUsers(
            teamId,
            strings(event.tokens?.oauth).filter((id) => USER_ID.test(id)),
          );
      log("info", "tokens_revoked", { teamId, installations: removed });
      return plain(200);
    }

    // Notifications are best effort: acknowledge now, work after the response, never act on a retry.
    if (request.headers.has("x-slack-retry-num")) {
      log("info", "retry_ignored", { reason: (request.headers.get("x-slack-retry-reason") ?? "").slice(0, 40) });
      return plain(200);
    }
    if (event.type === "reaction_added") background("reaction", () => notify(teamId, event));
    else if (event.type === "app_home_opened") background("home", () => openHome(teamId, event));
    return plain(200);
  }

  async function notify(teamId: string, event: SlackEvent): Promise<void> {
    const { item, user: reactorId, item_user: authorId, reaction } = event;
    if (item?.type !== "message" || typeof item.channel !== "string" || typeof item.ts !== "string") return;
    if (typeof reactorId !== "string" || !USER_ID.test(reactorId)) return;
    if (typeof authorId !== "string" || !USER_ID.test(authorId)) return;
    if (typeof reaction !== "string" || !REACTION.test(reaction)) return;
    if (reactorId === authorId && !config.includeSelfReactions) return;

    // Only the message author's own installation in this same workspace is ever notified.
    const installation = await store.get(teamId, authorId);
    if (!installation) return;
    const link = messageLink(installation.workspaceUrl, item.channel, item.ts);
    if (!link) return;
    try {
      await slack.postMessage(
        installation.botToken,
        installation.userId,
        reactionNotification(reactorId, reaction, link),
      );
    } catch (error) {
      const failure = classifySlackError(error);
      log("warn", "notify_failed", { error: failure.message });
      // Dead credentials: drop the row, unless the user reinstalled while this request was in flight.
      if (failure.kind === "revoked") await store.deleteIfUnchanged(installation);
    }
  }

  async function openHome(teamId: string, event: SlackEvent): Promise<void> {
    if (event.tab !== "home" || typeof event.user !== "string" || !USER_ID.test(event.user)) return;
    const installation = await store.get(teamId, event.user);
    if (installation) await home(installation, true);
  }

  // Interactions

  async function interactions(request: Request): Promise<Response> {
    const raw = await signedBody(request);
    if (raw instanceof Response) return raw;
    let payload: {
      type?: unknown;
      team?: { id?: unknown } | null;
      user?: { id?: unknown; team_id?: unknown } | null;
      is_enterprise_install?: unknown;
      actions?: { action_id?: unknown }[];
    };
    try {
      payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "");
    } catch {
      return plain(400, "invalid_payload");
    }
    // Identity comes only from Slack's signed team and user fields, never from the button's value.
    const teamId = payload.team?.id;
    const userId = payload.user?.id;
    const userTeam = payload.user?.team_id;
    const valid =
      payload.type === "block_actions" &&
      payload.is_enterprise_install !== true &&
      typeof teamId === "string" &&
      TEAM_ID.test(teamId) &&
      typeof userId === "string" &&
      USER_ID.test(userId) &&
      (userTeam === undefined || userTeam === teamId);
    if (!valid || !payload.actions?.some((a) => a.action_id === DISCONNECT_ACTION)) return plain(200);

    // Local deletion first, so delivery stops even if Slack is slow or the revoke fails.
    const removed = await store.delete(teamId, userId);
    log("info", "installation_disconnected", { teamId, found: Boolean(removed) });
    if (removed) background("disconnect", () => afterDisconnect(removed));
    return plain(200);
  }

  async function afterDisconnect(removed: Installation): Promise<void> {
    // A quick reinstall can return the same user token; never revoke or overwrite a fresh installation.
    if (await store.get(removed.teamId, removed.userId)) return;
    try {
      await slack.revoke(removed.userToken);
    } catch (error) {
      log("warn", "revoke_failed", { error: classifySlackError(error).message });
    }
    // The bot token is shared by everyone in the workspace, so it is never revoked here.
    await home(removed, false);
  }

  async function route(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    switch (`${request.method} ${path}`) {
      case "GET /api/slack/install":
        return install(request);
      case "GET /api/slack/oauth/callback":
        return callback(request);
      case "POST /api/slack/events":
        return events(request);
      case "POST /api/slack/interactions":
        return interactions(request);
      default:
        return plain(404, "not_found");
    }
  }

  return async (request) => {
    try {
      return await route(request);
    } catch (error) {
      log("error", "request_failed", { path: new URL(request.url).pathname, error: (error as Error)?.name });
      return plain(500, "internal_error");
    }
  };
}
