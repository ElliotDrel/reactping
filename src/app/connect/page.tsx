import { ConnectButton } from "./connect-button.tsx";
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
            <strong>Select Allow.</strong> ReactPing asks to see reactions, send messages, respond to mentions, and accept commands.
          </li>
          <li>
            <strong>Repeat for each workspace</strong> where you want notifications.
          </li>
        </ol>
        <p className="note">
          Everyone connects for themselves; teammates can share this page. If your workspace requires admin approval,
          Slack lets you request it. Connect once it's approved.
        </p>
        <p className="note">
          On a phone, open this page in Safari or Chrome and finish Slack's approval in the same browser. Once
          connected, you can open the Slack app to receive reaction DMs. If Slack won't let you finish on your phone,
          connect on a computer; you only need to connect once per workspace.
        </p>
        <ConnectButton />
      </main>

      <Footer />
    </>
  );
}
