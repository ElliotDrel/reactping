import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { decrypt, deriveKey, encrypt, hmac } from "../src/crypto.ts";
import { MAX_BODY_BYTES, readBody, verifySlackSignature } from "../src/handler.ts";
import { escapeMrkdwn, homeView, messageLink, parseWorkspaceUrl, reactionNotification } from "../src/messages.ts";
import { createOAuthState, OAUTH_STATE_TTL_SECONDS, verifyOAuthState } from "../src/oauth-state.ts";

process.env.NODE_ENV = "test";

const NOW = 1_800_000_000_000;

describe("Slack request signatures", () => {
  const secret = "signing-secret";
  const body = '{"type":"event_callback"}';
  const ts = String(NOW / 1000);
  const sign = (b = body, t = ts, s = secret) => `v0=${hmac(s, `v0:${t}:${b}`, "hex")}`;

  it("accepts Slack's v0 signature over the exact raw body", () => {
    assert.equal(verifySlackSignature(secret, body, ts, sign(), NOW), true);
  });

  it("rejects tampered bodies, wrong secrets, and missing or malformed headers", () => {
    assert.equal(verifySlackSignature(secret, `${body} `, ts, sign(), NOW), false);
    assert.equal(verifySlackSignature(secret, body, ts, sign(body, ts, "other"), NOW), false);
    assert.equal(verifySlackSignature(secret, body, null, sign(), NOW), false);
    assert.equal(verifySlackSignature(secret, body, ts, null, NOW), false);
    assert.equal(verifySlackSignature(secret, body, "1e9", sign(body, "1e9"), NOW), false);
  });

  it("rejects timestamps outside five minutes either way (replays)", () => {
    for (const offset of [-301, 301]) {
      const t = String(NOW / 1000 + offset);
      assert.equal(verifySlackSignature(secret, body, t, sign(body, t), NOW), false);
    }
    const edge = String(NOW / 1000 - 300);
    assert.equal(verifySlackSignature(secret, body, edge, sign(body, edge), NOW), true);
  });
});

describe("OAuth state cookie", () => {
  const key = deriveKey(randomBytes(32), "oauth-state");

  it("accepts the matching state from the same browser before expiry", () => {
    const { state, cookie } = createOAuthState(key, NOW);
    assert.equal(verifyOAuthState(key, cookie, state, NOW + 1000), true);
  });

  it("rejects another browser's cookie, a missing cookie, and a missing state", () => {
    const mine = createOAuthState(key, NOW);
    const theirs = createOAuthState(key, NOW);
    assert.equal(verifyOAuthState(key, theirs.cookie, mine.state, NOW), false);
    assert.equal(verifyOAuthState(key, undefined, mine.state, NOW), false);
    assert.equal(verifyOAuthState(key, mine.cookie, null, NOW), false);
  });

  it("rejects expired or tampered cookies and cookies signed with another key", () => {
    const { state, cookie } = createOAuthState(key, NOW);
    assert.equal(verifyOAuthState(key, cookie, state, NOW + OAUTH_STATE_TTL_SECONDS * 1000), false);
    const [v, nonce, expires, mac] = cookie.split(".");
    const extended = `${v}.${nonce}.${Number(expires) + 3600}.${mac}`;
    assert.equal(verifyOAuthState(key, extended, state, NOW), false);
    const flipped = `${v}.${nonce}.${expires}.${mac!.slice(0, -1)}${mac!.endsWith("A") ? "B" : "A"}`;
    assert.equal(verifyOAuthState(key, flipped, state, NOW), false);
    assert.equal(verifyOAuthState(deriveKey(randomBytes(32), "oauth-state"), cookie, state, NOW), false);
  });

  it("uses a key separate from token encryption", () => {
    const master = randomBytes(32);
    assert.notDeepEqual(deriveKey(master, "oauth-state"), deriveKey(master, "installation-tokens"));
  });
});

