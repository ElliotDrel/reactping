import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, beforeEach } from "node:test";
import type { View } from "@slack/web-api";
import pg from "pg";
import type { Config } from "../src/config.ts";
import { hmac } from "../src/crypto.ts";
import { Store, type Installation } from "../src/db.ts";
import { createHandler, type Handler } from "../src/handler.ts";
import type { SlackMessage } from "../src/menu.ts";
import type { OAuthResult, ReactedMessage, SlackApi } from "../src/slack.ts";

Object.assign(process.env, { NODE_ENV: "test" }); // Next types NODE_ENV as read-only.

export const SIGNING_SECRET = "test-signing-secret";
export const SITE = "https://reactping.example.test";

/** Postgres-backed suites are skipped (visibly) without a disposable local database. */
export const dbSkip = process.env.TEST_DATABASE_URL
  ? false
  : "set TEST_DATABASE_URL (see README: npm run db:test:start) to run Postgres tests";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const SHIM = read("./supabase-shim.sql");
/** Applied in production order: original, additive Slack table, then post-deploy legacy cleanup. */
const MIGRATIONS = [
  read("../supabase/migrations/20261110000000_reactping.sql"),
  read("../supabase/migrations/20261113000000_reactping_slack_installations.sql"),
  read("../supabase/migrations/20261114000000_remove_account_backend.sql"),
  read("../supabase/migrations/20261117000000_reactping_activity.sql"),
  read("../supabase/migrations/20261117010000_reactping_feedback.sql"),
  read("../supabase/migrations/20261117020000_reactping_feedback_status.sql"),
  read("../supabase/migrations/20261119000000_reactping_reaction_outcomes.sql"),
  read("../supabase/migrations/20261119010000_reactping_outcome_reasons.sql"),
  read("../supabase/migrations/20261123000000_reactping_feedback_menu_source.sql"),
];

export class Clock {
  t = 1_800_000_000_000;
  now = () => this.t;
}

/**
 * Creates a fresh database for one test file (Supabase role shim + every migration), empties the installations
 * table before each test, and drops the database afterwards. Call inside `describe(..., { skip: dbSkip })`.
 */
export function useDatabase(): { pool: () => pg.Pool } {
  const name = `reactping_test_${randomBytes(6).toString("hex")}`;
  const adminUrl = process.env.TEST_DATABASE_URL!;
  const host = new URL(adminUrl).hostname;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host))
    throw new Error("TEST_DATABASE_URL must be a local database");
  let pool: pg.Pool;
  before(async () => {
    const admin = new pg.Client(adminUrl);
    await admin.connect();
    await admin.query(`create database ${name}`);
    await admin.end();
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: url.href, max: 10 });
    await pool.query(SHIM);
    for (const migration of MIGRATIONS) await pool.query(migration);
  });
  beforeEach(async () => {
    await pool.query(
      "truncate reactping_slack.installations, reactping_slack.activity, reactping_slack.feedback, reactping_slack.reaction_outcomes",
    );
    await pool.query("update reactping_slack.counters set value = 0");
  });
  after(async () => {
    await pool?.end();
    const admin = new pg.Client(adminUrl);
    await admin.connect();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  });
  return { pool: () => pool };
}

type Call = { method: string; args: unknown[] };

/** In-memory Slack API double. Override any method per test. */
export class FakeSlack implements SlackApi {
  calls: Call[] = [];
  oauthResults = new Map<string, OAuthResult>();
  workspaceUrl: string | null = "https://acme.slack.com/";

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  callsTo(method: string): Call[] {
    return this.calls.filter((c) => c.method === method);
  }

  async oauthAccess(code: string, redirectUri: string): Promise<OAuthResult> {
    this.record("oauthAccess", code, redirectUri);
    const result = this.oauthResults.get(code);
    if (!result) throw new Error("invalid_code");
    return result;
  }
  async authTest(botToken: string): Promise<{ teamId: string | null; url: string | null }> {
    this.record("authTest", botToken);
    return { teamId: /^xoxb-(T[A-Z0-9]+)/.exec(botToken)?.[1] ?? null, url: this.workspaceUrl };
  }
  async postMessage(
    botToken: string,
    channel: string,
    text: string,
    options?: { blocks?: SlackMessage["blocks"]; threadTs?: string },
  ): Promise<void> {
    this.record("postMessage", botToken, channel, text, ...(options ? [options] : []));
  }
  async postEphemeral(
    botToken: string,
    channel: string,
    user: string,
    message: SlackMessage,
    threadTs?: string,
  ): Promise<void> {
    this.record("postEphemeral", botToken, channel, user, message, threadTs);
  }
  async openView(botToken: string, triggerId: string, view: View): Promise<void> {
    this.record("openView", botToken, triggerId, view);
  }
  async respond(
    url: string,
    message: SlackMessage,
    options: { visibility: "ephemeral" | "in_channel"; threadTs?: string },
  ): Promise<void> {
    this.record("respond", url, message, options);
  }

  async publishHome(botToken: string, userId: string, view: View): Promise<void> {
    this.record("publishHome", botToken, userId, view);
  }
  async revoke(token: string): Promise<void> {
    this.record("revoke", token);
  }
  messageText: string | null = null;
  reactionCounts: Record<string, number> = {};
  async reactedMessage(userToken: string, channel: string, ts: string): Promise<ReactedMessage> {
    this.record("reactedMessage", userToken, channel, ts);
    return { text: this.messageText, counts: this.reactionCounts };
  }
}

