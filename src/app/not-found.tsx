import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found · ReactPing",
  robots: "noindex, nofollow",
};

export default function NotFound() {
  return (
    <main id="main" className="page wrap">
      <h1>That page doesn't exist</h1>
      <div className="actions">
        <a className="btn btn-large" href="/">
          Go to the home page
        </a>
        <a className="btn btn-quiet btn-large" href="/feedback">
          Report a broken link
        </a>
      </div>
    </main>
  );
}
