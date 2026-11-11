import { html, type SafeHtml } from "../src/html.ts";
import type { PublicConfig } from "./public-config.ts";

export interface PageMeta {
  /** URL path, e.g. "/features". */
  path: string;
  title: string;
  description: string;
  /** Never index this page (for example /app). */
  noindex?: boolean;
}

const NAV = [
  ["/features", "Features"],
  ["/install", "Install"],
  ["/faq", "FAQ"],
  ["/about", "About"],
] as const;

export const LOGO = html`<svg
  class="logo"
  viewBox="0 0 32 32"
  width="28"
  height="28"
  aria-hidden="true"
  focusable="false"
>
  <path d="M6 5h20a4 4 0 0 1 4 4v11a4 4 0 0 1-4 4H14l-6.5 5v-5H6a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z" fill="currentColor" />
  <circle cx="22.5" cy="9.5" r="5" fill="var(--accent-bright)" stroke="var(--bg)" stroke-width="2.5" />
</svg>`;

function header(path: string): SafeHtml {
  return html`<header class="site-header">
    <div class="wrap header-inner">
      <a class="brand" href="/" aria-label="ReactPing home">${LOGO}<span>ReactPing</span></a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">
        <span class="nav-toggle-bars" aria-hidden="true"></span><span class="sr-only">Menu</span>
      </button>
      <nav id="site-nav" class="site-nav" aria-label="Main">
        <ul>
          ${NAV.map(
            ([href, label]) =>
              html`<li><a href="${href}" ${path === href ? html`aria-current="page"` : ""}>${label}</a></li>`,
          )}
        </ul>
        <a class="btn btn-primary btn-small" href="/install">Add to Slack</a>
      </nav>
    </div>
  </header>`;
}

function footer(): SafeHtml {
  return html`<footer class="site-footer">
    <div class="wrap footer-inner">
      <div class="footer-brand">
        <a class="brand" href="/">${LOGO}<span>ReactPing</span></a>
        <p>A DM when someone reacts to your Slack messages.</p>
      </div>
      <nav aria-label="Footer">
        <ul>
          <li><a href="/features">Features</a></li>
          <li><a href="/install">Install</a></li>
          <li><a href="/faq">FAQ</a></li>
          <li><a href="/faq#support">Support</a></li>
          <li><a href="/about">About</a></li>
          <li><a href="/privacy">Privacy</a></li>
          <li><a href="/terms">Terms</a></li>
          <li><a href="/app">Open app</a></li>
        </ul>
      </nav>
      <p class="fine">
        ReactPing is an independent project. It is not made, sponsored, or endorsed by Slack. Slack is a trademark of
        Slack Technologies, LLC.
      </p>
    </div>
  </footer>`;
}

export function layout(meta: PageMeta, config: PublicConfig, main: SafeHtml, extraHead: SafeHtml | "" = ""): string {
  const canonical = config.siteUrl ? `${config.siteUrl}${meta.path === "/" ? "/" : meta.path}` : null;
  const image = config.siteUrl ? `${config.siteUrl}/assets/social-card.png` : "/assets/social-card.png";
  const fullTitle = meta.path === "/" ? `ReactPing · ${meta.title}` : `${meta.title} · ReactPing`;
  const robots = config.indexable && !meta.noindex ? "index, follow" : "noindex, nofollow";
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${fullTitle}</title>
        <meta name="description" content="${meta.description}" />
        <meta name="robots" content="${robots}" />
        ${canonical ? html`<link rel="canonical" href="${canonical}" />` : ""}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="ReactPing" />
        <meta property="og:title" content="${fullTitle}" />
        <meta property="og:description" content="${meta.description}" />
        ${canonical ? html`<meta property="og:url" content="${canonical}" />` : ""}
        <meta property="og:image" content="${image}" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="ReactPing: a DM when someone reacts to your Slack messages." />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="theme-color" content="#FAF6EE" />
        <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/assets/styles.css" />
        <script src="/assets/site.js" defer></script>
        ${extraHead}
      </head>
      <body>
        <a class="skip-link" href="#main">Skip to content</a>
        ${header(meta.path)}
        <main id="main">${main}</main>
        ${footer()}
      </body>
    </html>`.value;
}
