import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSlackApi, SlackCallError } from "../src/slack.ts";

process.env.NODE_ENV = "test";

type Handler = (method: string, body: URLSearchParams) => Response;

/** Runs the real Slack WebClient against a fake fetch, so request shape and error mapping are covered. */
function api(handler: Handler) {
  const requests: { method: string; body: URLSearchParams; auth: string | null }[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const method = new URL(String(input instanceof Request ? input.url : input)).pathname.replace("/api/", "");
    const body = new URLSearchParams(String(init?.body ?? ""));
    const auth = new Headers(init?.headers).get("authorization");
    requests.push({ method, body, auth });
    return handler(method, body);
  }) as typeof fetch;
  return { slack: createSlackApi({ clientId: "id", clientSecret: "secret", fetch: fakeFetch }), requests };
}

const json = (body: object, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

async function rejection(promise: Promise<unknown>): Promise<SlackCallError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof SlackCallError);
    return error;
  }
  throw new Error("expected rejection");
}

describe("Slack client adapter", () => {
  it("posts DMs with link and media unfurls disabled", async () => {
    const { slack, requests } = api(() => json({ ok: true, ts: "1.2", channel: "D1" }));
    await slack.postMessage("xoxb-1", "U1", "hello");
    const [req] = requests;
    assert.equal(req!.method, "chat.postMessage");
    assert.equal(req!.auth, "Bearer xoxb-1");
    assert.equal(req!.body.get("channel"), "U1");
    assert.equal(req!.body.get("unfurl_links"), "false");
    assert.equal(req!.body.get("unfurl_media"), "false");
  });

  it("maps HTTP 429 with Retry-After to rate_limited", async () => {
    const { slack } = api(() =>
      json({ ok: false, error: "ratelimited" }, { status: 429, headers: { "retry-after": "12" } }),
    );
    const error = await rejection(slack.postMessage("xoxb-1", "U1", "hi"));
    assert.equal(error.kind, "rate_limited");
    assert.equal(error.retryAfterSec, 12);
  });

  it("maps auth errors to revoked and others to permanent", async () => {
    const revoked = api(() => json({ ok: false, error: "token_revoked" }));
    assert.equal((await rejection(revoked.slack.postMessage("x", "U1", "hi"))).kind, "revoked");
    const permanent = api(() => json({ ok: false, error: "channel_not_found" }));
    const error = await rejection(permanent.slack.postMessage("x", "U1", "hi"));
    assert.deepEqual([error.kind, error.message], ["permanent", "channel_not_found"]);
  });

  it("treats network failures and 5xx as transient without leaking details", async () => {
    const network = api(() => {
      throw new TypeError("fetch failed xoxb-should-not-appear");
    });
    const error = await rejection(network.slack.postMessage("xoxb-1", "U1", "hi"));
    assert.deepEqual([error.kind, error.message], ["transient", "request_failed"]);
    const server = api(() => new Response("oops", { status: 503 }));
    assert.equal((await rejection(server.slack.postMessage("x", "U1", "hi"))).kind, "transient");
  });

  it("parses oauth.v2.access user and bot grants", async () => {
    const { slack, requests } = api(() =>
      json({
        ok: true,
        access_token: "xoxb-bot",
        bot_user_id: "UBOT",
        team: { id: "T1", name: "Acme" },
        is_enterprise_install: false,
        authed_user: { id: "U1", scope: "reactions:read", access_token: "xoxp-user", token_type: "user" },
      }),
    );
    const result = await slack.oauthAccess("code1", "https://example.com/slack/oauth/callback");
    assert.equal(requests[0]!.body.get("redirect_uri"), "https://example.com/slack/oauth/callback");
    assert.deepEqual(
      [result.teamId, result.userId, result.userToken, result.botToken, result.userScopes],
      ["T1", "U1", "xoxp-user", "xoxb-bot", ["reactions:read"]],
    );
  });
});
