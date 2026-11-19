import { log } from "./log.ts";

/** Posts a message to the operator's alerts channel (a Slack incoming webhook). Failures are logged, never thrown. */
export async function postAlert(webhookUrl: string, text: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    const res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) log("warn", "alert_failed", { status: res.status });
  } catch (error) {
    log("warn", "alert_failed", { error: (error as Error)?.name });
  }
}
