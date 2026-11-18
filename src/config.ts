export interface Config {
  /** Canonical public origin (no trailing slash). The OAuth redirect and Slack request URLs live under it. */
  siteUrl: string;
  databaseUrl: string;
  databaseCa?: string;
  slackClientId: string;
  slackClientSecret: string;
  slackSigningSecret: string;
  /** 32-byte master key. Purpose-specific keys are derived from it (token encryption, OAuth state cookie). */
  encryptionKey: Buffer;
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

/** TLS is configured explicitly, so URL parameters must not override certificate verification. */
export function parseDatabaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("must be a Postgres URL");
  for (const option of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert"]) {
    if (url.searchParams.has(option))
      throw new Error("must omit SSL query parameters; use DATABASE_CA for a custom CA");
  }
  return value;
}

/** Loads server configuration. Never throws: a missing or invalid value makes every route report not configured. */
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

  // A testing-only flag must never take the service down (Nov 17: a dashboard value the old strict check rejected
  // made every route 503). Accept true in any case, with or without quotes; anything else means off, the safe
  // default. When it's on, the Home tab says "Testing mode is on", so a value that didn't take is visible.
  const selfReactions = (env.INCLUDE_SELF_REACTIONS ?? "")
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2")
    .toLowerCase();

  const encryptionKey = Buffer.from(
    read("ENCRYPTION_KEY", (v) => {
      if (Buffer.from(v, "base64").length !== 32) throw new Error("must be 32 bytes, base64-encoded");
    }),
    "base64",
  );
  const config: Config = {
    siteUrl: read("PUBLIC_SITE_URL", parseOrigin),
    databaseUrl: read("DATABASE_URL", parseDatabaseUrl),
    databaseCa: env.DATABASE_CA?.trim() || undefined,
    slackClientId: read("SLACK_CLIENT_ID"),
    slackClientSecret: read("SLACK_CLIENT_SECRET"),
    slackSigningSecret: read("SLACK_SIGNING_SECRET"),
    encryptionKey,
    includeSelfReactions: selfReactions === "true",
  };
  return problems.length ? { ok: false, problems } : { ok: true, config };
}
