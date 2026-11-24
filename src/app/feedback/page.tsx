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
        <h1>Give us feedback</h1>
        <p className="lede">Found a bug? Have an idea? We'd love to hear it.</p>
        <FeedbackForm />
        <p className="hint">Need help? Email elliotdrel@gmail.com.</p>
      </main>

      <Footer />
    </>
  );
}
