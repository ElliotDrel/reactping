import { createApi, type Handler } from "./api.ts";
import { supabaseUserVerifier } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { deriveKey } from "./crypto.ts";
import { createPool, Store } from "./db.ts";
import { log } from "./log.ts";
import { createSlackApi } from "./slack.ts";

/** Builds the API from environment variables. Missing or invalid configuration yields a fail-closed API. */
export function createApiFromEnv(env: NodeJS.ProcessEnv, background: (task: () => Promise<unknown>) => void): Handler {
  const loaded = loadConfig(env);
  if (!loaded.ok) {
    // Names and reasons only; values are never logged.
    log("error", "not_configured", { problems: loaded.problems.join("; ") });
    return createApi(null);
  }
  const { config } = loaded;
  return createApi({
    config,
    store: new Store(createPool(config.databaseUrl), deriveKey(config.encryptionKey, "tokens")),
    slack: createSlackApi({ clientId: config.slackClientId, clientSecret: config.slackClientSecret }),
    verifyUser: supabaseUserVerifier(config.supabaseUrl, config.supabasePublishableKey),
    background,
  });
}
