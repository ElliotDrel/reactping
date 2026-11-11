import { randomUUID } from "node:crypto";
import pg from "pg";
import { decrypt, encrypt, sha256 } from "./crypto.ts";

export interface Installation {
  id: string;
  /** Supabase Auth user ID that owns this installation. */
  accountId: string;
  teamId: string;
  teamName: string;
  teamUrl: string | null;
  /** Slack user ID of the person who authorized it. */
  userId: string;
  botUserId: string | null;
  status: "active" | "revoked";
  userToken: string | null;
  botToken: string | null;
}

export interface Account {
  id: string;
  destinationInstallationId: string | null;
  crossWorkspaceConsentAt: Date | null;
}

export interface Delivery {
  id: number;
  eventId: string;
  sourceInstallationId: string;
  reactorId: string;
  reaction: string;
  channelId: string;
  messageTs: string;
  /** Attempts including the one this claim started. */
  attempts: number;
  leaseToken: string;
}

export interface NewInstallation {
  teamId: string;
  teamName: string;
  teamUrl: string | null;
  userId: string;
  botUserId: string | null;
  userToken: string;
  botToken: string;
}

type Row = Record<string, unknown>;
type Queryable = Pick<pg.Pool, "query">;

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
/** Longer than two Slack calls with their 10 s timeouts. An expired lease lets another worker retry. */
export const LEASE_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPool(connectionString: string): pg.Pool {
  // Serverless instances keep a tiny pool; use Supabase's transaction pooler URL in production.
  return new pg.Pool({ connectionString, max: 3, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 5_000 });
}

export class Store {
  readonly pool: pg.Pool;
  private readonly tokenKey: Buffer;
  private readonly now: () => number;

  constructor(pool: pg.Pool, tokenKey: Buffer, now: () => number = Date.now) {
    this.pool = pool;
    this.tokenKey = tokenKey;
    this.now = now;
  }

  private date(offsetMs = 0): Date {
    return new Date(this.now() + offsetMs);
  }

  private async rows(sql: string, params: unknown[] = [], db: Queryable = this.pool): Promise<Row[]> {
    return (await db.query(sql, params)).rows as Row[];
  }

