import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Config } from "../src/config.ts";
import { hmacHex } from "../src/crypto.ts";
import { Store, type Installation } from "../src/db.ts";
import type { OAuthResult, SlackApi } from "../src/slack.ts";
import { createHandler } from "../src/web.ts";

process.env.NODE_ENV = "test";

export const SIGNING_SECRET = "test-signing-secret";

export function makeConfig(baseUrl: string): Config {
  return {
    baseUrl,
    port: 0,
    databasePath: ":memory:",
    slackClientId: "123.456",
    slackClientSecret: "client-secret",
    slackSigningSecret: SIGNING_SECRET,
    encryptionKey: randomBytes(32),
    retentionHours: 48,
  };
}

export class Clock {
  t = 1_800_000_000_000;
  now = () => this.t;
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

export function seedInstallation(store: Store, accountId: string, teamId: string, userId: string): Installation {
  const r = oauthResult(teamId, userId);
  return store.upsertInstallation(accountId, { ...r, teamUrl: "https://acme.slack.com/" });
}

export interface TestApp {
  baseUrl: string;
  store: Store;
  slack: FakeSlack;
  clock: Clock;
  config: Config;
  close: () => Promise<void>;
}

export async function startApp(): Promise<TestApp> {
  const slack = new FakeSlack();
  const clock = new Clock();
  let config = makeConfig("http://localhost");
  const store = new Store(":memory:", randomBytes(32), clock.now);
  let handler: ReturnType<typeof createHandler> = () => {};
  const server: Server = createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  config = { ...config, baseUrl };
  handler = createHandler({ config, store, slack, now: clock.now });
  return {
    baseUrl,
    store,
    slack,
    clock,
    config,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}

/** Minimal browser: keeps one session cookie and never follows redirects. */
export class Browser {
  cookie = "";
  private readonly app: TestApp;
  constructor(app: TestApp) {
    this.app = app;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(new URL(path, this.app.baseUrl), {
      ...init,
      redirect: "manual",
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(init.headers as Record<string, string>) },
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0]!;
    return res;
  }

  post(path: string, form: Record<string, string>, headers: Record<string, string> = {}): Promise<Response> {
    return this.request(path, {
      method: "POST",
      body: new URLSearchParams(form).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    });
  }

  async start(): Promise<void> {
    await this.post("/start", {});
  }

  async csrf(): Promise<string> {
    const body = await (await this.request("/settings")).text();
    return /name="csrf" value="([^"]+)"/.exec(body)![1]!;
  }

  /** Starts an install and returns the state Slack would echo back. */
  async beginInstall(): Promise<string> {
    const res = await this.post("/slack/install", { csrf: await this.csrf() });
    return new URL(res.headers.get("location")!).searchParams.get("state")!;
  }

  callback(params: Record<string, string>): Promise<Response> {
    return this.request(`/slack/oauth/callback?${new URLSearchParams(params)}`);
  }

  async connect(teamId: string, userId: string): Promise<void> {
    const code = `code-${teamId}-${userId}`;
    this.app.slack.oauthResults.set(code, oauthResult(teamId, userId));
    const res = await this.callback({ code, state: await this.beginInstall() });
    if (res.headers.get("location") !== "/settings?notice=connected") throw new Error("connect failed");
  }

  accountId(): string {
    const id = this.cookie.split("=")[1]!;
    return this.app.store.getSession(id)!.accountId;
  }
}

export function signedEvent(app: TestApp, body: unknown, opts: { secret?: string; timestamp?: number } = {}) {
  const raw = JSON.stringify(body);
  const ts = String(opts.timestamp ?? Math.floor(app.clock.t / 1000));
  return fetch(`${app.baseUrl}/slack/events`, {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": ts,
      "x-slack-signature": `v0=${hmacHex(opts.secret ?? SIGNING_SECRET, `v0:${ts}:${raw}`)}`,
    },
  });
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
