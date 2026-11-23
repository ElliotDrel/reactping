import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installCard, menu, shareView, testResult, welcomeMenu } from "../src/menu.ts";
import { responseUrl } from "../src/engagement.ts";
import { createOAuthState, oauthWorkspace, verifyOAuthState } from "../src/oauth-state.ts";
import { randomBytes } from "node:crypto";

const site = "https://reactping.example.test";
function buttons(message: { blocks?: unknown[] }): string[] {
  return (message.blocks ?? []).flatMap(b => {
    const block = b as { type: string; elements?: { text?: { text?: string } }[] };
    return block.type === "actions" ? (block.elements ?? []).map(e => e.text?.text ?? "") : [];
  });
}

describe("approved ReactPing menu", () => {
  it("keeps the connected, unconnected, and welcome action order", () => {
    assert.deepEqual(buttons(menu(site, "T1", true)), ["Send test notification", "Share ReactPing", "Give feedback"]);
    assert.deepEqual(buttons(menu(site, "T1", false)), ["Connect ReactPing", "Give feedback"]);
    assert.deepEqual(buttons(welcomeMenu(site, "welcome")), buttons(menu(site, "T1", true)));
    assert.equal(menu(site, "T1", true, true).text, "Here's what I can help you with:");
    assert.match(JSON.stringify(installCard(site, "T1")), /Never miss a reaction/);
    assert.match(JSON.stringify(installCard(site, "T1")), /install\?team=T1/);
    assert.deepEqual(buttons(installCard(site, "T1")), ["Connect ReactPing"]);
    assert.deepEqual(buttons(testResult(site, "T1", "AREACTPING", false)), ["Try again", "Report a problem"]);
    assert.deepEqual(buttons(testResult(site, "T1", "AREACTPING", true)), ["Open DM"]);
    assert.match(JSON.stringify(shareView(site, "T1")), /Copy installation link/);
  });
  it("validates response URLs", () => {
    assert.ok(responseUrl("https://hooks.slack.com/actions/T1/123/abc"));
    assert.ok(responseUrl("https://hooks.slack.com/app/AREACTPING/123/abc"));
    for (const url of ["http://hooks.slack.com/actions/T1/123/abc", "https://hooks.slack.com.evil.test/actions/T1/123/abc", "https://evil.test/", "https://hooks.slack.com/actions/T1/123/abc?redirect=x"]) assert.equal(responseUrl(url), undefined);
  });
  it("binds the workspace hint to the signed OAuth cookie", () => {
    const key = randomBytes(32), now = 1800000000000;
    const { state, cookie } = createOAuthState(key, now, "T1");
    assert.equal(verifyOAuthState(key, cookie, state, now), true);
    assert.equal(oauthWorkspace(cookie), "T1");
    assert.equal(verifyOAuthState(key, cookie.replace(".T1.", ".T2."), state, now), false);
  });
});
