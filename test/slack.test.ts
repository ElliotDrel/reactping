import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSlackApi, SlackCallError } from "../src/slack.ts";

Object.assign(process.env, { NODE_ENV: "test" }); // Next types NODE_ENV as read-only.

type Handler = (method: string, body: URLSearchParams) => Response;

/** Runs the real Slack WebClient against a fake fetch, so request shape, retries, and error mapping are covered. */
function api(handler: Handler) {
  const requests: { method: string; body: URLSearchParams; raw: string; auth: string | null }[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const method = new URL(String(input instanceof Request ? input.url : input)).pathname.replace("/api/", "");
    const raw = String(init?.body ?? "");
    const body = new URLSearchParams(raw);
    const auth = new Headers(init?.headers).get("authorization");
    requests.push({ method, body, raw, auth });
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

  it("publishes the Home view for one user with the bot token", async () => {
    const { slack, requests } = api(() => json({ ok: true }));
    await slack.publishHome("xoxb-1", "U1", { type: "home", blocks: [] });
    assert.equal(requests[0]!.method, "views.publish");
    assert.equal(requests[0]!.auth, "Bearer xoxb-1");
    assert.match(requests[0]!.raw, /U1/);
  });

  it("reads the reacted-to message's text and emoji totals with the user token via reactions.get", async () => {
    const message = { text: "hello", reactions: [{ name: "tada", count: 3, users: ["U1", "U2", "U3"] }] };
    const { slack, requests } = api(() => json({ ok: true, type: "message", message }));
    assert.deepEqual(await slack.reactedMessage("xoxp-1", "C1", "1.000100"), { text: "hello", counts: { tada: 3 } });
    assert.equal(requests[0]!.method, "reactions.get");
    assert.equal(requests[0]!.auth, "Bearer xoxp-1");
    assert.equal(requests[0]!.body.get("channel"), "C1");
    assert.equal(requests[0]!.body.get("timestamp"), "1.000100");
  });

  it("never retries: one request for rate limits, server errors, and network failures", async () => {
    for (const respond of [
      () => json({ ok: false, error: "ratelimited" }, { status: 429, headers: { "retry-after": "1" } }),
      () => new Response("oops", { status: 503 }),
      () => {
        throw new TypeError("fetch failed xoxb-should-not-appear");
      },
    ]) {
      const { slack, requests } = api(respond);
      const error = await rejection(slack.postMessage("xoxb-1", "U1", "hi"));
      assert.equal(requests.length, 1);
      assert.ok(!error.message.includes("xoxb"));
    }
  });

  it("maps auth errors to revoked and others to failed", async () => {
    const revoked = api(() => json({ ok: false, error: "token_revoked" }));
    assert.equal((await rejection(revoked.slack.postMessage("x", "U1", "hi"))).kind, "revoked");
    const other = api(() => json({ ok: false, error: "channel_not_found" }));
    const error = await rejection(other.slack.postMessage("x", "U1", "hi"));
    assert.deepEqual([error.kind, error.message], ["failed", "channel_not_found"]);
    const limited = api(() =>
      json({ ok: false, error: "ratelimited" }, { status: 429, headers: { "retry-after": "30" } }),
    );
    assert.equal((await rejection(limited.slack.postMessage("x", "U1", "hi"))).kind, "rate_limited");
  });

  it("parses oauth.v2.access identity, tokens, and both scope lists", async () => {
    const { slack, requests } = api(() =>
      json({
        ok: true,
        app_id: "A1",
        access_token: "xoxb-bot",
        token_type: "bot",
        scope: "chat:write",
        bot_user_id: "UBOT",
        team: { id: "T1", name: "Acme" },
        enterprise: null,
        is_enterprise_install: false,
        authed_user: { id: "U1", scope: "reactions:read", access_token: "xoxp-user", token_type: "user" },
      }),
    );
    const result = await slack.oauthAccess("code1", "https://example.com/api/slack/oauth/callback");
    assert.equal(requests[0]!.body.get("redirect_uri"), "https://example.com/api/slack/oauth/callback");
    assert.deepEqual(result, {
      appId: "A1",
      teamId: "T1",
      enterpriseId: null,
      isEnterpriseInstall: false,
      botToken: "xoxb-bot",
      botScopes: ["chat:write"],
      userId: "U1",
      userToken: "xoxp-user",
      userScopes: ["reactions:read"],
      userTokenType: "user",
    });
  });

  it("reads the workspace ID and URL from auth.test", async () => {
    const { slack } = api(() => json({ ok: true, team_id: "T1", url: "https://acme.slack.com/" }));
    assert.deepEqual(await slack.authTest("xoxb-1"), { teamId: "T1", url: "https://acme.slack.com/" });
  });

  it("answers response URLs through the injected fetch with the visibility and thread Slack needs", async () => {
    const url = "https://hooks.slack.com/actions/T1/1/abc";
    const { slack, requests } = api(() => new Response("ok"));
    await slack.respond(url, { text: "card" }, { visibility: "in_channel", threadTs: "1700000000.000100" });
    assert.deepEqual(JSON.parse(requests[0]!.raw), {
      text: "card",
      thread_ts: "1700000000.000100",
      response_type: "in_channel",
      replace_original: false,
    });
    const failed = api(() => new Response("channel_not_found", { status: 404 }));
    assert.equal(
      (await rejection(failed.slack.respond(url, { text: "x" }, { visibility: "ephemeral" }))).message,
      "channel_not_found",
    );
  });
});
