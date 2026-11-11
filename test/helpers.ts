import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, beforeEach } from "node:test";
import pg from "pg";
import { createApi, type Handler } from "../src/api.ts";
import type { AuthUser } from "../src/auth.ts";
import type { Config } from "../src/config.ts";
import { hmacHex } from "../src/crypto.ts";
import { Store, type Installation } from "../src/db.ts";
import type { OAuthResult, SlackApi } from "../src/slack.ts";

process.env.NODE_ENV = "test";

export const SIGNING_SECRET = "test-signing-secret";
export const CRON_SECRET = "test-cron-secret-that-is-at-least-32-chars";

/** Postgres-backed suites are skipped (visibly) without a disposable database. */
export const dbSkip = process.env.TEST_DATABASE_URL
  ? false
  : "set TEST_DATABASE_URL (see README: npm run db:test:start) to run Postgres tests";

const MIGRATION = readFileSync(new URL("../supabase/migrations/20261110000000_reactping.sql", import.meta.url), "utf8");
const SHIM = readFileSync(new URL("./supabase-shim.sql", import.meta.url), "utf8");

export class Clock {
  t = 1_800_000_000_000;
  now = () => this.t;
}

/**
 * Creates a fresh database for one test file (Supabase shim + the real migration), truncates it before
 * each test, and drops it afterwards. Call inside a `describe(..., { skip: dbSkip })`.
 */
export function useDatabase(): { pool: () => pg.Pool } {
  const name = `reactping_test_${randomBytes(6).toString("hex")}`;
  const adminUrl = process.env.TEST_DATABASE_URL!;
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
    await pool.query(MIGRATION);
  });
  beforeEach(async () => {
    await pool.query(
      `truncate reactping.deliveries, reactping.oauth_states, reactping.installations, reactping.accounts, auth.users
       restart identity cascade;
       update reactping.delivery_control set paused_until = '-infinity'`,
    );
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

export function makeStore(pool: pg.Pool, clock: Clock, key = randomBytes(32)): Store {
  return new Store(pool, key, clock.now);
}

/** Inserts a Supabase Auth user and its ReactPing account. */
export async function createAccount(store: Store, email = `${randomUUID()}@example.test`): Promise<string> {
  const id = randomUUID();
  await store.pool.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  await store.ensureAccount(id);
  return id;
}

type Call = { method: string; args: unknown[] };

/** In-memory Slack API double. Override any method per test. */
export class FakeSlack implements SlackApi {
  calls: Call[] = [];
  oauthResults = new Map<string, OAuthResult>();

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
  async teamUrl(botToken: string): Promise<string | null> {
    this.record("teamUrl", botToken);
    return "https://acme.slack.com/";
  }
  async getPermalink(userToken: string, channel: string, messageTs: string): Promise<string> {
    this.record("getPermalink", userToken, channel, messageTs);
    return `https://acme.slack.com/archives/${channel}/p${messageTs.replace(".", "")}`;
  }
  async postMessage(botToken: string, channel: string, text: string): Promise<void> {
    this.record("postMessage", botToken, channel, text);
  }
  async revoke(token: string): Promise<void> {
    this.record("revoke", token);
  }
}

export function oauthResult(teamId: string, userId: string, overrides: Partial<OAuthResult> = {}): OAuthResult {
  return {
    teamId,
    teamName: `Team ${teamId}`,
    isEnterpriseInstall: false,
    userId,
    userToken: `xoxp-${teamId}-${userId}`,
    userScopes: ["reactions:read"],
    botToken: `xoxb-${teamId}`,
    botUserId: `B${teamId}`,
    ...overrides,
  };
}

export function seedInstallation(
  store: Store,
  accountId: string,
  teamId: string,
  userId: string,
): Promise<Installation> {
  const r = oauthResult(teamId, userId);
  return store.upsertInstallation(accountId, { ...r, teamUrl: "https://acme.slack.com/" });
}

export function makeConfig(siteUrl = "http://localhost:3000"): Config {
  return {
    siteUrl,
    databaseUrl: "postgres://unused",
    supabaseUrl: "https://project.supabase.test",
    supabasePublishableKey: "sb_publishable_test",
    slackClientId: "123.456",
    slackClientSecret: "client-secret",
    slackSigningSecret: SIGNING_SECRET,
    encryptionKey: randomBytes(32),
    deliveryCronSecret: CRON_SECRET,
    installsEnabled: true,
    includeSelfReactions: false,
  };
}

export interface TestApp {
  api: Handler;
  store: Store;
  slack: FakeSlack;
  clock: Clock;
  config: Config;
  /** Access token -> Supabase user, standing in for Supabase Auth. */
  sessions: Map<string, AuthUser>;
  /** Work handed to waitUntil; run it with settle(). */
  background: (() => Promise<unknown>)[];
  settle: () => Promise<void>;
}

export function startApp(pool: pg.Pool, siteUrl?: string): TestApp {
  const clock = new Clock();
  const store = makeStore(pool, clock);
  const slack = new FakeSlack();
  const config = makeConfig(siteUrl);
  const sessions = new Map<string, AuthUser>();
  const background: (() => Promise<unknown>)[] = [];
  const api = createApi({
    config,
    store,
    slack,
    now: clock.now,
    verifyUser: async (token) => sessions.get(token) ?? null,
    background: (task) => background.push(task),
  });
  return {
    api,
    store,
    slack,
    clock,
    config,
    sessions,
    background,
    settle: async () => {
      for (const task of background.splice(0)) await task();
    },
  };
}

/** One browser with one signed-in Supabase user. Keeps the OAuth binding cookie like a real browser. */
export class Browser {
  readonly app: TestApp;
  token = "";
  accountId = "";
  cookie = "";

  constructor(app: TestApp) {
    this.app = app;
  }

  static async signIn(app: TestApp): Promise<Browser> {
    const browser = new Browser(app);
    browser.accountId = randomUUID();
    browser.token = `token-${browser.accountId}`;
    await app.store.pool.query("insert into auth.users (id, email) values ($1, $2)", [
      browser.accountId,
      `${browser.accountId}@example.test`,
    ]);
    app.sessions.set(browser.token, { id: browser.accountId, email: `${browser.accountId}@example.test` });
    return browser;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.token && !headers.has("authorization")) headers.set("authorization", `Bearer ${this.token}`);
    if (this.cookie) headers.set("cookie", this.cookie);
    if (!headers.has("origin")) headers.set("origin", this.app.config.siteUrl);
    const res = await this.app.api(new Request(new URL(path, this.app.config.siteUrl), { ...init, headers }));
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = /Max-Age=0\b/.test(setCookie) ? "" : setCookie.split(";")[0]!;
    return res;
  }

  post(path: string, body: unknown = {}, headers: Record<string, string> = {}): Promise<Response> {
    return this.request(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
    });
  }

  async json<T = Record<string, unknown>>(path: string): Promise<T> {
    return (await (await this.request(path)).json()) as T;
  }

  /** Starts an install and returns the state Slack would echo back. */
  async beginInstall(): Promise<string> {
    const res = await this.post("/api/slack/install");
    if (res.status !== 200) throw new Error(`install failed: ${res.status}`);
    const { url } = (await res.json()) as { url: string };
    return new URL(url).searchParams.get("state")!;
  }

  callback(params: Record<string, string>): Promise<Response> {
    return this.request(`/api/slack/oauth/callback?${new URLSearchParams(params)}`, {
      headers: { authorization: "" },
    });
  }

  async connect(teamId: string, userId: string): Promise<void> {
    const code = `code-${teamId}-${userId}`;
    this.app.slack.oauthResults.set(code, oauthResult(teamId, userId));
    const res = await this.callback({ code, state: await this.beginInstall() });
    if (res.headers.get("location") !== "/app?slack=connected") throw new Error("connect failed");
  }
}

