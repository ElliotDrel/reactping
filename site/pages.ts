import { RETENTION_HOURS } from "../src/config.ts";
import { html, SafeHtml } from "../src/html.ts";
import { BOT_SCOPES, USER_SCOPES } from "../src/slack.ts";
import { layout, LOGO, type PageMeta } from "./layout.ts";
import type { BrowserConfig, PublicConfig } from "./public-config.ts";

export interface Page extends PageMeta {
  /** Output file inside the static directory. */
  file: string;
  render: (config: PublicConfig) => string;
}

// Shared pieces

function installStatus(config: PublicConfig): SafeHtml {
  return config.installEnabled
    ? html`<p class="status status-open"><span class="dot" aria-hidden="true"></span> Free pilot: installs open</p>`
    : html`<p class="status status-closed">
        <span class="dot" aria-hidden="true"></span> Private pilot: public installs are not open yet
      </p>`;
}

const COVERAGE_NOTE = html`<p class="coverage-note">
  <strong>Coverage so far:</strong> pilot testing has confirmed reactions on messages in public channels. Private
  channels, threads, direct messages, group DMs, Slack Connect channels, and the single-inbox option have not been
  confirmed live yet.
</p>`;

const DEMO = html`<figure class="demo" aria-labelledby="demo-caption">
  <div class="demo-stage">
    <div class="mock mock-channel">
      <div class="mock-bar"><span class="mock-hash" aria-hidden="true">#</span> launch-notes</div>
      <div class="mock-msg">
        <div class="avatar avatar-a" aria-hidden="true">M</div>
        <div class="mock-body">
          <p class="mock-meta"><strong>Maya</strong> <span>10:42 AM</span></p>
          <p>Draft release notes are up. Comments welcome before Thursday.</p>
          <ul class="reactions" aria-label="Reactions on Maya's message">
            <li><span aria-hidden="true">👀</span> 2</li>
            <li class="reaction-new">
              <span aria-hidden="true">🎉</span> 1<span class="sr-only"> new party popper reaction</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
    <div class="demo-link" aria-hidden="true"><span></span></div>
    <div class="mock mock-dm">
      <div class="mock-bar">Direct message</div>
      <div class="mock-msg">
        <div class="avatar avatar-bot" aria-hidden="true">${LOGO}</div>
        <div class="mock-body">
          <p class="mock-meta"><strong>ReactPing</strong> <span class="app-tag">App</span> <span>10:43 AM</span></p>
          <p>
            <span class="mention">@Sam</span> reacted 🎉 to your message in <strong>Northwind</strong>.
            <span class="fake-link">View message</span>
          </p>
        </div>
      </div>
    </div>
  </div>
  <figcaption id="demo-caption">
    <span class="label">Illustration</span> Fictional people and workspace. Not a screenshot of Slack.
  </figcaption>
</figure>`;

function ctaBand(config: PublicConfig): SafeHtml {
  return html`<section class="cta-band" aria-labelledby="cta-heading">
    <div class="wrap cta-inner">
      <div>
        <h2 id="cta-heading">Stop checking threads for reactions.</h2>
        <p>Connect a workspace in a couple of minutes. Disconnect whenever you like.</p>
      </div>
      <div class="cta-actions">
        <a class="btn btn-primary btn-large" href="/install">Add to Slack</a>
        ${installStatus(config)}
      </div>
    </div>
  </section>`;
}

function scopeTable(): SafeHtml {
  return html`<table class="scopes">
    <caption class="sr-only">
      Slack permissions ReactPing requests
    </caption>
    <thead>
      <tr>
        <th scope="col">Permission</th>
        <th scope="col">Granted as</th>
        <th scope="col">Why ReactPing needs it</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><code>${USER_SCOPES.join(", ")}</code></td>
        <td>You</td>
        <td>
          Lets Slack tell ReactPing when someone reacts to your messages, and lets ReactPing fetch a link to the
          message. It does not grant access to message text.
        </td>
      </tr>
      <tr>
        <td><code>${BOT_SCOPES.join(", ")}</code></td>
        <td>ReactPing bot</td>
        <td>Lets the ReactPing app send you the notification as a direct message.</td>
      </tr>
    </tbody>
  </table>`;
}

