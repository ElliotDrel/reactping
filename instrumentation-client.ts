// PostHog website analytics: page views, referrers, UTM tags, and ?r= short links. Off when the token isn't set.
import { posthog } from "posthog-js";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (token && host) {
  posthog.init(token, {
    api_host: host,
    defaults: "2026-08-30",
    capture_exceptions: true,
    // The privacy page promises visit counts and referrers, not recordings of what visitors do.
    disable_session_recording: true,
    // reactping.com/?r=elliot counts like utm_source=elliot, so shared links stay short.
    custom_campaign_params: ["r"],
  });
}
