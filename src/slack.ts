import { ErrorCode, LogLevel, WebClient, type Logger, type View, type WebClientOptions } from "@slack/web-api";

export const BOT_SCOPES = ["chat:write", "im:history"];
export const USER_SCOPES = ["reactions:read"];
export const SLACK_TIMEOUT_MS = 5_000;

export type SlackErrorKind = "rate_limited" | "revoked" | "failed";

/** A Slack failure reduced to a code that is safe to log (never a token or payload). */
export class SlackCallError extends Error {
  readonly kind: SlackErrorKind;

  constructor(kind: SlackErrorKind, code: string) {
    super(code);
    this.kind = kind;
  }
}

/** The fields of an oauth.v2.access response ReactPing uses, before any policy checks. */
export interface OAuthResult {
  appId: string | null;
  teamId: string | null;
  enterpriseId: string | null;
  isEnterpriseInstall: boolean;
  botToken: string | null;
  botScopes: string[];
  userId: string | null;
  userToken: string | null;
  userScopes: string[];
  userTokenType: string | null;
}

export interface SlackApi {
  oauthAccess(code: string, redirectUri: string): Promise<OAuthResult>;
  /** Workspace ID and URL that a bot token belongs to. */
  authTest(botToken: string): Promise<{ teamId: string | null; url: string | null }>;
  postMessage(botToken: string, channel: string, text: string): Promise<void>;
  publishHome(botToken: string, userId: string, view: View): Promise<void>;
  revoke(token: string): Promise<void>;
  /** Text of the reacted-to message (reactions.get with the author's user token), used only for the DM preview. */
  reactedMessageText(userToken: string, channel: string, ts: string): Promise<string | null>;
}

const REVOKED_ERRORS = new Set([
  "invalid_auth",
  "account_inactive",
  "token_revoked",
  "token_expired",
  "not_authed",
  "user_disabled",
]);

export function classifySlackError(error: unknown): SlackCallError {
  if (error instanceof SlackCallError) return error;
  const e = error as { code?: string; statusCode?: number; data?: { error?: string } };
  switch (e?.code) {
    case ErrorCode.RateLimitedError:
      return new SlackCallError("rate_limited", "ratelimited");
    case ErrorCode.PlatformError: {
      const code = String(e.data?.error ?? "unknown_error").replace(/[^a-z0-9_]/gi, "");
      if (code === "ratelimited" || code === "rate_limited") return new SlackCallError("rate_limited", code);
      return new SlackCallError(REVOKED_ERRORS.has(code) ? "revoked" : "failed", code);
    }
    case ErrorCode.HTTPError:
      return new SlackCallError(e.statusCode === 429 ? "rate_limited" : "failed", `http_${Number(e.statusCode)}`);
    default:
      // Network failures and timeouts: Slack may or may not have acted. Never retried.
      return new SlackCallError("failed", "request_failed");
  }
}

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  setLevel: () => {},
  getLevel: () => LogLevel.ERROR,
  setName: () => {},
};

const scopes = (value: unknown): string[] =>
  typeof value === "string"
    ? value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

export function createSlackApi(options: {
  clientId: string;
  clientSecret: string;
  fetch?: WebClientOptions["fetch"];
}): SlackApi {
  // Best effort by design: no retries, fail fast, and never log request or response payloads.
  const client = new WebClient(undefined, {
    logger: silentLogger,
    retryConfig: { retries: 0 },
    rejectRateLimitedCalls: true,
    timeout: SLACK_TIMEOUT_MS,
    fetch: options.fetch,
  });

  async function call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw classifySlackError(error);
    }
  }

  return {
    async oauthAccess(code, redirectUri) {
      const res = await call(() =>
        client.oauth.v2.access({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      );
      return {
        appId: text(res.app_id),
        teamId: text(res.team?.id),
        enterpriseId: text(res.enterprise?.id),
        isEnterpriseInstall: res.is_enterprise_install === true,
        botToken: res.token_type === "bot" ? text(res.access_token) : null,
        botScopes: scopes(res.scope),
        userId: text(res.authed_user?.id),
        userToken: text(res.authed_user?.access_token),
        userScopes: scopes(res.authed_user?.scope),
        userTokenType: text(res.authed_user?.token_type),
      };
    },

    async authTest(botToken) {
      const res = await call(() => client.auth.test({ token: botToken }));
      return { teamId: text(res.team_id), url: text(res.url) };
    },

    async postMessage(botToken, channel, message) {
      await call(() =>
        client.chat.postMessage({ token: botToken, channel, text: message, unfurl_links: false, unfurl_media: false }),
      );
    },

    async publishHome(botToken, userId, view) {
      await call(() => client.views.publish({ token: botToken, user_id: userId, view }));
    },

    async revoke(token) {
      await call(() => client.auth.revoke({ token }));
    },

    async reactedMessageText(userToken, channel, ts) {
      const res = await call(() => client.reactions.get({ token: userToken, channel, timestamp: ts }));
      return text(res.message?.text);
    },
  };
}