function supportContact(config: PublicConfig): SafeHtml {
  return config.supportEmail
    ? html`<p>
        Email <a href="mailto:${config.supportEmail}">${config.supportEmail}</a>. Please never send Slack tokens or
        message contents.
      </p>`
    : html`<p class="notice notice-plain">
        <strong>Support contact not published yet.</strong> ReactPing is in a private pilot and a public support address
        has not been set up. Pilot participants can reach the maintainer through the channel they were invited from.
      </p>`;
}

const FAQ: { q: string; a: (config: PublicConfig) => SafeHtml; home?: boolean }[] = [
  {
    q: "Does ReactPing read my messages?",
    home: true,
    a: () =>
      html`<p>
        No. ReactPing never requests permission to read message text or history. When someone reacts, Slack sends the
        emoji, who reacted, and where the message lives. ReactPing turns that into a DM with a link back to the message.
      </p>`,
  },
  {
    q: "Which reactions trigger a DM?",
    home: true,
    a: () =>
      html`<p>
        Reactions other people add to messages <em>you</em> wrote, in a workspace you connected. Reactions on other
        people's messages, on files, and removed reactions never send anything. Reactions you add to your own messages
        are skipped too.
      </p>`,
  },
  {
    q: "Will I get DMs for reactions that happened before I connected, or while ReactPing was down?",
    home: true,
    a: () =>
      html`<p>
        No. ReactPing only handles reactions Slack delivers while it is connected and running. It does not backfill
        older reactions or anything Slack could not deliver during an outage.
      </p>`,
  },
  {
    q: "Can I get notifications from several workspaces in one place?",
    a: () =>
      html`<p>
        Yes, if you choose to. By default each notification stays in the workspace where the reaction happened. You can
        instead send everything to your DM in one connected workspace. Because that moves reaction details between
        workspaces, ReactPing asks for explicit consent first and shows the reactor as "Someone" instead of naming them.
      </p>`,
  },
  {
    q: "Which conversations are covered?",
    a: () => COVERAGE_NOTE,
  },
  {
    q: "My workspace needs admin approval for apps. What happens?",
    a: () =>
      html`<p>
        Slack will show a request form instead of the usual approval screen. Once an admin approves ReactPing, open the
        ReactPing app and connect the workspace again. Some workspaces block outside apps entirely. Enterprise Grid
        organization-wide installs are not supported.
      </p>`,
  },
  {
    q: "Is it free? What are the pilot limitations?",
    home: true,
    a: () =>
      html`<p>
        ReactPing is a free pilot. There is no uptime commitment, features may change, and the service may pause or end.
        In rare cases, such as a Slack timeout, you could get the same notification twice; ReactPing prefers a duplicate
        over a missed DM.
      </p>`,
  },
  {
    q: "How do I disconnect a workspace or delete my data?",
    a: () =>
      html`<p>
        In the <a href="/app">ReactPing app</a>, disconnect a workspace to revoke its Slack tokens and delete its stored
        data immediately. "Delete my account" removes your ReactPing records and attempts to remove your sign-in email
        and revoke Slack credentials. The app reports any cleanup that needs support. Removing the app inside Slack also
        stops ReactPing.
      </p>`,
  },
  {
    q: "Is ReactPing made by Slack?",
    a: () => html`<p>No. ReactPing is an independent project and is not made, sponsored, or endorsed by Slack.</p>`,
  },
];

function faqList(config: PublicConfig, items = FAQ): SafeHtml {
  return html`<div class="faq-list">
    ${items.map(
      (item) =>
        html`<details class="faq-item">
          <summary>${item.q}</summary>
          <div class="faq-answer">${item.a(config)}</div>
        </details>`,
    )}
  </div>`;
}

function pageHead(eyebrow: string, title: string, lede: SafeHtml | string): SafeHtml {
  return html`<section class="page-head">
    <div class="wrap narrow">
      <p class="eyebrow">${eyebrow}</p>
      <h1>${title}</h1>
      <p class="lede">${lede}</p>
    </div>
  </section>`;
}

