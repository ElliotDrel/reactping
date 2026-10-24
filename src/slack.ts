import { ErrorCode, LogLevel, WebClient, type Logger, type WebClientOptions } from "@slack/web-api";

export const BOT_SCOPES = ["chat:write"];
export const USER_SCOPES = ["reactions:read"];

export type SlackErrorKind = "rate_limited" | "revoked" | "permanent" | "transient";

/** A Slack failure reduced to a code that is safe to log and store (never a token or payload). */
export class SlackCallError extends Error {
  readonly kind: SlackErrorKind;
  readonly retryAfterSec?: number;

  constructor(kind: SlackErrorKind, code: string, retryAfterSec?: number) {
    super(code);
    this.kind = kind;
    this.retryAfterSec = retryAfterSec;
  }
}

export interface OAuthResult {
  teamId: string;
  teamName: string;
  isEnterpriseInstall: boolean;
  userId: string;
  userToken: string;
  userScopes: string[];
  botToken: string;
  botUserId: string | null;
}

export interface SlackApi {
  oauthAccess(code: string, redirectUri: string): Promise<OAuthResult>;
  teamUrl(botToken: string): Promise<string | null>;
  getPermalink(userToken: string, channel: string, messageTs: string): Promise<string>;
  postMessage(botToken: string, channel: string, text: string): Promise<void>;
  revoke(token: string): Promise<void>;
}

const REVOKED_ERRORS = new Set(["invalid_auth", "account_inactive", "token_revoked", "token_expired", "not_authed"]);
const TRANSIENT_ERRORS = new Set(["internal_error", "fatal_error", "service_unavailable", "request_timeout"]);

export function classifySlackError(error: unknown): SlackCallError {
  if (error instanceof SlackCallError) return error;
  const e = error as { code?: string; retryAfter?: number; statusCode?: number; data?: { error?: string } };
  switch (e?.code) {
    case ErrorCode.RateLimitedError:
      return new SlackCallError("rate_limited", "ratelimited", e.retryAfter);
    case ErrorCode.PlatformError: {
      const code = String(e.data?.error ?? "unknown_error").replace(/[^a-z0-9_]/gi, "");
      if (code === "ratelimited" || code === "rate_limited") return new SlackCallError("rate_limited", code);
      if (REVOKED_ERRORS.has(code)) return new SlackCallError("revoked", code);
      return new SlackCallError(TRANSIENT_ERRORS.has(code) ? "transient" : "permanent", code);
    }
    case ErrorCode.HTTPError:
      return new SlackCallError(
        Number(e.statusCode) >= 500 ? "transient" : "permanent",
        `http_${Number(e.statusCode)}`,
      );
    default:
      // Network failures and timeouts are ambiguous: Slack may or may not have acted on the request.
      return new SlackCallError("transient", "request_failed");
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

export function createSlackApi(options: {
  clientId: string;
  clientSecret: string;
  fetch?: WebClientOptions["fetch"];
}): SlackApi {
  // Retries are handled by the durable outbox, so the client fails fast and never logs payloads.
  const client = new WebClient(undefined, {
    logger: silentLogger,
    retryConfig: { retries: 0 },
    rejectRateLimitedCalls: true,
    timeout: 10_000,
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
      const team = res.team ?? res.enterprise;
      if (!res.access_token || !team?.id || !res.authed_user?.id || !res.authed_user.access_token) {
        throw new SlackCallError("permanent", "incomplete_oauth_response");
      }
      return {
        teamId: team.id,
        teamName: team.name ?? team.id,
        isEnterpriseInstall: Boolean(res.is_enterprise_install),
        userId: res.authed_user.id,
        userToken: res.authed_user.access_token,
        userScopes: (res.authed_user.scope ?? "").split(",").filter(Boolean),
        botToken: res.access_token,
        botUserId: res.bot_user_id ?? null,
      };
    },

    async teamUrl(botToken) {
      const res = await call(() => client.auth.test({ token: botToken }));
      return res.url ?? null;
    },

    async getPermalink(userToken, channel, messageTs) {
      const res = await call(() => client.chat.getPermalink({ token: userToken, channel, message_ts: messageTs }));
      if (!res.permalink) throw new SlackCallError("permanent", "missing_permalink");
      return res.permalink;
    },

    async postMessage(botToken, channel, text) {
      await call(() =>
        client.chat.postMessage({ token: botToken, channel, text, unfurl_links: false, unfurl_media: false }),
      );
    },

    async revoke(token) {
      await call(() => client.auth.revoke({ token }));
    },
  };
}
