import { Footer, Header, pageMetadata } from "../site.tsx";

export const metadata = pageMetadata({
  title: "How ReactPing works: Slack reaction notifications",
  description:
    "How ReactPing sends you a Slack DM when someone reacts to your message: setup, what triggers a DM, what it shows, and how to disconnect.",
  path: "/how-it-works",
});

export default function HowItWorks() {
  return (
    <>
      <Header />

      <main id="main" className="page wrap prose">
        <h1>How ReactPing works</h1>
        <p className="lede">
          In a busy Slack channel, reactions to your messages are easy to miss. ReactPing sends you a DM each time
          someone reacts, so you know who responded and can jump straight back.
        </p>

        <h2>Doesn't Slack already notify you about reactions?</h2>
        <p>
          Not with an alert. Slack lists reactions in its Activity tab, but its notification settings cover direct
          messages, mentions, thread replies, and keywords, not reactions. ReactPing fills that gap: a DM for each
          reaction on your message, with who reacted, the emoji, a one-line preview, and a link back. It's free forever
          and open source, asks for two permissions, and never stores your message text.
        </p>
        <p className="actions">
          <a className="btn btn-quiet" href="https://slack.com/help/articles/360025446073-Guide-to-Slack-notifications">
            Slack's notification guide
          </a>
        </p>

        <h2>1. Add it to Slack</h2>
        <p>
          Select <strong>Add to Slack</strong>, pick your workspace, and select <strong>Allow</strong>. ReactPing sends
          a welcome DM so you know it's working. Use more than one workspace? Add it to each one.
        </p>

        <h2>2. Someone reacts to your message</h2>
        <p>
          Any emoji reaction from someone else on a message you wrote triggers a DM. Your own reactions don't. Each
          person adds ReactPing for themselves, so teammates who haven't added it won't get DMs.
        </p>

        <h2>3. You get a DM</h2>
        <p>
          The DM shows who reacted, the emoji, and a short preview of your message. "Your message" links straight back
          to it. The DM arrives in the same workspace where the reaction happened.
        </p>

        <h2>Good to know</h2>
        <ul>
          <li>Notifications are best effort. A reaction missed during an outage isn't replayed.</li>
          <li>
            If your workspace requires admin approval for apps, Slack lets you request it. Add ReactPing again once it's
            approved.
          </li>
          <li>
            To stop, open ReactPing in Slack, go to <strong>Home</strong>, and select <strong>Disconnect</strong>.
          </li>
        </ul>

        <h2>Built to respect your privacy</h2>
        <p>
          Two permissions, no tracking, and your messages are never stored. Every claim links to the open-source code.
        </p>
        <p className="actions">
          <a className="btn btn-quiet" href="/security">
            See how ReactPing protects your messages
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