describe("token encryption", () => {
  it("binds ciphertext to its row and field through associated data", () => {
    const key = randomBytes(32);
    const sealed = encrypt(key, "xoxp-secret", "row:T1:U1:user");
    assert.equal(decrypt(key, sealed, "row:T1:U1:user"), "xoxp-secret");
    assert.ok(!sealed.includes("xoxp"));
    assert.throws(() => decrypt(key, sealed, "row:T1:U2:user"));
    assert.throws(() => decrypt(key, sealed, "row:T1:U1:bot"));
    assert.throws(() => decrypt(randomBytes(32), sealed, "row:T1:U1:user"));
  });
});

describe("notification text", () => {
  it("builds archive links from text timestamps without floating-point conversion", () => {
    const base = "https://acme.slack.com/";
    assert.equal(
      messageLink(base, "C123ABC", "1700000000.000100"),
      "https://acme.slack.com/archives/C123ABC/p1700000000000100",
    );
    // 1234567890.123456 is not exactly representable; Number() would round the last digits.
    assert.equal(messageLink(base, "G123", "1234567890.123456")?.endsWith("/p1234567890123456"), true);
    assert.equal(messageLink(base, "D0ABC", "1700000000.0001"), null);
    assert.equal(messageLink(base, "C1/../x", "1700000000.000100"), null);
    assert.equal(messageLink("https://evil.example/", "C123", "1700000000.000100"), null);
  });

  it("accepts only plain https Slack workspace URLs", () => {
    assert.equal(parseWorkspaceUrl("https://acme.slack.com/"), "https://acme.slack.com/");
    assert.equal(parseWorkspaceUrl("https://ACME.slack.com/"), "https://acme.slack.com/");
    for (const bad of [
      "http://acme.slack.com/",
      "https://acme.slack.com.evil.test/",
      "https://slack.com/",
      "https://user@acme.slack.com/",
      "https://acme.slack.com:8443/",
      "https://acme.slack.com/path",
      "https://acme.slack.com/?q=1",
      "javascript:alert(1)",
      "",
      null,
    ]) {
      assert.equal(parseWorkspaceUrl(bad), null, String(bad));
    }
  });

  it("escapes Slack mrkdwn control characters", () => {
    assert.equal(escapeMrkdwn("a<b>&c"), "a&lt;b&gt;&amp;c");
    assert.equal(
      reactionNotification("U1", "tada", "https://acme.slack.com/archives/C1/p1700000000000100"),
      "<@U1> reacted :tada: to your message. <https://acme.slack.com/archives/C1/p1700000000000100|View message>",
    );
    assert.ok(!reactionNotification("U1", "a<b", "https://x/").includes("a<b"));
  });

  it("puts Disconnect only on the connected Home view, with a confirmation and no identity in its value", () => {
    const connected = JSON.stringify(
      homeView({ connected: true, siteUrl: "https://r.test", includeSelfReactions: false }),
    );
    assert.match(connected, /"action_id":"disconnect"/);
    assert.match(connected, /"confirm"/);
    assert.match(connected, /never backfilled/);
    assert.ok(!connected.includes('"value"'));
    const disconnected = JSON.stringify(
      homeView({ connected: false, siteUrl: "https://r.test", includeSelfReactions: false }),
    );
    assert.ok(!disconnected.includes('disconnect"'));
  });
});

describe("request bodies", () => {
  it("reads the raw body and refuses bodies over the limit, declared or streamed", async () => {
    const post = (body: string, headers: Record<string, string> = {}) =>
      new Request("https://x.test/", { method: "POST", body, headers });
    assert.equal(await readBody(post("a=1&b=2")), "a=1&b=2");
    assert.equal(await readBody(post("x".repeat(MAX_BODY_BYTES + 1))), null);
    assert.equal(await readBody(post("small", { "content-length": String(MAX_BODY_BYTES + 1) })), null);
  });
});
