// Shared page chrome and head tags. Every page is a static server component; none of this ships client code.
import type { Metadata } from "next";

export const SITE_URL = "https://reactping.com";
const SOCIAL_CARD = `${SITE_URL}/assets/social-card.png?v=2`;

/** Head tags for a shareable, indexable page: canonical URL plus complete link-preview tags. */
export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }) {
  const url = `${SITE_URL}${path}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: "max-image-preview:large, max-snippet:-1, max-video-preview:-1",
    openGraph: {
      type: "website",
      siteName: "ReactPing",
      url,
      title,
      description,
      images: [{ url: SOCIAL_CARD, width: 1200, height: 630, alt: "ReactPing: reaction notifications for Slack" }],
    },
    twitter: { card: "summary_large_image", title, description, images: [SOCIAL_CARD] },
  } satisfies Metadata;
}

/** Skip link and site header. The connect page drops the nav so nothing distracts from its one button. */
export function Header({ nav = true }: { nav?: boolean }) {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header wrap">
        <a className="brand" href="/" aria-label="ReactPing home">
          <svg className="logo" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false">
            <path d="M6 5h20a4 4 0 0 1 4 4v11a4 4 0 0 1-4 4H14l-6.5 5v-5H6a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z" />
            <circle className="logo-dot" cx="23" cy="9.5" r="5" />
          </svg>
          <span>ReactPing</span>
        </a>
        {nav && (
          <nav aria-label="Main">
            <a className="nav-extra" href="/how-it-works">
              How it works
            </a>
            <a className="nav-extra" href="/security">
              Security
            </a>
            <a href="/feedback">Feedback</a>
            <a className="btn btn-small" href="/connect">
              Add to Slack
            </a>
          </nav>
        )}
      </header>
    </>
  );
}

export function Footer() {
  return (
    <footer className="site-footer wrap">
      <p>Free forever. MIT licensed.</p>
      <nav aria-label="Footer">
        <a className="btn btn-quiet btn-small" href="/">
          Home
        </a>
        <a className="btn btn-quiet btn-small" href="/how-it-works">
          How it works
        </a>
        <a className="btn btn-quiet btn-small" href="/security">
          Security
        </a>
        <a className="btn btn-quiet btn-small" href="/privacy">
          Privacy
        </a>
        <a className="btn btn-quiet btn-small" href="/feedback">
          Feedback
        </a>
        <a className="btn btn-quiet btn-small" href="/changelog">
          Changelog
        </a>
        <a className="btn btn-quiet btn-small" href="https://github.com/ElliotDrel/reactping">
          Source code
        </a>
        <a className="btn btn-quiet btn-small" href="https://elliotdrel.com/projects/reactping">
          Made by Elliot Drel
        </a>
      </nav>
    </footer>
  );
}
