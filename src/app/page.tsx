import { Footer, Header, pageMetadata, SITE_URL } from "./site.tsx";

const DESCRIPTION =
  "ReactPing DMs you when someone reacts to your Slack message: who reacted, the emoji, a preview, and a link back. Free forever, no tracking, and it never stores your messages.";

export const metadata = pageMetadata({
  title: "ReactPing: reaction notifications for Slack",
  description: DESCRIPTION,
  path: "/",
});

/** The visible FAQ and the FAQPage structured data come from this one list, so they can't drift apart. */
const FAQ: [question: string, answer: string][] = [
  [
    "How do I get notified when someone reacts to my Slack message?",
    "Slack lists reactions in Activity but doesn't alert you. Add ReactPing and it DMs you each time.",
  ],
  ["What does it cost?", "Nothing. Free forever, no paid plan, no ads."],
  [
    "Do my own reactions notify me?",
    "No. ReactPing ignores reactions you add to your own messages, so you only hear about other people.",
  ],
  ["Does everyone need to add it?", "Only people who want DMs. Everyone adds it for themselves."],
  ["What if my admin approves apps?", "Slack lets you request approval. Add ReactPing again once it's approved."],
  ["How do I disconnect?", "Open ReactPing in Slack, go to Home, and select Disconnect. Your record is deleted."],
];

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", "@id": `${SITE_URL}/#website`, name: "ReactPing", url: `${SITE_URL}/` },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      name: "ReactPing",
      url: `${SITE_URL}/`,
      description: DESCRIPTION,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Slack",
      image: `${SITE_URL}/assets/social-card.png?v=2`,
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      license: "https://opensource.org/licenses/MIT",
      sameAs: ["https://github.com/ElliotDrel/reactping"],
      author: { "@type": "Person", name: "Elliot Drel", url: "https://elliotdrel.com/" },
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQ.map(([name, text]) => ({
        "@type": "Question",
        name,
        acceptedAnswer: { "@type": "Answer", text },
      })),
    },
  ],
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        // JSON-LD is data, not code; escaping "<" keeps it from ever closing the script element.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, "\\u003c") }}
      />
      <Header />

      <main id="main">
        <section className="hero wrap">
          <div className="hero-copy">
            <h1>Reaction notifications for Slack</h1>
            <p className="lede">
              Reactions get lost in busy channels. Get a DM with who reacted and a link back. Free forever.
            </p>
            <a className="btn btn-large" href="/connect">
              Add to Slack
            </a>
            <img
              className="stats"
              src="/api/stats"
              width="640"
              height="32"
              alt="Live count of workspaces using ReactPing and reaction notifications sent"
            />
          </div>

          <figure className="ping" aria-label="Example: ReactPing DMs you that Sam reacted with a party popper">
            <span className="ping-emoji" aria-hidden="true">
              🎉
            </span>
            <div className="ping-dm">
              <p className="ping-from">
                <strong>ReactPing</strong> <span>now</span>
              </p>
              <p>
                <span className="mention">@Sam</span> reacted 🎉 to <span className="fake-link">your message</span>
              </p>
              <p className="ping-quote">"Here's the launch plan. We'll start with BuildPurdue…"</p>
            </div>
          </figure>
        </section>

        <section className="how wrap" aria-labelledby="how-heading">
          <h2 id="how-heading">How it works</h2>
          <ol className="how-steps">
            <li>
              <strong>Add to Slack.</strong> Takes ten seconds.
            </li>
            <li>
              <strong>Pick your workspace.</strong> Repeat for each one you use.
            </li>
            <li>
              <strong>Get a DM</strong> whenever someone reacts to your message.
            </li>
          </ol>
          <p>
            <a className="btn btn-quiet" href="/how-it-works">
              Read how it works
            </a>
          </p>
        </section>

        <section className="privacy" id="privacy" aria-labelledby="privacy-heading">
          <div className="wrap">
            <h2 id="privacy-heading">No tracking. Your messages are never stored.</h2>
            <p className="privacy-intro">Open source. Check the code.</p>
            <dl className="claims">
              <div>
                <dt>Two permissions</dt>
                <dd>See reactions. Send you a DM.</dd>
              </div>
              <div>
                <dt>Reactions only</dt>
                <dd>No other data is needed.</dd>
              </div>
              <div>
                <dt>Minimal storage</dt>
                <dd>Slack IDs, workspace URL, encrypted tokens.</dd>
              </div>
              <div>
                <dt>No tracking</dt>
                <dd>Nothing you do in Slack.</dd>
              </div>
            </dl>
            <p>
              <a className="btn btn-quiet" href="/security">
                See the proof in the code
              </a>
            </p>
          </div>
        </section>

        <section className="faq wrap" id="questions" aria-labelledby="questions-heading">
          <h2 id="questions-heading">Questions</h2>
          <dl className="claims">
            {FAQ.map(([question, answer]) => (
              <div key={question}>
                <dt>{question}</dt>
                <dd>{answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="feedback-band wrap" id="feedback" aria-labelledby="feedback-heading">
          <h2 id="feedback-heading">Help shape ReactPing</h2>
          <p>Found a bug or want a feature? Tell us in a short form. Every message is read.</p>
          <a className="btn btn-quiet btn-large" href="/feedback">
            Send feedback
          </a>
        </section>

        <section className="cta wrap" aria-labelledby="cta-heading">
          <h2 id="cta-heading">Stop missing reactions.</h2>
          <a className="btn btn-large" href="/connect">
            Add to Slack
          </a>
        </section>
      </main>

      <Footer />
    </>
  );
}