const DRAFT_BANNER = html`<div class="notice notice-draft" role="note">
  <strong>Draft for the pilot.</strong> This text describes how ReactPing works today. It has not had a legal review and
  will be finalized before public launch.
</div>`;

// Pages

const home: Page = {
  path: "/",
  file: "index.html",
  title: "A DM when someone reacts to your Slack messages",
  description:
    "ReactPing sends you a Slack direct message when someone reacts to your message, with the emoji, the workspace, and a link back. No message text is read or stored.",
  render(config) {
    return layout(
      this,
      config,
      html`<section class="hero">
          <div class="wrap hero-inner">
            <div class="hero-copy">
              <p class="eyebrow">Reaction notifications for Slack</p>
              <h1>Know when your messages <span class="accent-word">land.</span></h1>
              <p class="lede">
                ReactPing sends you a direct message when someone reacts to something you wrote, with the emoji, the
                workspace, and a link straight back to the message.
              </p>
              <div class="hero-actions">
                <a class="btn btn-primary btn-large" href="/install">Add to Slack</a>
                <a class="btn btn-quiet btn-large" href="#how-it-works">How it works</a>
              </div>
              ${installStatus(config)}
            </div>
            ${DEMO}
          </div>
        </section>

        <section class="section" id="how-it-works" aria-labelledby="steps-heading">
          <div class="wrap">
            <p class="eyebrow">How it works</p>
            <h2 id="steps-heading">Three steps, then it stays out of your way.</h2>
            <ol class="steps">
              <li>
                <span class="step-num" aria-hidden="true">1</span>
                <h3>Sign in with an email code</h3>
                <p>No password. Your email is how you get back to your settings later.</p>
              </li>
              <li>
                <span class="step-num" aria-hidden="true">2</span>
                <h3>Connect a workspace</h3>
                <p>Approve two narrow Slack permissions. Repeat for each workspace you use.</p>
              </li>
              <li>
                <span class="step-num" aria-hidden="true">3</span>
                <h3>Get a DM per reaction</h3>
                <p>When someone reacts to your message, ReactPing tells you who, which emoji, and where.</p>
              </li>
            </ol>
          </div>
        </section>

        <section class="section section-sunk" aria-labelledby="features-heading">
          <div class="wrap">
            <p class="eyebrow">What you get</p>
            <h2 id="features-heading">Small, focused, and quiet.</h2>
            <div class="cards">
              <article class="card">
                <h3>The details that matter</h3>
                <p>
                  Each DM names the emoji, the workspace, and who reacted, with a link back to your message. No link
                  previews clutter the DM.
                </p>
              </article>
              <article class="card">
                <h3>Same workspace or one inbox</h3>
                <p>
                  Keep notifications where they happened, or collect every workspace in one DM after you explicitly
                  agree.
                </p>
              </article>
              <article class="card">
                <h3>You stay in control</h3>
                <p>
                  Disconnect a workspace or delete everything from the app. Slack revocations are honored automatically.
                </p>
              </article>
            </div>
            <p class="section-link">
              <a href="/features">See all features <span aria-hidden="true">→</span></a>
            </p>
          </div>
        </section>

        <section class="section" aria-labelledby="privacy-heading">
          <div class="wrap split">
            <div>
              <p class="eyebrow">Privacy by design</p>
              <h2 id="privacy-heading">Two permissions. No message text.</h2>
              <p>
                ReactPing asks for the least Slack access that can do the job. It never reads what you wrote, never
                downloads history, and keeps the few details each notification needs for ${RETENTION_HOURS} hours.
              </p>
              <p><a href="/privacy">Read the privacy notice</a></p>
            </div>
            <div class="scope-cards">
              <div class="scope-card">
                <code>${USER_SCOPES.join(", ")}</code>
                <p>Granted by you, so Slack can say when your messages get reactions.</p>
              </div>
              <div class="scope-card">
                <code>${BOT_SCOPES.join(", ")}</code>
                <p>Granted to the ReactPing bot, so it can DM you.</p>
              </div>
              <ul class="never">
                <li>No message text or files</li>
                <li>No channel history</li>
                <li>No analytics or ads</li>
              </ul>
            </div>
          </div>
        </section>

        <section class="section section-sunk" aria-labelledby="faq-heading">
          <div class="wrap narrow">
            <p class="eyebrow">Questions</p>
            <h2 id="faq-heading">Good to know</h2>
            ${faqList(
              config,
              FAQ.filter((item) => item.home),
            )}
            <p class="section-link">
              <a href="/faq">All questions and support <span aria-hidden="true">→</span></a>
            </p>
          </div>
        </section>

        ${ctaBand(config)}`,
    );
  },
};

