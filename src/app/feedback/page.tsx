import type { Metadata } from "next";
import { FeedbackForm } from "./feedback-form.tsx";
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
        <FeedbackForm />
        <p className="hint">Need help? Email elliotdrel@gmail.com.</p>
      </main>

      <Footer />
    </>
  );
}
