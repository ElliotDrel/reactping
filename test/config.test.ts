import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApi } from "../src/api.ts";
import { supabaseUserVerifier } from "../src/auth.ts";
import { assertPublishableKey, loadConfig } from "../src/config.ts";

process.env.NODE_ENV = "test";

const env = {
  PUBLIC_SITE_URL: "http://localhost:3000",
  PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc",
  DATABASE_URL: "postgres://localhost/reactping",
  SLACK_CLIENT_ID: "test",
  SLACK_CLIENT_SECRET: "test",
  SLACK_SIGNING_SECRET: "test",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  DELIVERY_CRON_SECRET: "x".repeat(32),
};

function config(overrides: Record<string, string | undefined> = {}) {
  const result = loadConfig({ ...env, ...overrides });
  if (!result.ok) throw new Error(result.problems.join("; "));
  return result.config;
}

describe("server configuration", () => {
  it("excludes self-reactions unless testing is explicitly enabled, and rejects ambiguous flag values", () => {
    assert.equal(config().includeSelfReactions, false);
    assert.equal(config({ INCLUDE_SELF_REACTIONS: "true" }).includeSelfReactions, true);
    assert.equal(config({ INCLUDE_SELF_REACTIONS: "false" }).includeSelfReactions, false);
    assert.throws(() => config({ INCLUDE_SELF_REACTIONS: "yes" }), /INCLUDE_SELF_REACTIONS/);
  });

  it("keeps installs disabled unless the operator flag is set; the public launch flag has no effect", () => {
    assert.equal(config().installsEnabled, false);
    assert.equal(config({ PUBLIC_INSTALL_ENABLED: "true" }).installsEnabled, false);
    assert.equal(config({ REACTPING_INSTALLS_ENABLED: "true" }).installsEnabled, true);
  });

  it("reports every missing or invalid value by name without echoing values", () => {
    const result = loadConfig({
      ...env,
      SLACK_CLIENT_SECRET: "",
      ENCRYPTION_KEY: "short",
      PUBLIC_SITE_URL: "http://example.com",
    });
    assert.equal(result.ok, false);
    const problems = (result as { problems: string[] }).problems.join("\n");
    assert.match(problems, /SLACK_CLIENT_SECRET is missing/);
    assert.match(problems, /ENCRYPTION_KEY must be 32 bytes/);
    assert.match(problems, /PUBLIC_SITE_URL must use https/);
    assert.ok(!problems.includes("short"));
  });

  it("refuses Supabase secret or service-role keys where a publishable key belongs", () => {
    const jwt = (role: string) => ["e30", Buffer.from(JSON.stringify({ role })).toString("base64url"), "sig"].join(".");
    assert.throws(() => assertPublishableKey("sb_secret_abc"), /secret key/);
    assert.throws(() => assertPublishableKey(jwt("service_role")), /not anon/);
    assert.doesNotThrow(() => assertPublishableKey(jwt("anon")));
    assert.doesNotThrow(() => assertPublishableKey("sb_publishable_abc"));
    assert.equal(loadConfig({ ...env, PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc" }).ok, false);
  });

  it("fails closed and says so when the backend is not configured", async () => {
    const api = createApi(null);
    const health = await api(new Request("http://localhost/api/health"));
    assert.deepEqual([health.status, await health.json()], [200, { ok: true, ready: false }]);
    for (const path of ["/api/me", "/api/slack/events", "/api/slack/oauth/callback", "/api/internal/deliver"]) {
      const res = await api(new Request(`http://localhost${path}`, { method: path === "/api/me" ? "GET" : "POST" }));
      assert.deepEqual([res.status, await res.json()], [503, { error: "not_configured" }], path);
    }
  });
});

describe("Supabase user verification", () => {
  it("sends only the publishable key and the user's token, and treats rejected tokens as signed out", async () => {
    const seen: Headers[] = [];
    const verify = supabaseUserVerifier("https://p.supabase.co", "sb_publishable_abc", (async (_url, init) => {
      const headers = new Headers(init?.headers);
      seen.push(headers);
      return headers.get("authorization") === "Bearer good"
        ? Response.json({ id: "8c2f0c5e-0000-4000-8000-000000000001", email: "a@example.test" })
        : new Response("{}", { status: 403 });
    }) as typeof fetch);
    assert.deepEqual(await verify("good"), { id: "8c2f0c5e-0000-4000-8000-000000000001", email: "a@example.test" });
    assert.equal(await verify("bad"), null);
    assert.equal(seen[0]!.get("apikey"), "sb_publishable_abc");
  });
});
