import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captureInstall, posthogVisitor } from "../src/analytics.ts";

const TOKEN = "phc_test";
const cookie = (value: object) => `a=1; ph_${TOKEN}_posthog=${encodeURIComponent(JSON.stringify(value))}; b=2`;

describe("website analytics", () => {
  it("reads the visitor's PostHog ID from its cookie, and nothing else", () => {
    assert.equal(posthogVisitor(TOKEN, cookie({ distinct_id: "019a-visitor" })), "019a-visitor");
    assert.equal(posthogVisitor(TOKEN, null), undefined);
    assert.equal(posthogVisitor(TOKEN, "ph_other_posthog=x"), undefined);
    assert.equal(posthogVisitor(TOKEN, `ph_${TOKEN}_posthog=not-json`), undefined);
    assert.equal(posthogVisitor(TOKEN, cookie({ distinct_id: "<script>" })), undefined);
  });

  it("sends one slack_installed event under the visitor's ID, with no Slack IDs", async () => {
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await captureInstall(TOKEN, "https://us.i.posthog.com/", cookie({ distinct_id: "019a-visitor" }), fake);
    assert.deepEqual(sent, [
      {
        url: "https://us.i.posthog.com/i/v0/e/",
        body: { api_key: TOKEN, event: "slack_installed", distinct_id: "019a-visitor" },
      },
    ]);
    // Without the cookie the install still counts, under a one-off ID.
    await captureInstall(TOKEN, "https://us.i.posthog.com", null, fake);
    assert.match(String(sent[1]!.body.distinct_id), /^install_/);
  });
});