const features: Page = {
  path: "/features",
  file: "features.html",
  title: "Features",
  description:
    "What a ReactPing notification includes, how same-workspace and single-inbox delivery work, and how you stay in control of your data.",
  render(config) {
    return layout(
      this,
      config,
      html`${pageHead("Features", "Everything a reaction tells you. Nothing it doesn't need.", "ReactPing does one job: a short DM when someone reacts to your message.")}
        <section class="section">
          <div class="wrap feature-rows">
            <article class="feature-row">
              <div>
                <p class="eyebrow">Notification details</p>
                <h2>A useful DM, not a wall of noise</h2>
                <p>Every notification is one line in a DM from the ReactPing app:</p>
                <ul class="checks">
                  <li>The emoji that was added</li>
                  <li>Who reacted, when they are in the same workspace</li>
                  <li>Which workspace the message is in</li>
                  <li>A link back to the original message</li>
                </ul>
                <p class="muted">
                  Link and media previews are turned off, so the DM stays compact. Message text is never included.
                </p>
              </div>
              <div class="feature-visual" aria-hidden="true">
                <div class="mini-dm">
                  <span class="mention">@Sam</span> reacted 🎉 to your message in <strong>Northwind</strong>.
                  <span class="fake-link">View message</span>
                </div>
              </div>
            </article>

            <article class="feature-row">
              <div>
                <p class="eyebrow">Delivery</p>
                <h2>Same workspace, or one consolidated inbox</h2>
                <dl class="defs">
                  <dt>Same workspace (default)</dt>
                  <dd>
                    Each notification arrives as a DM in the workspace where the reaction happened. Nothing crosses
                    between workspaces.
                  </dd>
                  <dt>One inbox</dt>
                  <dd>
                    Send notifications from all connected workspaces to your DM in one of them. You must tick an
                    explicit consent box first. Across workspaces the reactor is shown as "Someone", because their
                    identity belongs to the other workspace.
                  </dd>
                </dl>
              </div>
              <div class="feature-visual" aria-hidden="true">
                <div class="route"><span>Workspace A</span><span class="route-arrow">→</span><span>DM in A</span></div>
                <div class="route">
                  <span>Workspace B</span><span class="route-arrow">→</span><span>DM in A</span
                  ><span class="route-tag">with consent</span>
                </div>
              </div>
            </article>

            <article class="feature-row">
              <div>
                <p class="eyebrow">Control and privacy</p>
                <h2>Easy to leave, careful while you stay</h2>
                <ul class="checks">
                  <li>Disconnect a workspace: stored data is deleted and Slack token revocation is attempted</li>
                  <li>
                    Delete your account: records are removed; any incomplete credential or login cleanup is reported
                  </li>
                  <li>Revoked or uninstalled in Slack? ReactPing notices and stops</li>
                  <li>Slack tokens are encrypted at rest</li>
                  <li>Reaction details are normally cleared after ${RETENTION_HOURS} hours by the cleanup job</li>
                  <li>A connection test DM checks setup without waiting for a reaction</li>
                </ul>
              </div>
            </article>

            <article class="feature-row">
              <div>
                <p class="eyebrow">Limits</p>
                <h2>What ReactPing deliberately does not do</h2>
                <ul class="plain">
                  <li>Only your own messages: reactions to other people's messages never notify you.</li>
                  <li>Your own reactions to your own messages are skipped.</li>
                  <li>No backfill of reactions from before you connected or from downtime.</li>
                  <li>No message previews, digests, or per-emoji filters yet.</li>
                  <li>Enterprise Grid organization-wide installs are not supported.</li>
                </ul>
                ${COVERAGE_NOTE}
              </div>
            </article>
          </div>
        </section>
        ${ctaBand(config)}`,
    );
  },
};

