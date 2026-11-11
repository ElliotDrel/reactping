import { assertPublishableKey, parseFlag, parseOrigin } from "../src/config.ts";

/**
 * Build-time, browser-safe configuration. Only PUBLIC_* variables (and Vercel's VERCEL_ENV) are read here,
 * so server secrets and operator flags cannot reach generated pages or bundles.
 */
export interface PublicConfig {
  siteUrl: string | null;
  indexable: boolean;
  installEnabled: boolean;
  supabaseUrl: string | null;
  supabasePublishableKey: string | null;
  supportEmail: string | null;
}

/** The only fields embedded in the /app page for the browser client. */
export type BrowserConfig = Pick<PublicConfig, "supabaseUrl" | "supabasePublishableKey" | "installEnabled">;

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export function loadPublicConfig(env: NodeJS.ProcessEnv): PublicConfig {
  const value = (name: string) => env[name]?.trim() || null;
  const origin = (name: string) => {
    const raw = value(name);
    if (!raw) return null;
    try {
      return parseOrigin(raw);
    } catch (error) {
      throw new Error(`${name} ${(error as Error).message}`, { cause: error });
    }
  };
  const siteUrl = origin("PUBLIC_SITE_URL");
  const supabaseUrl = origin("PUBLIC_SUPABASE_URL");
  const supabasePublishableKey = value("PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (supabasePublishableKey) {
    try {
      assertPublishableKey(supabasePublishableKey);
    } catch (error) {
      throw new Error(`PUBLIC_SUPABASE_PUBLISHABLE_KEY ${(error as Error).message}`, { cause: error });
    }
  }
  if (Boolean(supabaseUrl) !== Boolean(supabasePublishableKey)) {
    throw new Error("Set both PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY, or neither");
  }
  const supportEmail = value("PUBLIC_SUPPORT_EMAIL");
  if (supportEmail && !EMAIL.test(supportEmail)) throw new Error("PUBLIC_SUPPORT_EMAIL is not an email address");
  const wantsIndex = parseFlag(env, "PUBLIC_SITE_INDEXABLE");
  if (wantsIndex && !siteUrl) throw new Error("PUBLIC_SITE_INDEXABLE=true requires PUBLIC_SITE_URL");
  // Vercel preview and development builds are never indexable, whatever the flag says.
  const vercelEnv = value("VERCEL_ENV");
  return {
    siteUrl,
    indexable: wantsIndex && (vercelEnv === null || vercelEnv === "production"),
    installEnabled: parseFlag(env, "PUBLIC_INSTALL_ENABLED"),
    supabaseUrl,
    supabasePublishableKey,
    supportEmail,
  };
}
