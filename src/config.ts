export interface Config {
  baseUrl: string;
  port: number;
  databasePath: string;
  slackClientId: string;
  slackClientSecret: string;
  slackSigningSecret: string;
  encryptionKey: Buffer;
  retentionHours: number;
  tlsCertFile?: string;
  tlsKeyFile?: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrl = new URL(required(env, "BASE_URL"));
  if (baseUrl.protocol !== "https:" && !(baseUrl.protocol === "http:" && baseUrl.hostname === "localhost")) {
    throw new Error("BASE_URL must use https (Slack requires HTTPS redirect and event URLs)");
  }
  const encryptionKey = Buffer.from(required(env, "ENCRYPTION_KEY"), "base64");
  if (encryptionKey.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  }
  const retentionHours = Number(env.RETENTION_HOURS ?? 48);
  if (!Number.isFinite(retentionHours) || retentionHours < 1) {
    throw new Error("RETENTION_HOURS must be a number >= 1");
  }
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535");
  if (Boolean(env.TLS_CERT_FILE) !== Boolean(env.TLS_KEY_FILE))
    throw new Error("Set both TLS_CERT_FILE and TLS_KEY_FILE");
  return {
    baseUrl: baseUrl.origin,
    port,
    databasePath: env.DATABASE_PATH ?? "./data/reactping.sqlite",
    slackClientId: required(env, "SLACK_CLIENT_ID"),
    slackClientSecret: required(env, "SLACK_CLIENT_SECRET"),
    slackSigningSecret: required(env, "SLACK_SIGNING_SECRET"),
    encryptionKey,
    retentionHours,
    tlsCertFile: env.TLS_CERT_FILE || undefined,
    tlsKeyFile: env.TLS_KEY_FILE || undefined,
  };
}
