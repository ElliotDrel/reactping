import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPool } from "../src/db.ts";
import {
  CRON_DRAIN_BUDGET_MS,
  EVENT_DRAIN_BUDGET_MS,
  FUNCTION_MAX_DURATION_SECONDS,
  SLACK_TIMEOUT_MS,
} from "../src/runtime.ts";

process.env.NODE_ENV = "test";

describe("hosted runtime safety", () => {
  it("requires verified TLS for remote Postgres, supports an explicit CA, and leaves loopback usable", async () => {
    const remote = createPool("postgres://user:password@db.example.test/app");
    const custom = createPool("postgres://user:password@db.example.test/app", "provider-ca-pem");
    const local = createPool("postgres://postgres:postgres@127.0.0.1:54329/postgres");
    try {
      assert.deepEqual(remote.options.ssl, { rejectUnauthorized: true });
      assert.deepEqual(custom.options.ssl, { rejectUnauthorized: true, ca: "provider-ca-pem" });
      assert.equal(local.options.ssl, false);
      for (const option of ["ssl=false", "sslmode=disable", "sslrootcert=x", "sslcert=x", "sslkey=x"]) {
        assert.throws(() => createPool(`postgres://user:password@db.example.test/app?${option}`), /omit SSL query/);
      }
    } finally {
      await Promise.all([remote.end(), custom.end(), local.end()]);
    }
  });

  it("handles a dropped idle connection without an unhandled error or logging its message", async () => {
    const pool = createPool("postgres://localhost/app");
    try {
      assert.doesNotThrow(() => pool.emit("error", new Error("sensitive provider detail")));
    } finally {
      await pool.end();
    }
  });

  it("reserves runtime for the last delivery's two Slack calls and database overhead", () => {
    for (const budget of [CRON_DRAIN_BUDGET_MS, EVENT_DRAIN_BUDGET_MS]) {
      assert.ok(budget + 2 * SLACK_TIMEOUT_MS + 10_000 < FUNCTION_MAX_DURATION_SECONDS * 1000);
    }
  });
});
