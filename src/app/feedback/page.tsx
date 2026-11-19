import type { Metadata } from "next";
import { Footer, Header } from "../site.tsx";

// A form, not content: no canonical URL, so search engines skip it.
export const metadata: Metadata = {
  title: "Send feedback to ReactPing",
  description: "Tell us what would make ReactPing better. Every message is read.",
  robots: "noindex, nofollow",
};

export default function Feedback() {
  return (
    <>
      <Header />

      <main id="main" className="page wrap">
        <h1>Send feedback</h1>
        <p className="lede">What's working, what's not, what you'd add. Every message is read.</p>
        <form className="form" method="post" action="/api/feedback">
          <label htmlFor="message">Your feedback</label>
          <textarea id="message" name="message" rows={6} maxLength={5000} required></textarea>
          <p className="hint">Want to hear back when it ships? Add your name and email. Both optional.</p>
          <label htmlFor="name">
            Name <span>(optional)</span>
          </label>
          <input id="name" name="name" type="text" maxLength={100} autoComplete="name" />
          <label htmlFor="email">
            Email <span>(optional)</span>
          </label>
          <input id="email" name="email" type="email" maxLength={254} autoComplete="email" />
          <button className="btn btn-large" type="submit">
            Send feedback
          </button>
        </form>
        <p className="hint">Need help? Email elliotdrel@gmail.com.</p>
      </main>

      <Footer />
    </>
  );
}
