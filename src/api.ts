import type { AuthUser, VerifyUser } from "./auth.ts";
import { RETENTION_HOURS, type Config } from "./config.ts";
import { randomToken, safeEqual } from "./crypto.ts";
import type { Installation, Store } from "./db.ts";
import { DeliveryWorker, escapeMrkdwn } from "./delivery.ts";
import { handleEventCallback, verifySlackSignature } from "./events.ts";
import { log } from "./log.ts";
import { CRON_DRAIN_BUDGET_MS, EVENT_DRAIN_BUDGET_MS } from "./runtime.ts";
import { BOT_SCOPES, classifySlackError, USER_SCOPES, type SlackApi } from "./slack.ts";

export interface ApiDeps {
  config: Config;
  store: Store;
  slack: SlackApi;
  verifyUser: VerifyUser;
  /** Runs work after the response is sent (Vercel waitUntil). */
  background: (task: () => Promise<unknown>) => void;
  now?: () => number;
}

export type Handler = (request: Request) => Promise<Response>;

/** Callback outcomes shown on /app. Kept in sync with the messages in site/app.ts. */
export type ConnectOutcome =
  | "connected"
  | "denied"
  | "expired"
  | "oauth_failed"
  | "enterprise_unsupported"
  | "missing_scope"
  | "installs_disabled";

const TEST_DM_INTERVAL_MS = 60_000;
const JSON_LIMIT = 16 * 1024;
const OAUTH_COOKIE_MAX_AGE = 600;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

const NO_STORE = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

function redirect(location: string, cookie?: string): Response {
  return new Response(null, {
    status: 303,
    headers: { ...NO_STORE, location, ...(cookie ? { "set-cookie": cookie } : {}) },
  });
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > JSON_LIMIT) throw new HttpError(413, "too_large");
  if (!text) return {};
  try {
    const body: unknown = JSON.parse(text);
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError(400, "invalid_json");
}

