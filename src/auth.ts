export interface AuthUser {
  id: string;
  email: string | null;
}

/** Resolves a Supabase access token to its user, or null when Supabase Auth rejects the token. */
export type VerifyUser = (accessToken: string) => Promise<AuthUser | null>;

/**
 * Asks Supabase Auth who the token belongs to. This works with both asymmetric and legacy JWT signing
 * keys. Access tokens can remain valid until expiry after sign-out; this does not promise immediate session revocation. Only the publishable key is needed.
 */
export function supabaseUserVerifier(supabaseUrl: string, publishableKey: string, fetchImpl = fetch): VerifyUser {
  return async (accessToken) => {
    const res = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: publishableKey, authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 401 || res.status === 403 || res.status === 404) return null;
    if (!res.ok) throw new Error(`supabase_auth_${res.status}`);
    const body = (await res.json()) as { id?: unknown; email?: unknown };
    if (typeof body.id !== "string" || !body.id) return null;
    return { id: body.id, email: typeof body.email === "string" ? body.email : null };
  };
}