const install: Page = {
  path: "/install",
  file: "install.html",
  title: "Install",
  description:
    "How to connect ReactPing to Slack: sign in with an email code, approve two narrow permissions per workspace, and choose where notifications go.",
  render(config) {
    return layout(
      this,
      config,
      html`${pageHead("Install", "Add ReactPing to Slack", "Sign in, connect each workspace, and pick where notifications go.")}
        <section class="section section-tight">
          <div class="wrap narrow">
            <div class="install-status ${config.installEnabled ? "is-open" : "is-closed"}">
              ${installStatus(config)}
              ${
                config.installEnabled
                  ? html`<p>Open the app to sign in and connect your first workspace.</p>
                      <a class="btn btn-primary btn-large" href="/app">Open ReactPing</a>`
                  : html`<p>
                        ReactPing is not accepting new installs yet. This page explains what installing will involve. If
                        you are part of the private pilot, you can open the app.
                      </p>
                      <a class="btn btn-quiet" href="/app">Open the pilot app</a>`
              }
            </div>

            <ol class="install-steps">
              <li>
                <h2>Sign in with an email code</h2>
                <p>
                  Enter your email in the ReactPing app and type the 6-digit code you receive. There is no password.
                  Your email identifies your ReactPing settings so you can return to them on any device.
                </p>
              </li>
              <li>
                <h2>Connect a Slack workspace</h2>
                <p>
                  Choose <strong>Connect a workspace</strong>. Slack opens and asks you to approve two permissions.
                  Finish in the same browser you started in; the link expires after 10 minutes.
                </p>
                ${scopeTable()}
              </li>
              <li>
                <h2>Repeat for each workspace</h2>
                <p>
                  Every Slack workspace is authorized separately, under that workspace's own app rules. Connecting one
                  workspace never gives ReactPing access to another.
                </p>
              </li>
              <li>
                <h2>Choose where notifications go</h2>
                <p>
                  Notifications stay in the workspace where the reaction happened unless you choose one workspace as
                  your inbox and agree to send reaction details across workspaces.
                </p>
              </li>
            </ol>

            <section class="callouts" aria-label="Before you start">
              <div class="callout">
                <h3>Admin approval</h3>
                <p>
                  If your workspace requires approval for apps, Slack shows a request form. After an admin approves,
                  come back and connect again. Some workspaces don't allow outside apps at all.
                </p>
              </div>
              <div class="callout">
                <h3>Not supported</h3>
                <p>
                  Enterprise Grid organization-wide installs. Connect individual workspaces instead where your admin
                  allows it.
                </p>
              </div>
              <div class="callout">
                <h3>Leaving</h3>
                <p>
                  Disconnect a workspace or delete your account in the app at any time. Removing the app in Slack also
                  works.
                </p>
              </div>
            </section>
          </div>
        </section>`,
    );
  },
};

const faq: Page = {
  path: "/faq",
  file: "faq.html",
  title: "FAQ and support",
  description:
    "Answers about what ReactPing reads, which reactions notify you, the free pilot, data deletion, and support.",
  render(config) {
    return layout(
      this,
      config,
      html`${pageHead("FAQ", "Questions and answers", "Short answers about how ReactPing behaves today.")}
        <section class="section section-tight">
          <div class="wrap narrow">
            ${faqList(config)}
            <section id="support" class="support" aria-labelledby="support-heading">
              <h2 id="support-heading">Support</h2>
              ${supportContact(config)}
              <p>
                Most issues have a quick fix: if notifications stop, open the <a href="/app">app</a>. A workspace marked
                "Revoked" needs to be reconnected, and the connection test DM confirms ReactPing can reach you.
              </p>
            </section>
          </div>
        </section>`,
    );
  },
};

