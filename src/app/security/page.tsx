import { Footer, Header, pageMetadata } from "../site.tsx";

export const metadata = pageMetadata({
  title: "How ReactPing protects your messages",
  description:
    "ReactPing asks Slack for four permissions, never stores your messages, encrypts its tokens, and runs no tracking. Every claim links to the code.",
  path: "/security",
});

// Each link points at exact source lines; test/site.test.ts (SOURCE_LINKS) fails if those lines stop matching.
const CODE = "https://github.com/ElliotDrel/reactping/blob/main/";

export default function Security() {
  return (
    <>
      <Header />

      <main id="main" className="page wrap prose">
        <h1>How ReactPing protects your messages</h1>
        <p className="lede">
          No tracking, and your messages are never stored. You don't have to take our word for it: ReactPing is open
          source, and every claim below links to the exact code.
        </p>

        <h2>Four permissions</h2>
        <p>ReactPing asks Slack to see reactions, send messages, respond to mentions, and accept slash commands.</p>
        <p className="actions">
          <a className="btn btn-quiet btn-small" href={`${CODE}src/slack.ts#L3-L4`}>
            See the permissions
          </a>
        </p>

        <h2>Reactions and direct interactions</h2>
        <p>
          Only reactions and explicit app interactions are processed. When someone reacts to your message, ReactPing checks it's someone else's reaction to
          your message in the same workspace, then sends your DM.
        </p>
        <p className="actions">
          <a className="btn btn-quiet btn-small" href={`${CODE}src/handler.ts#L434-L467`}>
            See the event handling
          </a>
          <a className="btn btn-quiet btn-small" href={`${CODE}src/slack.ts#L124-L202`}>
            See every Slack call it makes
          </a>
        </p>

        <h2>Minimal storage</h2>
        <p>Slack IDs, workspace URL, encrypted access tokens, and short-lived replay-prevention digests. A workspace bot grant remains until the app is removed.</p>
        <p className="actions">
          <a
            className="btn btn-quiet btn-small"
            href={`${CODE}supabase/migrations/20261113000000_reactping_slack_installations.sql#L14-L24`}
          >
            See the table
          </a>
        </p>

        <h2>Encrypted tokens</h2>
        <p>Slack access tokens are encrypted with AES-256-GCM before they're saved.</p>
        <p className="actions">
          <a className="btn btn-quiet btn-small" href={`${CODE}src/db.ts#L82-L83`}>
            See the encryption
          </a>
        </p>

        <h2>No tracking</h2>
        <p>
          ReactPing never tracks what you do in Slack. The website counts visits and installs with PostHog, which sets
          its own cookie and never receives Slack messages or tokens. The site's security policy allows scripts only
          from this site and PostHog.
        </p>
        <p className="actions">
          <a className="btn btn-quiet btn-small" href={`${CODE}vercel.json#L9-L10`}>
            See the policy
          </a>
        </p>

        <h2>Leave any time</h2>
        <p>
          Select <strong>Disconnect</strong> in ReactPing's Home tab in Slack and your record is deleted. Full details
          are in the privacy policy.
        </p>
        <p className="actions">
          <a className="btn btn-quiet btn-small" href="/privacy">
            Read the privacy policy
          </a>
        </p>

        <p className="actions">
          <a className="btn btn-large" href="/connect">
            Add to Slack
          </a>
        </p>
      </main>

      <Footer />
    </>
  );
}
