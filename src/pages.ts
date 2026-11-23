/** The small HTML pages the OAuth callback returns. Static text and Slack links built from validated IDs. */

export type Outcome = "connected" | "cancelled" | "expired" | "failed" | "enterprise" | "scopes" | "feedback" | "already" | "approval" | "workspace";

const COPY: Record<Outcome, { title: string; body: string }> = {
  connected: {
    title: "You're connected!",
    body: "You'll now receive reaction notifications.",
  },
  already: {
    title: "You're already connected!",
    body: "ReactPing is actively monitoring reactions to your messages.",
  },
  approval: {
    title: "Administrator approval required",
    body: "Your workspace requires approval before you can connect ReactPing.",
  },
  workspace: {
    title: "Wrong workspace",
    body: "Return to Slack and open the connection link for the workspace you want to connect.",
  },
  cancelled: {
    title: "Nothing was installed",
    body: "You cancelled on Slack's approval screen, so ReactPing has no access. You can add it again any time.",
  },
  expired: {
    title: "This link expired",
    body: "For your security, Add to Slack has to be finished in the same browser within 10 minutes. On mobile, open ReactPing in Safari or Chrome and stay in that browser until you see the connected page. Please start again.",
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
    body: "Slack didn't grant the permissions ReactPing needs, so nothing was saved. Please try again.",
  },
  feedback: {
    title: "Thank you so much for your feedback",
    body: "We will take it into account and get back to you ASAP.",
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

type SlackDestination = { appId: string; teamId: string };

export function resultPage(outcome: Outcome, status: number, cookie: string, destination?: SlackDestination): Response {
  const { title, body } = COPY[outcome];
  const app = destination && encodeURIComponent(destination.appId);
  const team = destination && encodeURIComponent(destination.teamId);
  const actions =
    outcome === "feedback"
      ? [`<a class="btn btn-large" href="/">Back to ReactPing</a>`]
      : outcome === "connected" || outcome === "already"
        ? [
            app && team
              ? `<a class="btn btn-large" href="slack://app?team=${team}&amp;id=${app}&amp;tab=messages">${outcome === "already" ? "Open ReactPing in Slack" : "Open Slack"}</a>`
              : "",
            app && team
              ? `<a class="btn btn-quiet btn-large" href="https://slack.com/app_redirect?app=${app}&amp;team=${team}">Open via Slack website</a>`
              : "",
            outcome === "connected" ? `<a class="btn btn-quiet btn-large" href="${INSTALL_PATH}">Add another workspace</a>` : "",
          ]
        : [
            `<a class="btn btn-large" href="${CONNECT_PATH}">${outcome === "approval" ? "Request approval in Slack" : "Try again"}</a>`,
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
      ${outcome === "connected" || outcome === "already" ? '<p aria-hidden="true">✅</p>' : ""}
      <h1>${title}</h1>
      <p class="lede">${body}</p>
      <div class="actions">${actions.join("")}</div>
      ${outcome === "connected" ? '<p class="note">Want alerts on your phone even while using desktop Slack? In the Slack mobile app, tap your profile picture → Notifications → Notify me on mobile and choose “Immediately, even if I’m active”. Make sure Slack notifications are enabled on your phone.</p>' : ""}
    </main>
  </body>
</html>
`;
  return new Response(html, { status, headers: { ...HEADERS, ...(cookie ? { "set-cookie": cookie } : {}) } });
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * The homepage's live counters as an SVG image: with no client code of its own, an <img> is the simplest way to show
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