const about: Page = {
  path: "/about",
  file: "about.html",
  title: "About",
  description:
    "Why ReactPing exists: a small, independent tool built to get a DM when someone reacts to a Slack message.",
  render(config) {
    return layout(
      this,
      config,
      html`${pageHead("About", "A small tool for a small, real annoyance", "Reactions are quiet feedback. They are also easy to miss.")}
        <section class="section section-tight">
          <div class="wrap narrow prose">
            <p>
              Elliot built ReactPing to get a direct message whenever someone reacted to a Slack message, instead of
              scrolling back through channels to see whether anyone had responded. Slack doesn't offer that
              notification, so this project fills the gap with as little access as possible.
            </p>
            <p>
              The guiding rule is restraint: ask for two narrow permissions, never read message text, keep only what a
              notification needs and only briefly, and make leaving easy. Features that would need more access, such as
              message previews, are deliberately left out.
            </p>
            <p>
              ReactPing is an independent project in a free pilot. It is not affiliated with, sponsored by, or endorsed
              by Slack.
            </p>
            <p><a href="/faq#support">Questions or problems? See support.</a></p>
          </div>
        </section>`,
    );
  },
};

const privacy: Page = {
  path: "/privacy",
  file: "privacy.html",
  title: "Privacy",
  description: "What ReactPing stores, why, for how long, which service providers process it, and how to delete it.",
  render(config) {
    return layout(
      this,
      config,
      html`${pageHead("Privacy", "Privacy notice", "Plain description of the data ReactPing handles.")}
        <section class="section section-tight">
          <div class="wrap narrow prose">
            ${DRAFT_BANNER}
            <h2>What ReactPing stores</h2>
            <ul>
              <li><strong>Your email address</strong>, used to send sign-in codes and to identify your account.</li>
              <li>
                <strong>Slack identifiers</strong> for each connected workspace: workspace ID, name and URL, your Slack
                user ID, and the ReactPing bot's user ID.
              </li>
              <li>
                <strong>Slack access tokens</strong>, encrypted at rest (AES-256-GCM). They are never shown in the
                browser.
              </li>
              <li>
                <strong>Your delivery choice</strong> and, if you opt in, when you consented to cross-workspace
                delivery.
              </li>
              <li>
                <strong>Per-reaction delivery records</strong> for ${RETENTION_HOURS} hours: Slack's event ID, the
                emoji, the reactor's Slack user ID, the channel ID, the message timestamp, and delivery status.
              </li>
              <li><strong>Sign-in state</strong>: one-time Slack authorization state for up to 10 minutes.</li>
            </ul>
            <h2>What ReactPing never collects</h2>
            <p>
              Message text, files, channel history, contact lists, or profile details beyond the IDs above. ReactPing
              has no analytics, advertising, or tracking scripts, and does not sell or share data for marketing.
            </p>
            <h2>How it is used</h2>
            <p>
              Only to deliver your reaction notifications, show your settings, run a connection test you request, and
              keep the service secure. Same-workspace notifications mention the reactor; cross-workspace notifications
              say "Someone" instead.
            </p>
            <h2>Browser storage</h2>
            <p>
              Your sign-in session is kept in your browser's local storage by the Supabase Auth client. During a Slack
              connection, ReactPing sets one short-lived, HttpOnly cookie that ties the authorization to your browser;
              it expires after 10 minutes and is cleared when you return.
            </p>
            <h2>Service providers</h2>
            <ul>
              <li><strong>Vercel</strong> hosts the website and API.</li>
              <li><strong>Supabase</strong> provides the database and email sign-in.</li>
              <li><strong>An email delivery provider</strong> configured in Supabase sends sign-in codes.</li>
              <li><strong>Slack</strong> delivers reaction events and the DMs ReactPing sends.</li>
            </ul>
            <p>
              Hosting providers may keep their own operational logs, such as IP addresses and request times. ReactPing's
              own logs exclude tokens, authorization codes, and message content.
            </p>
            <h2>Retention and deletion</h2>
            <ul>
              <li>
                Delivery records older than ${RETENTION_HOURS} hours are purged by our scheduled cleanup job. If that
                job is unavailable, deletion is delayed until it resumes.
              </li>
              <li>
                Disconnecting a workspace deletes its ReactPing data immediately and attempts to revoke its Slack
                tokens. Any incomplete revocation is reported.
              </li>
              <li>
                Deleting your account removes all ReactPing workspaces and records and attempts to delete your sign-in
                identity. If identity deletion fails, the app reports it and asks you to contact support.
              </li>
              <li>If you remove the app or revoke access in Slack, ReactPing wipes the affected tokens.</li>
            </ul>
            <h2>Contact</h2>
            ${supportContact(config)}
          </div>
        </section>`,
    );
  },
};

