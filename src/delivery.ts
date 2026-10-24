import type { Delivery, Installation, Store } from "./db.ts";
import { log } from "./log.ts";
import { classifySlackError, type SlackApi } from "./slack.ts";

export const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 10_000;
const MAX_DELAY_MS = 15 * 60_000;

export function backoffMs(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
}

/** Escapes Slack mrkdwn control characters in untrusted text. */
export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function safeSlackUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname;
    if (url.protocol !== "https:" || !(host === "slack.com" || host.endsWith(".slack.com"))) return null;
    return /[<>|\s]/.test(url.href) ? null : url.href;
  } catch {
    return null;
  }
}

/** Documented fallback when chat.getPermalink fails: the workspace archive URL for the message. */
export function fallbackPermalink(teamUrl: string | null, channelId: string, messageTs: string): string | null {
  const base = safeSlackUrl(teamUrl);
  if (!base) return null;
  return `${base.replace(/\/?$/, "/")}archives/${channelId}/p${messageTs.replace(".", "")}`;
}

/**
 * Picks where to DM the source user. Defaults to the source workspace; a cross-workspace
 * destination is used only with explicit consent and while it is still active and owned.
 */
export function resolveDestination(
  store: Store,
  source: Installation,
): { dest: Installation; crossWorkspace: boolean } {
  const account = store.getAccount(source.accountId);
  const destId = account?.destinationInstallationId;
  if (destId && destId !== source.id) {
    const dest = store.getInstallation(destId);
    if (dest && dest.status === "active" && dest.accountId === source.accountId) {
      if (dest.teamId === source.teamId) return { dest, crossWorkspace: false };
      if (account.crossWorkspaceConsentAt) return { dest, crossWorkspace: true };
    }
  }
  return { dest: source, crossWorkspace: false };
}

export function formatNotification(
  d: Pick<Delivery, "reactorId" | "reaction">,
  source: Installation,
  crossWorkspace: boolean,
  permalink: string | null,
): string {
  // Across workspaces the reactor's ID means nothing (and is not resolved via users:read).
  const actor = crossWorkspace ? "Someone" : `<@${d.reactorId}>`;
  const link = permalink ? ` <${escapeMrkdwn(permalink)}|View message>` : " (message link unavailable)";
  return `${actor} reacted :${escapeMrkdwn(d.reaction)}: to your message in *${escapeMrkdwn(source.teamName)}*.${link}`;
}

export class DeliveryWorker {
  private running: Promise<void> | null = null;
  private stopped = false;
  private readonly store: Store;
  private readonly slack: SlackApi;
  private readonly now: () => number;

  constructor(store: Store, slack: SlackApi, now: () => number = Date.now) {
    this.store = store;
    this.slack = slack;
    this.now = now;
  }

  /** Drains due deliveries once. Safe to call on a timer; overlapping calls are skipped. */
  runOnce(batchSize = 20): Promise<void> {
    if (this.stopped || this.running || this.now() < this.store.deliveryPausedUntil()) return Promise.resolve();
    const drain = async () => {
      for (const delivery of this.store.dueDeliveries(batchSize)) {
        if (this.stopped) break;
        if (!(await this.deliver(delivery))) break;
      }
    };
    this.running = drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Stop starting deliveries and finish the in-flight request before closing SQLite. */
  async stop(): Promise<void> {
    this.stopped = true;
    await this.running;
  }

  /** Returns false when the worker should stop this batch (rate limited). */
  private async deliver(d: Delivery): Promise<boolean> {
    const source = this.store.getInstallation(d.sourceInstallationId);
    if (!source || source.status !== "active" || !source.userToken) {
      this.store.finishDelivery(d.id, "failed", "source_revoked");
      return true;
    }
    let credentialOwner = source;
    let credentialKind: "user" | "bot" = "user";
    try {
      const permalink = await this.permalink(source, d);
      // OAuth, disconnect, revocation, or destination changes can happen while Slack is awaited.
      const currentSource = this.store.getInstallation(source.id);
      if (
        !currentSource ||
        currentSource.status !== "active" ||
        currentSource.accountId !== source.accountId ||
        currentSource.userToken !== source.userToken
      ) {
        this.store.finishDelivery(d.id, "failed", "source_changed");
        return true;
      }
      const { dest, crossWorkspace } = resolveDestination(this.store, currentSource);
      if (!dest.botToken) {
        this.store.finishDelivery(d.id, "failed", "destination_revoked");
        return true;
      }
      credentialOwner = dest;
      credentialKind = "bot";
      await this.slack.postMessage(
        dest.botToken,
        dest.userId,
        formatNotification(d, currentSource, crossWorkspace, permalink),
      );
      this.store.finishDelivery(d.id, "sent");
      return true;
    } catch (error) {
      const failure = classifySlackError(error);
      const fields = { deliveryId: d.id, attempt: d.attempts + 1, error: failure.message };
      if (failure.kind === "revoked") {
        const current = this.store.getInstallation(credentialOwner.id);
        // A failed old request must not wipe a fresh OAuth grant.
        if (current?.userToken === credentialOwner.userToken && current?.botToken === credentialOwner.botToken) {
          this.store.markRevoked({ id: credentialOwner.id }, credentialKind);
        }
        this.store.finishDelivery(d.id, "failed", failure.message);
        log("warn", "delivery_credentials_revoked", fields);
        return true;
      }
      const retryAfterMs = Number.isFinite(failure.retryAfterSec) ? Math.max(0, failure.retryAfterSec! * 1000) : 0;
      // Cap exponential backoff, never Slack's Retry-After. Persist the pause for restarts.
      const delay = Math.max(backoffMs(d.attempts), retryAfterMs);
      if (failure.kind === "rate_limited") this.store.pauseDeliveriesUntil(this.now() + delay);
      if (failure.kind === "permanent" || d.attempts + 1 >= MAX_ATTEMPTS) {
        this.store.finishDelivery(d.id, "failed", failure.message);
        log("warn", "delivery_failed", fields);
        return failure.kind !== "rate_limited";
      }
      // Transient failures may already have posted; retrying favors delivery over exactly-once.
      this.store.retryDelivery(d.id, this.now() + delay, failure.message);
      log("warn", "delivery_retry", { ...fields, delayMs: delay });
      if (failure.kind === "rate_limited") {
        return false;
      }
      return true;
    }
  }

  private async permalink(source: Installation, d: Delivery): Promise<string | null> {
    try {
      const link = safeSlackUrl(await this.slack.getPermalink(source.userToken!, d.channelId, d.messageTs));
      if (link) return link;
    } catch (error) {
      const failure = classifySlackError(error);
      if (failure.kind === "rate_limited" || failure.kind === "revoked") throw failure;
      log("info", "permalink_fallback", { deliveryId: d.id, error: failure.message });
    }
    return fallbackPermalink(source.teamUrl, d.channelId, d.messageTs);
  }
}
