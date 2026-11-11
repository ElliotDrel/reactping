/** Shared execution limits leave room for the last Slack call to finish before Vercel stops the function. */
export const FUNCTION_MAX_DURATION_SECONDS = 30;
export const SLACK_TIMEOUT_MS = 5_000;
export const CRON_DRAIN_BUDGET_MS = 8_000;
export const EVENT_DRAIN_BUDGET_MS = 5_000;