const terms: Page = {
  path: "/terms",
  file: "terms.html",
  title: "Terms",
  description: "Pilot terms for using ReactPing.",
  render(config) {
    return layout(
      this,
      config,
      html`${pageHead("Terms", "Pilot terms", "The ground rules for trying ReactPing during the free pilot.")}
        <section class="section section-tight">
          <div class="wrap narrow prose">
            ${DRAFT_BANNER}
            <h2>The service</h2>
            <p>
              ReactPing sends Slack direct messages about reactions to your own messages in workspaces you connect. It
              is offered free during a pilot, as is, without an uptime or delivery commitment. Notifications can be
              delayed, duplicated, or missed, and features may change, pause, or end.
            </p>
            <h2>Your responsibilities</h2>
            <ul>
              <li>Connect only workspaces where you are allowed to install apps under that workspace's policies.</li>
              <li>Use only your own email address and Slack account.</li>
              <li>Don't attempt to access other people's data or disrupt the service.</li>
            </ul>
            <h2>Ending use</h2>
            <p>
              You can disconnect workspaces or delete your account at any time from the app. Access may be suspended if
              it is needed to protect the service, its users, or a workspace.
            </p>
            <h2>Relationship to Slack</h2>
            <p>
              ReactPing is independent and not made, sponsored, or endorsed by Slack. Slack's own terms continue to
              apply to your use of Slack.
            </p>
            <h2>Changes and contact</h2>
            <p>These pilot terms will be replaced by final terms before public launch.</p>
            ${supportContact(config)}
          </div>
        </section>`,
    );
  },
};

const app: Page = {
  path: "/app",
  file: "app.html",
  title: "Your ReactPing",
  description: "Sign in to connect Slack workspaces and manage your ReactPing notifications.",
  noindex: true,
  render(config) {
    const browserConfig: BrowserConfig = {
      supabaseUrl: config.supabaseUrl,
      supabasePublishableKey: config.supabasePublishableKey,
      installEnabled: config.installEnabled,
    };
    // JSON in a non-executable script tag; "<" is escaped so the content can't close the tag.
    const configJson = JSON.stringify(browserConfig).replace(/</g, "\\u003c");
    return layout(
      this,
      config,
      html`<section class="section app-section">
        <div class="wrap narrow">
          <h1 class="app-title">Your ReactPing</h1>
          <div id="app" class="app" aria-live="polite">
            <p class="muted">Loading…</p>
            <noscript><p class="notice">The ReactPing app needs JavaScript to sign you in.</p></noscript>
          </div>
        </div>
      </section>`,
      html`<script id="reactping-config" type="application/json">
          ${new SafeHtml(configJson)}
        </script>
        <script src="/assets/app.js" defer></script>`,
    );
  },
};

const notFound: Page = {
  path: "/404",
  file: "404.html",
  title: "Page not found",
  description: "This page does not exist.",
  noindex: true,
  render(config) {
    return layout(
      this,
      config,
      html`${pageHead("404", "That page doesn't exist", html`Try the <a href="/">home page</a> or the <a href="/faq">FAQ</a>.`)}`,
    );
  },
};

export const PAGES: Page[] = [home, features, install, faq, about, privacy, terms, app, notFound];
