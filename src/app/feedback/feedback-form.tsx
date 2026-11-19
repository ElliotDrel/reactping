"use client";

import { posthog } from "posthog-js";

const posthogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

export function FeedbackForm() {
  function captureSubmission() {
    if (posthogConfigured) {
      posthog.capture("feedback_submission_started", { source: "website" });
    }
  }

  return (
    <form className="form" method="post" action="/api/feedback" onSubmit={captureSubmission}>
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
  );
}
