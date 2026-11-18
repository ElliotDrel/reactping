import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.ts";
import { createPool } from "../src/db.ts";
import { createHandler } from "../src/handler.ts";

process.env.NODE_ENV = "test";

const env = {
  PUBLIC_SITE_URL: "https://reactping.example.test",
  DATABASE_URL: "postgres://localhost/reactping",
  SLACK_CLIENT_ID: "test",
  SLACK_CLIENT_SECRET: "test",
  SLACK_SIGNING_SECRET: "test",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
};

function config(overrides: Record<string, string | undefined> = {}) {
  const result = loadConfig({ ...env, ...overrides });
  if (!result.ok) throw new Error(result.problems.join("; "));
  return result.config;
}

describe("server configuration", () => {
  it("excludes self-reactions unless testing is enabled, and never fails configuration over the flag", () => {
    assert.equal(config().includeSelfReactions, false);
    for (const on of ["true", "TRUE", " True\n", '"true"', "'true'"]) {
      assert.equal(config({ INCLUDE_SELF_REACTIONS: on }).includeSelfReactions, true, JSON.stringify(on));
    }
    // Anything unclear means off, the safe default, rather than a site-wide 503.
    for (const off of ["false", "yes", "1", "tru", ""]) {
      assert.equal(config({ INCLUDE_SELF_REACTIONS: off }).includeSelfReactions, false, JSON.stringify(off));
    }
  });

  it("has no install gate: removed launch flags are ignored", () => {
    const loaded = config({ PUBLIC_INSTALL_ENABLED: "false", REACTPING_INSTALLS_ENABLED: "false" });
    assert.deepEqual(Object.keys(loaded).sort(), [
      "databaseCa",
      "databaseUrl",
      "encryptionKey",
      "includeSelfReactions",
      "siteUrl",
      "slackClientId",
      "slackClientSecret",
      "slackSigningSecret",
    ]);
  });

  it("reports every missing or invalid value by name without echoing values", () => {
    const result = loadConfig({
      ...env,
      SLACK_CLIENT_SECRET: "",
      ENCRYPTION_KEY: "short",
      PUBLIC_SITE_URL: "http://example.com",
      DATABASE_URL: "postgres://user:pw@db.example.test/app?sslmode=disable",
    });
    assert.equal(result.ok, false);
    const problems = (result as { problems: string[] }).problems.join("\n");
    assert.match(problems, /SLACK_CLIENT_SECRET is missing/);
    assert.match(problems, /ENCRYPTION_KEY must be 32 bytes/);
    assert.match(problems, /PUBLIC_SITE_URL must use https/);
    assert.match(problems, /DATABASE_URL must omit SSL query parameters/);
    assert.ok(!problems.includes("short") && !problems.includes("pw"));
  });

  it("fails closed on every route when not configured", async () => {
    const handler = createHandler(null);
    for (const [method, path] of [
      ["GET", "/api/slack/install"],
      ["GET", "/api/slack/oauth/callback"],
      ["POST", "/api/slack/events"],
      ["POST", "/api/slack/interactions"],
    ] as const) {
      const res = await handler(new Request(`https://x.test${path}`, { method }));
      assert.deepEqual([res.status, await res.text()], [503, "not_configured"], path);
    }
  });
});

describe("database connections", () => {
  it("requires verified TLS for remote Postgres, supports an explicit CA, and leaves loopback usable", async () => {
    const remote = createPool("postgres://user:password@db.example.test/app");
    const custom = createPool("postgres://user:password@db.example.test/app", "provider-ca-pem");
    const local = createPool("postgres://postgres:postgres@127.0.0.1:54329/postgres");
    try {
      assert.deepEqual(remote.options.ssl, { rejectUnauthorized: true });
      assert.deepEqual(custom.options.ssl, { rejectUnauthorized: true, ca: "provider-ca-pem" });
      assert.equal(local.options.ssl, false);
      assert.equal(remote.options.query_timeout, 5_000);
      for (const option of ["ssl=false", "sslmode=disable", "sslrootcert=x", "sslcert=x", "sslkey=x"]) {
        assert.throws(() => createPool(`postgres://user:password@db.example.test/app?${option}`), /omit SSL query/);
      }
    } finally {
      await Promise.all([remote.end(), custom.end(), local.end()]);
    }
  });

  it("handles a dropped idle connection without an unhandled error", async () => {
    const pool = createPool("postgres://localhost/app");
    try {
      assert.doesNotThrow(() => pool.emit("error", new Error("sensitive provider detail")));
    } finally {
      await pool.end();
    }
  });
});
