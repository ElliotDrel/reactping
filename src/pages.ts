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
/** Straight to Slack's approval page. Used after a successful install, when the person has already seen /connect. */
export const INSTALL_PATH = "/api/slack/install";

export function resultPage(outcome: Outcome, status: number, cookie: string, slackLink?: string): Response {
  const { title, body } = COPY[outcome];
  const actions =
    outcome === "connected"
      ? [
          slackLink
            ? `<a class="btn btn-large" href="${slackLink.replace(/&/g, "&amp;")}">Open ReactPing in Slack</a>`
            : "",
          `<a class="btn btn-quiet btn-large" href="${INSTALL_PATH}">Add another workspace</a>`,
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

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * The homepage's live counters as an SVG image: the site runs no scripts, so an <img> is the simplest way to show
 * a number that changes. Contains only two totals; cached at the edge so page views rarely reach the database.
 */
export function statsImage(stats: { workspaces: number; notifications: number }): Response {
  const workspaces = plural(stats.workspaces, "workspace", "workspaces");
  const sent = plural(stats.notifications, "reaction notification", "reaction notifications");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="32" viewBox="0 0 640 32" role="img" aria-label="In ${workspaces}. ${sent} sent.">
  <text x="0" y="22" font-family="Segoe UI, -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif" font-size="18" fill="#44506a">In <tspan font-weight="800" fill="#0f1d3a">${workspaces}</tspan> · <tspan font-weight="800" fill="#0f1d3a">${sent}</tspan> sent</text>
</svg>
`;
  return new Response(svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
