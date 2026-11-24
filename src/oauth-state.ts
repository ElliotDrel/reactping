import { hmac, randomToken, safeEqual } from "./crypto.ts";

export const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const FORMAT = /^v1\.([A-Za-z0-9_-]{43})\.(\d{10})\.([A-Za-z0-9_-]{43})$/;

/**
 * Stateless OAuth CSRF protection. The `state` sent to Slack is a random nonce; the browser that started the
 * install holds an HttpOnly cookie carrying the same nonce and an expiry, signed with a key derived for this
 * purpose only. The callback accepts only a matching, unexpired, untampered pair, so a callback opened in
 * another browser, or after the link expires, fails. Nothing is stored in the database.
 */
export function createOAuthState(key: Buffer, nowMs: number): { state: string; cookie: string } {
  const nonce = randomToken();
  const expires = Math.floor(nowMs / 1000) + OAUTH_STATE_TTL_SECONDS;
  const payload = `v1.${nonce}.${expires}`;
  return { state: nonce, cookie: `${payload}.${hmac(key, payload, "base64url")}` };
}

export function verifyOAuthState(
  key: Buffer,
  cookie: string | undefined,
  state: string | null,
  nowMs: number,
): boolean {
  const match = cookie ? FORMAT.exec(cookie) : null;
  if (!match || !state) return false;
  const [, nonce, expires, mac] = match;
  if (!safeEqual(mac!, hmac(key, `v1.${nonce}.${expires}`, "base64url"))) return false;
  if (Number(expires) <= Math.floor(nowMs / 1000)) return false;
  return safeEqual(nonce!, state);
}
