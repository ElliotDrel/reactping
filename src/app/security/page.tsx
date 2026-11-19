import { Footer, Header, pageMetadata } from "../site.tsx";

export const metadata = pageMetadata({
  title: "How ReactPing protects your messages",
  description:
    "ReactPing asks Slack for three permissions, never stores your messages, encrypts its tokens, and runs no tracking. Every claim links to the code.",
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

        <h2>Two permissions</h2>
        <p>ReactPing asks Slack to see reactions and to send you a DM. Nothing else.</p>
        <p className="actions">
          <a className="btn btn-quiet btn-small" href={`${CODE}src/slack.ts#L3-L4`}>
            See the permissions
          </a>
        </p>

        <h2>Reactions only</h2>
        <p>
          No other data is needed. When someone reacts to your message, ReactPing checks it's someone else's reaction to
          your message in the same workspace, then sends your DM.
        </p>
        <p className="actions">
          <a className="btn btn-quiet btn-small" href={`${CODE}src/handler.ts#L400-L434`}>
            See the event handling
          </a>
          <a className="btn btn-quiet btn-small" href={`${CODE}src/slack.ts#L119-L168`}>
            See every Slack call it makes
          </a>
        </p>

        <h2>Minimal storage</h2>
        <p>One database table: your Slack workspace and user IDs, the workspace URL, and encrypted access tokens.</p>
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
          No analytics, no third-party scripts, and no cookies except one short-lived cookie that secures adding
          ReactPing to Slack. The site's security policy blocks scripts from any other site.
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
