import { Footer, Header, pageMetadata } from "../site.tsx";

export const metadata = pageMetadata({
  title: "Add ReactPing to Slack",
  description: "Three quick steps to connect ReactPing to your Slack workspace.",
  path: "/connect",
});

export default function Connect() {
  return (
    <>
      <Header nav={false} />

      <main id="main" className="page wrap">
        <h1>Before you continue</h1>
        <ol className="steps">
          <li>
            <strong>Pick the right workspace.</strong> On Slack's approval page, check the workspace name in the
            top-right corner and switch it if needed.
          </li>
          <li>
            <strong>Select Allow.</strong> ReactPing asks for two permissions: see reactions and send you a DM.
          </li>
          <li>
            <strong>Repeat for each workspace</strong> where you want notifications.
          </li>
        </ol>
        <p className="note">
          Everyone connects for themselves; teammates can share this page. If your workspace requires admin approval,
          Slack lets you request it. Connect once it's approved.
        </p>
        <a className="btn btn-large" href="/api/slack/install">
          Continue to Slack
        </a>
      </main>

      <Footer />
    </>
  );
}
