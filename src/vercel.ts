import { attachDatabasePool, waitUntil } from "@vercel/functions";
import { PostHog } from "posthog-node";
import { postAlert } from "./alert.ts";
import { loadConfig } from "./config.ts";
import { deriveKey } from "./crypto.ts";
import { createPool, Store } from "./db.ts";
import { createHandler, type Handler } from "./handler.ts";
import { log } from "./log.ts";
import { createSlackApi } from "./slack.ts";

let handler: Handler | undefined;
let posthog: PostHog | null | undefined;

/** Returns the process-local client without allowing absent analytics configuration to affect the Slack app. */
function getPostHogClient(): PostHog | undefined {
  if (posthog !== undefined) return posthog ?? undefined;

  const token = process.env.POSTHOG_PROJECT_TOKEN;
  const host = process.env.POSTHOG_HOST;
  if (!token || !host) {
    if (process.env.NODE_ENV !== "production") {
      const missingVariable = token ? "POSTHOG_HOST" : "POSTHOG_PROJECT_TOKEN";
      console.error(
        `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
      );
    }
    posthog = null;
    return undefined;
  }

  posthog = new PostHog(token, {
    host,
    enableExceptionAutocapture: true,
    flushAt: 1,
    flushInterval: 0,
    requestTimeout: 2_000,
    fetchRetryCount: 0,
  });
  return posthog;
}

/** Builds the shared handler once per function instance from environment variables. */
function getHandler(): Handler {
  if (handler) return handler;
  const loaded = loadConfig(process.env);
  if (!loaded.ok) {
    // Names and reasons only; values are never logged.
    log("error", "not_configured", { problems: loaded.problems.join("; ") });
    return (handler = createHandler(null));
  }
  const { config } = loaded;
  const pool = createPool(config.databaseUrl, config.databaseCa);
  // Lets Fluid compute release idle clients before an instance suspends.
  attachDatabasePool(pool);
  return (handler = createHandler({
    config,
    store: new Store(pool, deriveKey(config.encryptionKey, "installation-tokens")),
    slack: createSlackApi({ clientId: config.slackClientId, clientSecret: config.slackClientSecret }),
    posthog: getPostHogClient(),
    background: (task) => waitUntil(task()),
    alert: config.alertWebhookUrl ? (text) => postAlert(config.alertWebhookUrl!, text) : undefined,
  }));
}

/** Entry for src/app/api/[...path]/route.ts: the shared handler checks method and path. */
export function handle(request: Request): Promise<Response> {
  return getHandler()(request);
}
