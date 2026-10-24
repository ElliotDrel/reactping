import { hmacHex, safeEqual } from "./crypto.ts";
import type { Store } from "./db.ts";
import { log } from "./log.ts";

const MAX_SKEW_SECONDS = 5 * 60;

export function verifySlackSignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string | undefined,
  signature: string | undefined,
  nowMs: number,
): boolean {
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  const expected = `v0=${hmacHex(signingSecret, `v0:${timestamp}:${rawBody}`)}`;
  return safeEqual(expected, signature);
}

const ID = /^[A-Z0-9]{2,32}$/;
const USER_ID = /^[UW][A-Z0-9]{2,31}$/;
const CHANNEL_ID = /^[CGD][A-Z0-9]{2,31}$/;
const TS = /^\d{1,12}\.\d{1,9}$/;
const REACTION = /^[a-z0-9_+'\-:]{1,100}$/;

interface EventEnvelope {
  type?: string;
  team_id?: string;
  event_id?: string;
  event?: {
    type?: string;
    user?: string;
    reaction?: string;
    item_user?: string;
    item?: { type?: string; channel?: string; ts?: string };
    tokens?: { oauth?: unknown; bot?: unknown };
  };
}

export type EventOutcome = "enqueued" | "duplicate" | "ignored" | "revoked";

/**
 * Applies one verified event_callback. Runs synchronously against SQLite so the HTTP
 * handler can acknowledge only after the outcome is durable.
 */
export function handleEventCallback(store: Store, envelope: EventEnvelope): EventOutcome {
  const teamId = envelope.team_id;
  const event = envelope.event;
  if (!teamId || !ID.test(teamId) || !event) return "ignored";

  switch (event.type) {
    case "reaction_added":
      return handleReaction(store, teamId, envelope.event_id, event);
    case "tokens_revoked": {
      const ids = (value: unknown) => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
      const userIds = ids(event.tokens?.oauth);
      // A revoked bot token means the bot can no longer DM anyone in that workspace.
      let count = store.markRevoked({ teamId, userIds }, "user");
      if (ids(event.tokens?.bot).length > 0) count += store.markRevoked({ teamId }, "bot");
      log("info", "tokens_revoked", { teamId, installations: count });
      return "revoked";
    }
    case "app_uninstalled": {
      const count = store.markRevoked({ teamId });
      log("info", "app_uninstalled", { teamId, installations: count });
      return "revoked";
    }
    default:
      return "ignored";
  }
}

function handleReaction(
  store: Store,
  teamId: string,
  eventId: string | undefined,
  event: NonNullable<EventEnvelope["event"]>,
): EventOutcome {
  const { item, user: reactorId, item_user: authorId, reaction } = event;
  if (item?.type !== "message") return "ignored";
  if (!eventId || !/^Ev[A-Z0-9]{2,40}$/.test(eventId)) return "ignored";
  if (!reactorId || !authorId || !USER_ID.test(reactorId) || !USER_ID.test(authorId)) return "ignored";
  if (reactorId === authorId) return "ignored";
  if (!reaction || !REACTION.test(reaction)) return "ignored";
  if (!item.channel || !item.ts || !CHANNEL_ID.test(item.channel) || !TS.test(item.ts)) return "ignored";

  // Route by the message author's own installation in this workspace. The envelope's
  // `authorizations` array names only one installation that can see the event, so it is not used.
  const source = store.findActiveInstallation(teamId, authorId);
  if (!source) return "ignored";

  const created = store.enqueueDelivery({
    eventId,
    sourceInstallationId: source.id,
    reactorId,
    reaction,
    channelId: item.channel,
    messageTs: item.ts,
  });
  return created ? "enqueued" : "duplicate";
}
