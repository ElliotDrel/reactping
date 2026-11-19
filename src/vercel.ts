import { attachDatabasePool, waitUntil } from "@vercel/functions";
import { postAlert } from "./alert.ts";
import { loadConfig } from "./config.ts";
import { deriveKey } from "./crypto.ts";
import { createPool, Store } from "./db.ts";
import { createHandler, type Handler } from "./handler.ts";
import { log } from "./log.ts";
import { createSlackApi } from "./slack.ts";

let handler: Handler | undefined;

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
    background: (task) => waitUntil(task()),
    alert: config.alertWebhookUrl ? (text) => postAlert(config.alertWebhookUrl!, text) : undefined,
  }));
}

/** Entry for src/app/api/[...path]/route.ts: the shared handler checks method and path. */
export function handle(request: Request): Promise<Response> {
  return getHandler()(request);
}
