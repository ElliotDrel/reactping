import { randomToken } from "./crypto.ts";

const VISITOR_ID = /^[\w.:@-]{1,200}$/;

/** The visitor's PostHog ID, from the cookie PostHog's browser SDK sets on this site. */
export function posthogVisitor(token: string, cookieHeader: string | null): string | undefined {
  const name = `ph_${token}_posthog=`;
  const raw = (cookieHeader ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(name))
    ?.slice(name.length);
  if (!raw) return undefined;
  try {
    const id: unknown = JSON.parse(decodeURIComponent(raw)).distinct_id;
    return typeof id === "string" && VISITOR_ID.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Records a completed Slack install under the visitor's PostHog ID, so PostHog ties it to the visit and the
 * referrer, UTM tag, or ?r= link that led to it. No cookie (blocked or never loaded) still counts the install,
 * unattributed. Sends no Slack IDs.
 */
export async function captureInstall(
  token: string,
  host: string,
  cookieHeader: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(`${host.replace(/\/$/, "")}/i/v0/e/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: token,
      event: "slack_installed",
      distinct_id: posthogVisitor(token, cookieHeader) ?? `install_${randomToken()}`,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`posthog_${res.status}`);
}
