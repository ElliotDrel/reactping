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

/** Every new connection, success or retry, goes through the static /connect instructions first. */
export const CONNECT_PATH = "/connect";

export function resultPage(outcome: Outcome, status: number, cookie: string, slackLink?: string): Response {
  const { title, body } = COPY[outcome];
  const actions =
    outcome === "connected"
      ? [
          slackLink
            ? `<a class="btn btn-large" href="${slackLink.replace(/&/g, "&amp;")}">Open ReactPing in Slack</a>`
            : "",
          `<a class="btn btn-quiet btn-large" href="${CONNECT_PATH}">Add another workspace</a>`,
        ]
      : [
          `<a class="btn btn-large" href="${CONNECT_PATH}">Try again</a>`,
          `<a class="btn btn-quiet btn-large" href="/">Back to ReactPing</a>`,
        ];
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
    <header class="site-header wrap"><a class="brand" href="/">ReactPing</a></header>
    <main id="main" class="page wrap">
      <h1>${title}</h1>
      <p class="lede">${body}</p>
      <div class="actions">${actions.join("")}</div>
    </main>
  </body>
</html>
`;
  return new Response(html, { status, headers: { ...HEADERS, "set-cookie": cookie } });
}
