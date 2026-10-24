import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { loadConfig } from "./config.ts";
import { deriveKey } from "./crypto.ts";
import { Store } from "./db.ts";
import { DeliveryWorker } from "./delivery.ts";
import { log } from "./log.ts";
import { createSlackApi } from "./slack.ts";
import { createHandler } from "./web.ts";

const config = loadConfig();
const store = new Store(config.databasePath, deriveKey(config.encryptionKey, "tokens"));
const slack = createSlackApi({ clientId: config.slackClientId, clientSecret: config.slackClientSecret });
const worker = new DeliveryWorker(store, slack);
const drain = () =>
  void worker.runOnce().catch((error: unknown) => log("error", "worker_failed", { error: (error as Error)?.name }));

const handler = createHandler({ config, store, slack, onEnqueued: drain });
// Usually TLS terminates at a proxy or tunnel; set TLS_CERT_FILE/TLS_KEY_FILE to serve HTTPS directly.
const server =
  config.tlsCertFile && config.tlsKeyFile
    ? createHttpsServer({ cert: readFileSync(config.tlsCertFile), key: readFileSync(config.tlsKeyFile) }, handler)
    : createHttpServer(handler);

const drainTimer = setInterval(drain, 2_000);
const purge = () => store.purgeExpired(config.retentionHours * 60 * 60 * 1000);
purge();
const purgeTimer = setInterval(purge, 60 * 60 * 1000);

server.listen(config.port, () =>
  log("info", "listening", {
    port: config.port,
    baseUrl: config.baseUrl,
    includeSelfReactions: config.includeSelfReactions,
  }),
);

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(drainTimer);
  clearInterval(purgeTimer);
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeIdleConnections();
  await Promise.all([closed, worker.stop()]);
  store.close();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