export function signedEvent(app: TestApp, body: unknown, opts: { secret?: string; timestamp?: number } = {}) {
  const raw = JSON.stringify(body);
  const ts = String(opts.timestamp ?? Math.floor(app.clock.t / 1000));
  return app.api(
    new Request(`${app.config.siteUrl}/api/slack/events`, {
      method: "POST",
      body: raw,
      headers: {
        "content-type": "application/json",
        "x-slack-request-timestamp": ts,
        "x-slack-signature": `v0=${hmacHex(opts.secret ?? SIGNING_SECRET, `v0:${ts}:${raw}`)}`,
      },
    }),
  );
}

let eventCounter = 0;
export function reactionEvent(
  teamId: string,
  overrides: { user?: string; item_user?: string; item?: object; event_id?: string; reaction?: string } = {},
) {
  return {
    type: "event_callback",
    team_id: teamId,
    api_app_id: "A123",
    event_id: overrides.event_id ?? `Ev${String(++eventCounter).padStart(6, "0")}`,
    event_time: 1,
    authorizations: [{ team_id: teamId, user_id: "UOTHERVIEWER", is_bot: false }],
    event: {
      type: "reaction_added",
      user: overrides.user ?? "UREACTOR",
      reaction: overrides.reaction ?? "thumbsup",
      item_user: overrides.item_user ?? "UAUTHOR",
      item: overrides.item ?? { type: "message", channel: "C123ABC", ts: "1700000000.000100" },
      event_ts: "1700000001.000000",
    },
  };
}
