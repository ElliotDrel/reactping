import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { it } from "node:test";

// Real Slack IDs are a letter, 0, and nine more uppercase letters or digits (users, workspaces, channels, apps,
// bots, user groups). Docs and tests use shorter fakes such as U123 or U0123ABCD.
const SLACK_ID = /\b[ABCDEGSTUW]0[A-Z0-9]{9}\b/;

it("keeps real Slack IDs out of the public repository", () => {
  // Nov 19: a real user ID from a screenshot nearly shipped in a test comment.
  assert.match(`id ${"U0"}ABCDEFGH9`, SLACK_ID, "the pattern catches a real-shaped ID");
  const root = new URL("../", import.meta.url);
  const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const leaks = files.flatMap((file) => {
    const text = readFileSync(new URL(file, root), "utf8");
    if (text.includes("\0")) return []; // binary
    return (text.match(new RegExp(SLACK_ID, "g")) ?? []).map((id) => `${file}: ${id}`);
  });
  assert.deepEqual(leaks, [], "replace real Slack IDs with fakes like U123");
});
