import { Footer, Header, pageMetadata } from "../site.tsx";

export const metadata = pageMetadata({
  title: "ReactPing privacy policy",
  description: "What ReactPing stores, why, which service providers process it, and how to delete it.",
  path: "/privacy",
});

export default function Privacy() {
  return (
    <>
      <Header />

      <main id="main" className="page wrap prose">
        <h1>Privacy</h1>
        <p className="lede">
          No tracking, and ReactPing never stores your messages. ReactPing is open source, so you can check everything
          below.
        </p>

        <h2>What we store</h2>
        <p>
          For each person who connects, in each workspace: the Slack workspace ID, user ID, workspace URL, encrypted
          access tokens, and when the connection was created and updated. That is what lets ReactPing recognize you and
          send your DMs.
        </p>
        <p>
          We track when you connect and when you disconnect, and keep hourly totals of reactions handled and DMs sent,
          with no IDs, to catch outages.
        </p>

        <h2>Feedback</h2>

        <p>
          Feedback goes through the form on this website. We store what you wrote, the name and email only if you give
          them, and whether you opened the form from ReactPing's link in Slack or from the website itself. Each new
          entry is also posted to the developer's private Slack channel so it gets read.
        </p>

        <h2>What we don't store</h2>
        <p>
          From Slack: message text, files, channel history, names, email addresses, or reaction history. Your DMs stay
          in Slack.
        </p>

        <h2>How we use it</h2>
        <p>
          Only to deliver reaction notifications and manage your connection. Notifications stay in the workspace where
          the reaction happened. No advertising or sale of data.
        </p>

        <h2>Security and cookies</h2>
        <p>
          Access tokens are encrypted with AES-256-GCM. While you add ReactPing, one signed, HttpOnly cookie links
          Slack's approval to your browser; it expires after 10 minutes and is cleared when you return. The website uses
          PostHog to count visits and see which links bring people here; PostHog sets its own cookie and never receives
          your Slack messages or tokens.
        </p>

        <h2>Service providers</h2>
        <p>
          Vercel hosts the website and API. Supabase stores connection records. Slack sends reaction events and delivers
          DMs. PostHog counts website visits and installs. They may keep operational logs such as IP addresses and
          request times. ReactPing's own logs contain workspace IDs and error codes, never tokens, authorization codes,
          or message content.
        </p>

        <h2>Disconnect and delete</h2>
        <p>
          Select <strong>Disconnect</strong> in ReactPing's Home tab in Slack. That deletes your connection record and
          asks Slack to revoke your user token; other people's connections are unaffected. Removing ReactPing from a
          workspace deletes all of that workspace's records when Slack notifies us.
        </p>
        <p>
          To see, export, or delete your data, including feedback, email elliotdrel@gmail.com or use the feedback form
          with your email address. We reply within 2 business days.
        </p>

        <h2>Delivery</h2>
        <p>
          Notifications are best effort. Missed reactions aren't replayed. The free-tier database may pause after about
          a week of low activity; notifications resume once it is restored.
        </p>

        <h2>Questions</h2>
        <p>
          Email elliotdrel@gmail.com, send feedback, or open a GitHub issue. Report security issues privately as the
          security policy describes.
        </p>
        <p className="actions">
          <a className="btn btn-quiet btn-small" href="mailto:elliotdrel@gmail.com">
            Email support
          </a>
          <a className="btn btn-quiet btn-small" href="/feedback">
            Send feedback
          </a>
          <a className="btn btn-quiet btn-small" href="https://github.com/ElliotDrel/reactping/issues">
            Open a GitHub issue
          </a>
          <a className="btn btn-quiet btn-small" href="https://github.com/ElliotDrel/reactping/blob/main/SECURITY.md">
            Security policy
          </a>
        </p>
      </main>

      <Footer />
    </>
  );
}
