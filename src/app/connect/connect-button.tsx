"use client";

import { posthog } from "posthog-js";

const posthogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

export function ConnectButton() {
  function startSlackInstall() {
    if (posthogConfigured) {
      posthog.capture("slack_install_started", { entry_point: "connect_page" });
    }
  }

  return (
    <a className="btn btn-large" href="/api/slack/install" onClick={startSlackInstall}>
      Continue to Slack
    </a>
  );
}
