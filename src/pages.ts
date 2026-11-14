/** The small HTML pages the OAuth callback returns. Static text only; the one link is built from validated IDs. */

export type Outcome = "connected" | "cancelled" | "expired" | "failed" | "enterprise" | "scopes";

const COPY: Record<Outcome, { title: string; body: string }> = {
  connected: {
    title: "ReactPing is connected",
    body: "Check Slack for a welcome DM from ReactPing. From now on, when someone else reacts to one of your messages in this workspace, you'll get a DM there. To disconnect, open ReactPing's Home tab in Slack.",
  },
  cancelled: {
    title: "Nothing was installed",
    body: "You cancelled on Slack's approval screen, so ReactPing has no access. You can add it again any time.",
  },
  expired: {
    title: "This link expired",
    body: "For your security, Add to Slack has to be finished in the same browser within 10 minutes. Please start again.",
  },
  failed: {
    title: "Slack couldn't finish connecting",
    body: "Nothing was saved. Please try Add to Slack again in a minute.",
  },
  enterprise: {
    title: "Enterprise Grid isn't supported",
    body: "ReactPing works with standard Slack workspaces only. Nothing was saved.",
  },
  scopes: {
    title: "Permissions missing",
    body: "Slack didn't grant the two permissions ReactPing needs, so nothing was saved. Please try again.",
  },
};

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  // The callback URL carries the one-time OAuth code; never send it onward.
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

export function resultPage(outcome: Outcome, status: number, cookie: string, slackLink?: string): Response {
  const { title, body } = COPY[outcome];
  const action =
    outcome === "connected"
      ? slackLink
        ? `<a class="btn btn-primary btn-large" href="${slackLink.replace(/&/g, "&amp;")}">Open ReactPing in Slack</a>`
        : ""
      : `<a class="btn btn-primary btn-large" href="/api/slack/install">Add to Slack</a>`;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${title} · ReactPing</title>
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/assets/styles.css" />
  </head>
  <body>
    <main id="main">
      <section class="page-head">
        <div class="wrap narrow">
          <p class="eyebrow"><a href="/">ReactPing</a></p>
          <h1>${title}</h1>
          <p class="lede">${body}</p>
          <div class="hero-actions">${action}<a class="btn btn-quiet btn-large" href="/">Back to ReactPing</a></div>
        </div>
      </section>
    </main>
  </body>
</html>
`;
  return new Response(html, { status, headers: { ...HEADERS, "set-cookie": cookie } });
}
