import assert from "node:assert/strict";
import { it } from "node:test";
import { loadConfig } from "../src/config.ts";

it("excludes self-reactions unless testing is explicitly enabled, and rejects ambiguous flag values", () => {
  const env = {
    BASE_URL: "http://localhost",
    SLACK_CLIENT_ID: "test",
    SLACK_CLIENT_SECRET: "test",
    SLACK_SIGNING_SECRET: "test",
    ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  };
  assert.equal(loadConfig(env).includeSelfReactions, false);
  assert.equal(loadConfig({ ...env, INCLUDE_SELF_REACTIONS: "true" }).includeSelfReactions, true);
  assert.equal(loadConfig({ ...env, INCLUDE_SELF_REACTIONS: "false" }).includeSelfReactions, false);
  assert.throws(() => loadConfig({ ...env, INCLUDE_SELF_REACTIONS: "yes" }), /INCLUDE_SELF_REACTIONS/);
});