  async transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query("select 1");
  }

  // Accounts

  /** Creates the ReactPing account for a verified Supabase user on first use. */
  async ensureAccount(accountId: string): Promise<Account> {
    await this.pool.query(
      "insert into reactping.accounts (user_id, created_at) values ($1, $2) on conflict (user_id) do nothing",
      [accountId, this.date()],
    );
    return (await this.getAccount(accountId))!;
  }

  async getAccount(accountId: string): Promise<Account | undefined> {
    const [row] = await this.rows("select * from reactping.accounts where user_id = $1", [accountId]);
    return (
      row && {
        id: String(row.user_id),
        destinationInstallationId: (row.destination_installation_id as string | null) ?? null,
        crossWorkspaceConsentAt: (row.cross_workspace_consent_at as Date | null) ?? null,
      }
    );
  }

  async setDestination(
    accountId: string,
    installationId: string | null,
    crossWorkspaceConsent: boolean,
  ): Promise<void> {
    await this.pool.query(
      "update reactping.accounts set destination_installation_id = $2, cross_workspace_consent_at = $3 where user_id = $1",
      [accountId, installationId, crossWorkspaceConsent ? this.date() : null],
    );
  }

  /** Removes the account and, by cascade, its installations, deliveries, and OAuth state. */
  async deleteAccount(accountId: string): Promise<void> {
    await this.pool.query("delete from reactping.accounts where user_id = $1", [accountId]);
  }

  /** Deletes the Supabase Auth identity (email) as well. Requires the owner connection, never a user JWT. */
  async deleteAuthUser(accountId: string): Promise<void> {
    await this.pool.query("delete from auth.users where id = $1", [accountId]);
  }

  // OAuth state: single use, expiring, and bound to both the account and the starting browser.

  async createOAuthState(accountId: string, nonce: string, browserSecret: string): Promise<void> {
    await this.pool.query(
      "insert into reactping.oauth_states (nonce_hash, user_id, browser_hash, expires_at) values ($1, $2, $3, $4)",
      [sha256(nonce), accountId, sha256(browserSecret), this.date(OAUTH_STATE_TTL_MS)],
    );
  }

  /** Returns the account that started the install, or undefined for unknown, expired, used, or foreign state. */
  async consumeOAuthState(nonce: string, browserSecret: string): Promise<string | undefined> {
    const [row] = await this.rows(
      `delete from reactping.oauth_states
       where nonce_hash = $1 and browser_hash = $2 and expires_at > $3
       returning user_id`,
      [sha256(nonce), sha256(browserSecret), this.date()],
    );
    return row ? String(row.user_id) : undefined;
  }

  // Installations

  private toInstallation(row: Row): Installation {
    const teamId = String(row.team_id);
    const userId = String(row.slack_user_id);
    return {
      id: String(row.id),
      accountId: String(row.user_id),
      teamId,
      teamName: String(row.team_name),
      teamUrl: (row.team_url as string | null) ?? null,
      userId,
      botUserId: (row.bot_user_id as string | null) ?? null,
      status: row.status as Installation["status"],
      userToken: row.user_token ? decrypt(this.tokenKey, String(row.user_token), `${teamId}:${userId}:user`) : null,
      botToken: row.bot_token ? decrypt(this.tokenKey, String(row.bot_token), `${teamId}:${userId}:bot`) : null,
    };
  }

  /**
   * Links a Slack identity to an account. Completing OAuth proves control of the Slack user,
   * so an identity previously linked elsewhere moves to the account that just authorized it.
   */
  async upsertInstallation(accountId: string, install: NewInstallation): Promise<Installation> {
    const { teamId, userId } = install;
    const userToken = encrypt(this.tokenKey, install.userToken, `${teamId}:${userId}:user`);
    const botToken = encrypt(this.tokenKey, install.botToken, `${teamId}:${userId}:bot`);
    const now = this.date();
    return this.transaction(async (client) => {
      const [previous] = await this.rows(
        "select id, user_id from reactping.installations where team_id = $1 and slack_user_id = $2 for update",
        [teamId, userId],
        client,
      );
      if (previous && previous.user_id !== accountId) {
        await this.clearDestination(String(previous.id), client);
        await client.query("delete from reactping.deliveries where source_installation_id = $1", [previous.id]);
      }
      const [row] = await this.rows(
        `insert into reactping.installations
           (user_id, team_id, team_name, team_url, slack_user_id, bot_user_id, user_token, bot_token, status, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $9)
         on conflict (team_id, slack_user_id) do update set
           user_id = excluded.user_id, team_name = excluded.team_name, team_url = excluded.team_url,
           bot_user_id = excluded.bot_user_id, user_token = excluded.user_token, bot_token = excluded.bot_token,
           status = 'active', updated_at = excluded.updated_at
         returning *`,
        [accountId, teamId, install.teamName, install.teamUrl, userId, install.botUserId, userToken, botToken, now],
        client,
      );
      return this.toInstallation(row!);
    });
  }

  async getInstallation(id: string): Promise<Installation | undefined> {
    if (!UUID.test(id)) return undefined;
    const [row] = await this.rows("select * from reactping.installations where id = $1", [id]);
    return row && this.toInstallation(row);
  }

  async listInstallations(accountId: string): Promise<Installation[]> {
    const rows = await this.rows("select * from reactping.installations where user_id = $1 order by created_at, id", [
      accountId,
    ]);
    return rows.map((row) => this.toInstallation(row));
  }

  async findActiveInstallation(teamId: string, userId: string): Promise<Installation | undefined> {
    const [row] = await this.rows(
      "select * from reactping.installations where team_id = $1 and slack_user_id = $2 and status = 'active'",
      [teamId, userId],
    );
    return row && this.toInstallation(row);
  }

  async countActiveInTeam(teamId: string, excludeId: string | null): Promise<number> {
    const [row] = await this.rows(
      `select count(*)::int as n from reactping.installations
       where team_id = $1 and status = 'active' and ($2::uuid is null or id <> $2::uuid)`,
      [teamId, excludeId],
    );
    return Number(row!.n);
  }

  /** Wipes affected tokens; retain the other grant so disconnect can still revoke it. */
  async markRevoked(
    where: { id: string } | { teamId: string; userIds?: string[] },
    kind: "user" | "bot" | "all" = "all",
  ): Promise<number> {
    const cleared =
      kind === "user"
        ? "user_token = null"
        : kind === "bot"
          ? "bot_token = null"
          : "user_token = null, bot_token = null";
    const set = `update reactping.installations set status = 'revoked', ${cleared}, updated_at = $1`;
    const now = this.date();
    let result;
    if ("id" in where) {
      if (!UUID.test(where.id)) return 0;
      result = await this.pool.query(`${set} where id = $2`, [now, where.id]);
    } else if (where.userIds) {
      if (where.userIds.length === 0) return 0;
      result = await this.pool.query(`${set} where team_id = $2 and slack_user_id = any($3::text[])`, [
        now,
        where.teamId,
        where.userIds,
      ]);
    } else {
      result = await this.pool.query(`${set} where team_id = $2`, [now, where.teamId]);
    }
    return result.rowCount ?? 0;
  }

  /** Deletes the installation and its queued deliveries, and clears any destination pointing at it. */
  async deleteInstallation(id: string): Promise<void> {
    await this.transaction(async (client) => {
      await this.clearDestination(id, client);
      await client.query("delete from reactping.installations where id = $1", [id]);
    });
  }

  private async clearDestination(installationId: string, db: Queryable): Promise<void> {
    await db.query(
      `update reactping.accounts set destination_installation_id = null, cross_workspace_consent_at = null
       where destination_installation_id = $1`,
      [installationId],
    );
  }

  /** Records a connection-test DM; false if one was sent within `minIntervalMs`. */
  async markTested(id: string, minIntervalMs: number): Promise<boolean> {
    const result = await this.pool.query(
      `update reactping.installations set last_test_at = $2
       where id = $1 and (last_test_at is null or last_test_at <= $3)`,
      [id, this.date(), this.date(-minIntervalMs)],
    );
    return (result.rowCount ?? 0) > 0;
  }

  // Deliveries (durable outbox)

  async deliveryPausedUntil(): Promise<number> {
    const [row] = await this.rows("select paused_until from reactping.delivery_control where id = 1");
    const value = row!.paused_until as Date | number;
    return value instanceof Date ? value.getTime() : -Infinity;
  }

  async pauseDeliveriesUntil(timestamp: number): Promise<void> {
    await this.pool.query(
      "update reactping.delivery_control set paused_until = greatest(paused_until, $1) where id = 1",
      [new Date(timestamp)],
    );
  }

  /** Returns false when this event was already recorded for this recipient. */
  async enqueueDelivery(
    d: Pick<Delivery, "eventId" | "sourceInstallationId" | "reactorId" | "reaction" | "channelId" | "messageTs">,
  ): Promise<boolean> {
    const now = this.date();
    const result = await this.pool.query(
      `insert into reactping.deliveries
         (event_id, source_installation_id, reactor_id, reaction, channel_id, message_ts, next_attempt_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $7)
       on conflict (event_id, source_installation_id) do nothing`,
      [d.eventId, d.sourceInstallationId, d.reactorId, d.reaction, d.channelId, d.messageTs, now],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Atomically leases one due delivery. `for update skip locked` plus the lease means two workers never
   * hold the same row; a crashed worker's lease expires and the row becomes claimable again. The attempt
   * counter increases at claim time so crash loops still hit the attempt limit.
   */
  async claimDelivery(): Promise<Delivery | undefined> {
    const now = this.date();
    const [row] = await this.rows(
      `update reactping.deliveries d
       set attempts = d.attempts + 1, lease_token = $2, lease_until = $3
       where d.id = (
         select id from reactping.deliveries
         where status = 'pending' and next_attempt_at <= $1 and (lease_until is null or lease_until <= $1)
           and (select paused_until from reactping.delivery_control where id = 1) <= $1
         order by next_attempt_at, id
         for update skip locked
         limit 1
       )
       returning d.*`,
      [now, randomUUID(), this.date(LEASE_MS)],
    );
    return (
      row && {
        id: Number(row.id),
        eventId: String(row.event_id),
        sourceInstallationId: String(row.source_installation_id),
        reactorId: String(row.reactor_id),
        reaction: String(row.reaction),
        channelId: String(row.channel_id),
        messageTs: String(row.message_ts),
        attempts: Number(row.attempts),
        leaseToken: String(row.lease_token),
      }
    );
  }

  /** Completes a leased delivery. Returns false if the lease was lost (another worker took over). */
  async finishDelivery(d: Delivery, status: "sent" | "failed", error: string | null = null): Promise<boolean> {
    const result = await this.pool.query(
      `update reactping.deliveries set status = $3, last_error = $4, lease_token = null, lease_until = null
       where id = $1 and lease_token = $2`,
      [d.id, d.leaseToken, status, error],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async retryDelivery(d: Delivery, nextAttemptAt: number, error: string): Promise<boolean> {
    const result = await this.pool.query(
      `update reactping.deliveries set next_attempt_at = $3, last_error = $4, lease_token = null, lease_until = null
       where id = $1 and lease_token = $2`,
      [d.id, d.leaseToken, new Date(nextAttemptAt), error],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getDeliveryStatus(
    id: number,
  ): Promise<{ status: string; attempts: number; lastError: string | null } | undefined> {
    const [row] = await this.rows("select status, attempts, last_error from reactping.deliveries where id = $1", [id]);
    return (
      row && {
        status: String(row.status),
        attempts: Number(row.attempts),
        lastError: (row.last_error as string | null) ?? null,
      }
    );
  }

  /** Pending deliveries that are due now (used by tests and diagnostics). */
  async pendingDeliveries(): Promise<Row[]> {
    return this.rows("select * from reactping.deliveries where status = 'pending' order by id");
  }

  /** Drops minimal event data past retention and expired OAuth state. */
  async purgeExpired(retentionMs: number): Promise<void> {
    await this.pool.query("delete from reactping.deliveries where created_at < $1", [this.date(-retentionMs)]);
    await this.pool.query("delete from reactping.oauth_states where expires_at <= $1", [this.date()]);
  }
}