export function oauthResult(teamId: string, userId: string, overrides: Partial<OAuthResult> = {}): OAuthResult {
  return {
    appId: "AREACTPING",
    teamId,
    enterpriseId: null,
    isEnterpriseInstall: false,
    botToken: `xoxb-${teamId}`,
    botScopes: ["chat:write", "app_mentions:read", "commands"],
    userId,
    userToken: `xoxp-${teamId}-${userId}`,
    userScopes: ["reactions:read"],
    userTokenType: "user",
    ...overrides,
  };
}

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    siteUrl: SITE,
    databaseUrl: "postgres://unused",
    slackClientId: "123.456",
    slackClientSecret: "client-secret",
    slackSigningSecret: SIGNING_SECRET,
    encryptionKey: randomBytes(32),
    selfReactionTeams: [],
    ...overrides,
  };
}

export interface TestApp {
  handler: Handler;
  store: Store;
  slack: FakeSlack;
  clock: Clock;
  config: Config;
  /** Messages posted to the operator alerts webhook. */
  alerts: string[];
  /** Cookie headers passed to the install analytics hook, one per completed install. */
  installs: (string | null)[];
  /** Work deferred past the response. It starts only in settle(), proving the response never waited for it. */
  pending: (() => Promise<unknown>)[];
  settle: () => Promise<void>;
}

export function startApp(pool: pg.Pool, overrides: Partial<Config> = {}): TestApp {
  const clock = new Clock();
  const store = new Store(pool, randomBytes(32), clock.now);
  const slack = new FakeSlack();
  const config = makeConfig(overrides);
  const pending: (() => Promise<unknown>)[] = [];
  const alerts: string[] = [];
  const installs: (string | null)[] = [];
  const handler = createHandler({
    config,
    store,
    slack,
    now: clock.now,
    background: (task) => {
      pending.push(task);
    },
    alert: async (text) => {
      alerts.push(text);
    },
    analytics: async (cookies) => {
      installs.push(cookies);
    },
  });
  return {
    handler,
    store,
    slack,
    clock,
    config,
    alerts,
    installs,
    pending,
    settle: async () => {
      // Drains work that background tasks queue themselves (an alert after a failed DM).
      while (pending.length) for (const task of pending.splice(0)) await task();
    },
  };
}

export function seed(app: TestApp, teamId: string, userId: string): Promise<Installation> {
  return app.store.upsert({
    teamId,
    userId,
    workspaceUrl: "https://acme.slack.com/",
    botToken: `xoxb-${teamId}`,
    userToken: `xoxp-${teamId}-${userId}`,
  });
}

/** A Slack-signed POST, as Slack would send it. */
export function signedPost(
  app: TestApp,
  path: string,
  body: string,
  options: { contentType?: string; secret?: string; timestamp?: number; headers?: Record<string, string> } = {},
): Promise<Response> {
  const ts = String(options.timestamp ?? Math.floor(app.clock.t / 1000));
  return app.handler(
    new Request(`${SITE}${path}`, {
      method: "POST",
      body,
      headers: {
        "content-type": options.contentType ?? "application/json",
        "x-slack-request-timestamp": ts,
        "x-slack-signature": `v0=${hmac(options.secret ?? SIGNING_SECRET, `v0:${ts}:${body}`, "hex")}`,
        ...options.headers,
      },
    }),
  );
}

export function signedEvent(app: TestApp, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return signedPost(app, "/api/slack/events", JSON.stringify(body), { headers });
}

export function signedAction(app: TestApp, payload: unknown): Promise<Response> {
  const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
  return signedPost(app, "/api/slack/interactions", body, { contentType: "application/x-www-form-urlencoded" });
}

export function eventEnvelope(teamId: string, event: Record<string, unknown>) {
  return { type: "event_callback", team_id: teamId, api_app_id: "AREACTPING", event_id: "Ev0001", event };
}

export function reactionEvent(
  teamId: string,
  overrides: { user?: string; item_user?: string; item?: object; reaction?: string } = {},
) {
  return eventEnvelope(teamId, {
    type: "reaction_added",
    user: overrides.user ?? "UREACTOR",
    reaction: overrides.reaction ?? "thumbsup",
    item_user: overrides.item_user ?? "UAUTHOR",
    item: overrides.item ?? { type: "message", channel: "C123ABC", ts: "1700000000.000100" },
    event_ts: "1700000001.000000",
  });
}

export function disconnectAction(teamId: string, userId: string, extra: Record<string, unknown> = {}) {
  return {
    type: "block_actions",
    team: { id: teamId, domain: "acme" },
    user: { id: userId, team_id: teamId },
    is_enterprise_install: false,
    actions: [{ action_id: "disconnect", type: "button", value: "" }],
    view: { type: "home" },
    ...extra,
  };
}

/** One browser: keeps the OAuth state cookie between the install redirect and the callback. */
export class Browser {
  readonly app: TestApp;
  cookie = "";

  constructor(app: TestApp) {
    this.app = app;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    const res = await this.app.handler(new Request(new URL(path, SITE), { ...init, headers }));
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = /Max-Age=0\b/.test(setCookie) ? "" : setCookie.split(";")[0]!;
    return res;
  }

  /** Starts Add to Slack and returns the state Slack would echo back. */
  async beginInstall(team?: string): Promise<string> {
    const res = await this.request(team ? `/api/slack/install?team=${team}` : "/api/slack/install");
    if (res.status !== 302) throw new Error(`install failed: ${res.status}`);
    return new URL(res.headers.get("location")!).searchParams.get("state")!;
  }

  callback(params: Record<string, string>): Promise<Response> {
    return this.request(`/api/slack/oauth/callback?${new URLSearchParams(params)}`);
  }

  async connect(teamId: string, userId: string, overrides: Partial<OAuthResult> = {}): Promise<Response> {
    const code = `code-${teamId}-${userId}`;
    this.app.slack.oauthResults.set(code, oauthResult(teamId, userId, overrides));
    return this.callback({ code, state: await this.beginInstall() });
  }
}
