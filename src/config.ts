/** Minimal reaction/delivery records are kept this long. The privacy page states the same constant. */
export const RETENTION_HOURS = 48;

export interface Config {
  /** Canonical public origin (no trailing slash). Slack OAuth and event URLs live under it. */
  siteUrl: string;
  databaseUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  slackClientId: string;
  slackClientSecret: string;
  slackSigningSecret: string;
  encryptionKey: Buffer;
  deliveryCronSecret: string;
  /** Operator flag. Off by default; the browser launch flag never turns it on. */
  installsEnabled: boolean;
  /** Testing only: also notify about reactions you add to your own messages. */
  includeSelfReactions: boolean;
}

export type ConfigResult = { ok: true; config: Config } | { ok: false; problems: string[] };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Parses an origin, requiring https except for local development hosts. */
export function parseOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    throw new Error("must use https (http is allowed only for localhost)");
  }
  return url.origin;
}

/**
 * Rejects anything that looks like a Supabase secret or service-role key, so it can never be shipped to
 * the browser or used where a publishable key belongs.
 */
export function assertPublishableKey(key: string): void {
  if (key.startsWith("sb_secret_")) throw new Error("is a Supabase secret key, not a publishable key");
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as { role?: unknown };
      if (payload.role !== "anon") throw new Error("is a Supabase JWT key whose role is not anon");
    } catch (error) {
      throw error instanceof SyntaxError ? new Error("is not a valid Supabase key") : error;
    }
  }
}

export function parseFlag(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name]?.trim() || "false";
  if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false`);
  return value === "true";
}

/** Loads server configuration. Never throws: a missing or invalid value makes the API report not configured. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConfigResult {
  const problems: string[] = [];
  /** Reads a required value; `parse` validates it and may normalize it. */
  const read = (name: string, parse: (value: string) => string | void = () => {}): string => {
    const value = env[name]?.trim() ?? "";
    if (!value) {
      problems.push(`${name} is missing`);
      return "";
    }
    try {
      return parse(value) ?? value;
    } catch (error) {
      problems.push(`${name} ${(error as Error).message}`);
      return "";
    }
  };
  const flag = (name: string): boolean => {
    try {
      return parseFlag(env, name);
    } catch (error) {
      problems.push((error as Error).message);
      return false;
    }
  };

  const encryptionKey = Buffer.from(
    read("ENCRYPTION_KEY", (v) => {
      if (Buffer.from(v, "base64").length !== 32) throw new Error("must be 32 bytes, base64-encoded");
    }),
    "base64",
  );
  const config: Config = {
    siteUrl: read("PUBLIC_SITE_URL", parseOrigin),
    databaseUrl: read("DATABASE_URL"),
    supabaseUrl: read("PUBLIC_SUPABASE_URL", parseOrigin),
    supabasePublishableKey: read("PUBLIC_SUPABASE_PUBLISHABLE_KEY", assertPublishableKey),
    slackClientId: read("SLACK_CLIENT_ID"),
    slackClientSecret: read("SLACK_CLIENT_SECRET"),
    slackSigningSecret: read("SLACK_SIGNING_SECRET"),
    encryptionKey,
    deliveryCronSecret: read("DELIVERY_CRON_SECRET", (v) => {
      if (v.length < 32) throw new Error("must be at least 32 characters");
    }),
    installsEnabled: flag("REACTPING_INSTALLS_ENABLED"),
    includeSelfReactions: flag("INCLUDE_SELF_REACTIONS"),
  };
  return problems.length ? { ok: false, problems } : { ok: true, config };
}