/** The whole API behind /api/*. With `deps` null (missing configuration) it fails closed. */
export function createApi(deps: ApiDeps | null): Handler {
  if (!deps) {
    return async (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/api/health") return json(200, { ok: true, ready: false });
      return json(503, { error: "not_configured" });
    };
  }
  const { config, store, slack, verifyUser } = deps;
  const now = deps.now ?? Date.now;
  const worker = new DeliveryWorker(store, slack, now);
  const secureCookie = config.siteUrl.startsWith("https://");
  // __Host- forbids Domain and requires Secure + Path=/, so subdomains cannot plant or read it.
  const oauthCookieName = secureCookie ? "__Host-reactping_oauth" : "reactping_oauth";
  const redirectUri = `${config.siteUrl}/api/slack/oauth/callback`;

  function oauthCookie(value: string, maxAge: number): string {
    return `${oauthCookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie ? "; Secure" : ""}`;
  }

  function background(task: () => Promise<unknown>): void {
    deps!.background(() =>
      task().catch((error: unknown) => log("error", "background_failed", { error: (error as Error)?.name })),
    );
  }

  async function authenticate(request: Request): Promise<AuthUser> {
    const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
    const user = match ? await verifyUser(match[1]!) : null;
    if (!user) throw new HttpError(401, "unauthorized");
    try {
      await store.ensureAccount(user.id);
    } catch (error) {
      // A still-unexpired token for a deleted auth user: foreign key violation.
      if ((error as { code?: string }).code === "23503") throw new HttpError(401, "unauthorized");
      throw error;
    }
    return user;
  }

  async function ownedInstallation(accountId: string, id: unknown): Promise<Installation> {
    const installation = typeof id === "string" ? await store.getInstallation(id) : undefined;
    if (!installation || installation.accountId !== accountId) throw new HttpError(404, "not_found");
    return installation;
  }

  async function revokeQuietly(token: string | null): Promise<boolean> {
    if (!token) return true;
    try {
      await slack.revoke(token);
      return true;
    } catch (error) {
      const failure = classifySlackError(error);
      log("warn", "revoke_failed", { error: failure.message });
      // An already-invalid token is as good as revoked.
      return failure.kind === "revoked";
    }
  }

  /** Revokes the user's token and, if nobody else in the workspace still uses it, the bot token. */
  async function disconnect(installation: Installation): Promise<boolean> {
    // Disable local collection/delivery immediately, even if Slack is slow or unavailable.
    await store.deleteInstallation(installation.id);
    const revokeBot = (await store.countActiveInTeam(installation.teamId, installation.id)) === 0;
    const [userOk, botOk] = await Promise.all([
      revokeQuietly(installation.userToken),
      revokeBot ? installation.botToken !== null && revokeQuietly(installation.botToken) : true,
    ]);
    return userOk && botOk;
  }

  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (`${request.method} ${url.pathname}`) {
      case "GET /api/health":
        try {
          await store.ping();
        } catch {
          return json(503, { ok: false, ready: false });
        }
        return json(200, {
          ok: true,
          ready: true,
          installsEnabled: config.installsEnabled,
          testingMode: config.includeSelfReactions,
        });

      case "POST /api/slack/events":
        return slackEvent(request);

      case "GET /api/slack/oauth/callback":
        return oauthCallback(request, url);

      case "POST /api/internal/deliver": {
        // Independent of user auth: only the cron secret is accepted, never a Supabase session.
        const match = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "");
        if (!match || !safeEqual(match[1]!, config.deliveryCronSecret)) throw new HttpError(401, "unauthorized");
        await store.purgeExpired(RETENTION_HOURS * 60 * 60 * 1000);
        return json(200, { processed: await worker.drain(50, CRON_DRAIN_BUDGET_MS) });
      }

      case "GET /api/me": {
        const user = await authenticate(request);
        const account = (await store.getAccount(user.id))!;
        const installations = await store.listInstallations(user.id);
        const destination = installations.find(
          (i) => i.id === account.destinationInstallationId && i.status === "active",
        );
        const crossesWorkspaces =
          destination && installations.some((i) => i.status === "active" && i.teamId !== destination.teamId);
        const effectiveDestination =
          destination && (!crossesWorkspaces || account.crossWorkspaceConsentAt) ? destination.id : "same";
        return json(200, {
          email: user.email,
          installsEnabled: config.installsEnabled,
          testingMode: config.includeSelfReactions,
          retentionHours: RETENTION_HOURS,
          destination: effectiveDestination,
          crossWorkspaceConsent: effectiveDestination !== "same" && account.crossWorkspaceConsentAt !== null,
          installations: installations.map((i) => ({
            id: i.id,
            teamId: i.teamId,
            teamName: i.teamName,
            slackUserId: i.userId,
            status: i.status,
          })),
        });
      }

      case "POST /api/slack/install": {
        const user = await authenticate(request);
        if (!config.installsEnabled) throw new HttpError(503, "installs_disabled");
        // The binding cookie is host-only, so the flow must start on the host Slack redirects back to.
        if (request.headers.get("origin") !== config.siteUrl) throw new HttpError(400, "wrong_origin");
        const nonce = randomToken();
        const browserSecret = randomToken();
        await store.createOAuthState(user.id, nonce, browserSecret);
        const authorize = new URL("https://slack.com/oauth/v2/authorize");
        authorize.searchParams.set("client_id", config.slackClientId);
        authorize.searchParams.set("scope", BOT_SCOPES.join(","));
        authorize.searchParams.set("user_scope", USER_SCOPES.join(","));
        authorize.searchParams.set("redirect_uri", redirectUri);
        authorize.searchParams.set("state", nonce);
        return json(200, { url: authorize.href }, { "set-cookie": oauthCookie(browserSecret, OAUTH_COOKIE_MAX_AGE) });
      }

      case "POST /api/destination": {
        const user = await authenticate(request);
        const body = await readJson(request);
        const choice = body.destination ?? "same";
        if (choice === "same") {
          await store.setDestination(user.id, null, false);
          return json(200, { ok: true });
        }
        const dest = await ownedInstallation(user.id, choice).catch(() => {
          throw new HttpError(400, "unknown_destination");
        });
        if (dest.status !== "active") throw new HttpError(400, "unknown_destination");
        const crossWorkspace = (await store.listInstallations(user.id)).some((i) => i.teamId !== dest.teamId);
        const consent = body.crossWorkspaceConsent === true;
        if (crossWorkspace && !consent) throw new HttpError(400, "consent_required");
        await store.setDestination(user.id, dest.id, crossWorkspace && consent);
        return json(200, { ok: true });
      }

      case "POST /api/installations/test": {
        const user = await authenticate(request);
        const installation = await ownedInstallation(user.id, (await readJson(request)).installation);
        if (installation.status !== "active" || !installation.botToken) throw new HttpError(409, "revoked");
        if (!(await store.markTested(installation.id, TEST_DM_INTERVAL_MS))) throw new HttpError(429, "too_many_tests");
        try {
          await slack.postMessage(
            installation.botToken,
            installation.userId,
            `ReactPing connection test for *${escapeMrkdwn(installation.teamName)}*. This only confirms that ReactPing can DM you here. It is not a reaction notification.`,
          );
        } catch (error) {
          const failure = classifySlackError(error);
          if (failure.kind === "revoked") {
            await store.markRevoked({ id: installation.id }, "bot");
            throw new HttpError(409, "revoked");
          }
          throw new HttpError(failure.kind === "rate_limited" ? 429 : 502, "slack_error");
        }
        return json(200, { ok: true });
      }

      case "POST /api/installations/disconnect": {
        const user = await authenticate(request);
        const installation = await ownedInstallation(user.id, (await readJson(request)).installation);
        return json(200, { revoked: await disconnect(installation) });
      }

      case "POST /api/account/delete": {
        const user = await authenticate(request);
        if ((await readJson(request)).confirm !== "delete") throw new HttpError(400, "confirmation_required");
        const installations = await store.listInstallations(user.id);
        await store.deleteAccount(user.id);
        let authUserDeleted = true;
        try {
          await store.deleteAuthUser(user.id);
        } catch (error) {
          authUserDeleted = false;
          log("error", "auth_user_delete_failed", { error: (error as Error)?.name });
        }
        // Remove the login before remote work: a slow Slack revoke must not prevent identity deletion.
        const outcomes = await Promise.allSettled(installations.map(disconnect));
        const revoked = outcomes.every((outcome) => outcome.status === "fulfilled" && outcome.value);
        return json(200, { deleted: true, revoked, authUserDeleted });
      }

      default:
        throw new HttpError(404, "not_found");
    }
  }

  async function oauthCallback(request: Request, url: URL): Promise<Response> {
    const done = (outcome: ConnectOutcome) => redirect(`/app?slack=${outcome}`, oauthCookie("", 0));
    const nonce = url.searchParams.get("state");
    const browserSecret = readCookie(request, oauthCookieName);
    // Wrong browser, expired, replayed, or forged state all look the same: nothing to consume.
    const accountId = nonce && browserSecret ? await store.consumeOAuthState(nonce, browserSecret) : undefined;
    if (!accountId) return done("expired");
    if (url.searchParams.get("error"))
      return done(url.searchParams.get("error") === "access_denied" ? "denied" : "oauth_failed");
    if (!config.installsEnabled) return done("installs_disabled");
    const code = url.searchParams.get("code");
    if (!code) return done("oauth_failed");

    let result;
    try {
      result = await slack.oauthAccess(code, redirectUri);
    } catch (error) {
      log("warn", "oauth_exchange_failed", { error: classifySlackError(error).message });
      return done("oauth_failed");
    }
    if (result.isEnterpriseInstall || !result.userScopes.includes("reactions:read")) {
      await revokeQuietly(result.userToken);
      if ((await store.countActiveInTeam(result.teamId, null)) === 0) await revokeQuietly(result.botToken);
      return done(result.isEnterpriseInstall ? "enterprise_unsupported" : "missing_scope");
    }
    let teamUrl: string | null = null;
    try {
      teamUrl = await slack.teamUrl(result.botToken);
    } catch (error) {
      log("info", "team_url_unavailable", { error: classifySlackError(error).message });
    }
    await store.upsertInstallation(accountId, {
      teamId: result.teamId,
      teamName: result.teamName,
      teamUrl,
      userId: result.userId,
      botUserId: result.botUserId,
      userToken: result.userToken,
      botToken: result.botToken,
    });
    log("info", "installation_connected", { teamId: result.teamId });
    return done("connected");
  }

  async function slackEvent(request: Request): Promise<Response> {
    const raw = await request.text();
    const verified = verifySlackSignature(
      config.slackSigningSecret,
      raw,
      request.headers.get("x-slack-request-timestamp") ?? undefined,
      request.headers.get("x-slack-signature") ?? undefined,
      now(),
    );
    if (!verified) throw new HttpError(401, "invalid_signature");
    let body: { type?: string; challenge?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "invalid_json");
    }
    if (body.type === "url_verification" && typeof body.challenge === "string") {
      return new Response(body.challenge, { headers: { ...NO_STORE, "content-type": "text/plain; charset=utf-8" } });
    }
    if (body.type === "event_callback") {
      // Committed to Postgres before the 200, so a failure before this point makes Slack retry.
      const outcome = await handleEventCallback(
        store,
        body as Parameters<typeof handleEventCallback>[1],
        config.includeSelfReactions,
      );
      log("info", "event_processed", { outcome });
      // Try right away; the every-minute cron call recovers anything this misses.
      if (outcome === "enqueued") background(() => worker.drain(5, EVENT_DRAIN_BUDGET_MS));
    }
    return new Response("", { headers: NO_STORE });
  }

  return async (request) => {
    try {
      return await route(request);
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { error: error.message });
      log("error", "request_failed", { path: new URL(request.url).pathname, error: (error as Error)?.name });
      return json(500, { error: "internal_error" });
    }
  };
}
