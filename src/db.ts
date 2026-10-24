import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { decrypt, encrypt, randomToken, sha256 } from "./crypto.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  destination_installation_id TEXT REFERENCES installations(id) ON DELETE SET NULL,
  cross_workspace_consent_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
  nonce_hash TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS installations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  team_url TEXT,
  user_id TEXT NOT NULL,
  bot_user_id TEXT,
  user_token TEXT,
  bot_token TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (team_id, user_id)
);
CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL,
  source_installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  reactor_id TEXT NOT NULL,
  reaction TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_ts TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (event_id, source_installation_id)
);
CREATE INDEX IF NOT EXISTS deliveries_due ON deliveries (status, next_attempt_at);
CREATE TABLE IF NOT EXISTS delivery_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  paused_until INTEGER NOT NULL
);
INSERT OR IGNORE INTO delivery_control (id, paused_until) VALUES (1, 0);
`;

export interface Installation {
  id: string;
  accountId: string;
  teamId: string;
  teamName: string;
  teamUrl: string | null;
  userId: string;
  botUserId: string | null;
  status: "active" | "revoked";
  userToken: string | null;
  botToken: string | null;
}

export interface Account {
  id: string;
  destinationInstallationId: string | null;
  crossWorkspaceConsentAt: number | null;
}

export interface Session {
  idHash: string;
  accountId: string;
  csrfToken: string;
}

export interface Delivery {
  id: number;
  eventId: string;
  sourceInstallationId: string;
  reactorId: string;
  reaction: string;
  channelId: string;
  messageTs: string;
  attempts: number;
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

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export class Store {
  readonly db: DatabaseSync;
  private readonly tokenKey: Buffer;
  private readonly now: () => number;

  constructor(path: string, tokenKey: Buffer, now: () => number = Date.now) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
    this.tokenKey = tokenKey;
    this.now = now;
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  // Accounts and sessions

  createAccountSession(): { sessionId: string; session: Session } {
    const accountId = randomToken(16);
    const sessionId = randomToken();
    const session = { idHash: sha256(sessionId), accountId, csrfToken: randomToken() };
    this.transaction(() => {
      this.db.prepare("INSERT INTO accounts (id, created_at) VALUES (?, ?)").run(accountId, this.now());
      this.db
        .prepare("INSERT INTO sessions (id_hash, account_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)")
        .run(session.idHash, accountId, session.csrfToken, this.now() + SESSION_TTL_MS);
    });
    return { sessionId, session };
  }

  getSession(sessionId: string): Session | undefined {
    const row = this.db
      .prepare("SELECT id_hash, account_id, csrf_token FROM sessions WHERE id_hash = ? AND expires_at > ?")
      .get(sha256(sessionId), this.now()) as Row | undefined;
    return row && { idHash: String(row.id_hash), accountId: String(row.account_id), csrfToken: String(row.csrf_token) };
  }

  getAccount(accountId: string): Account | undefined {
    const row = this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId) as Row | undefined;
    return (
      row && {
        id: String(row.id),
        destinationInstallationId: (row.destination_installation_id as string | null) ?? null,
        crossWorkspaceConsentAt: (row.cross_workspace_consent_at as number | null) ?? null,
      }
    );
  }

  setDestination(accountId: string, installationId: string | null, crossWorkspaceConsent: boolean): void {
    this.db
      .prepare("UPDATE accounts SET destination_installation_id = ?, cross_workspace_consent_at = ? WHERE id = ?")
      .run(installationId, crossWorkspaceConsent ? this.now() : null, accountId);
  }

  deleteAccount(accountId: string): void {
    this.transaction(() => {
      this.db
        .prepare("DELETE FROM oauth_states WHERE session_hash IN (SELECT id_hash FROM sessions WHERE account_id = ?)")
        .run(accountId);
      this.db.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
    });
  }

  // OAuth state: single use, bound to the session that started the install.

  createOAuthState(nonce: string, sessionHash: string): void {
    this.db
      .prepare("INSERT INTO oauth_states (nonce_hash, session_hash, expires_at) VALUES (?, ?, ?)")
      .run(sha256(nonce), sessionHash, this.now() + OAUTH_STATE_TTL_MS);
  }

  consumeOAuthState(nonce: string, sessionHash: string): boolean {
    const row = this.db
      .prepare(
        "DELETE FROM oauth_states WHERE nonce_hash = ? AND session_hash = ? AND expires_at > ? RETURNING nonce_hash",
      )
      .get(sha256(nonce), sessionHash, this.now());
    return row !== undefined;
  }

  // Installations

  private toInstallation(row: Row): Installation {
    const teamId = String(row.team_id);
    const userId = String(row.user_id);
    return {
      id: String(row.id),
      accountId: String(row.account_id),
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
  upsertInstallation(accountId: string, install: NewInstallation): Installation {
    const { teamId, userId } = install;
    const userToken = encrypt(this.tokenKey, install.userToken, `${teamId}:${userId}:user`);
    const botToken = encrypt(this.tokenKey, install.botToken, `${teamId}:${userId}:bot`);
    const now = this.now();
    return this.transaction(() => {
      const previous = this.db
        .prepare("SELECT id, account_id FROM installations WHERE team_id = ? AND user_id = ?")
        .get(teamId, userId) as Row | undefined;
      if (previous && previous.account_id !== accountId) {
        this.clearDestination(String(previous.id));
        this.db.prepare("DELETE FROM deliveries WHERE source_installation_id = ?").run(String(previous.id));
      }
      const row = this.db
        .prepare(
          `INSERT INTO installations
             (id, account_id, team_id, team_name, team_url, user_id, bot_user_id, user_token, bot_token, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
           ON CONFLICT (team_id, user_id) DO UPDATE SET
             account_id = excluded.account_id, team_name = excluded.team_name, team_url = excluded.team_url,
             bot_user_id = excluded.bot_user_id, user_token = excluded.user_token, bot_token = excluded.bot_token,
             status = 'active', updated_at = excluded.updated_at
           RETURNING *`,
        )
        .get(
          randomToken(16),
          accountId,
          teamId,
          install.teamName,
          install.teamUrl,
          userId,
          install.botUserId,
          userToken,
          botToken,
          now,
          now,
        ) as Row;
      return this.toInstallation(row);
    });
  }

  getInstallation(id: string): Installation | undefined {
    const row = this.db.prepare("SELECT * FROM installations WHERE id = ?").get(id) as Row | undefined;
    return row && this.toInstallation(row);
  }

  listInstallations(accountId: string): Installation[] {
    const rows = this.db.prepare("SELECT * FROM installations WHERE account_id = ? ORDER BY created_at").all(accountId);
    return rows.map((row) => this.toInstallation(row as Row));
  }

  findActiveInstallation(teamId: string, userId: string): Installation | undefined {
    const row = this.db
      .prepare("SELECT * FROM installations WHERE team_id = ? AND user_id = ? AND status = 'active'")
      .get(teamId, userId) as Row | undefined;
    return row && this.toInstallation(row);
  }

  countActiveInTeam(teamId: string, excludeId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM installations WHERE team_id = ? AND id != ? AND status = 'active'")
      .get(teamId, excludeId) as Row;
    return Number(row.n);
  }

  /** Wipes affected tokens; retain the other grant so disconnect can still revoke it. */
  markRevoked(
    where: { id: string } | { teamId: string; userIds?: string[] },
    kind: "user" | "bot" | "all" = "all",
  ): number {
    const cleared =
      kind === "user"
        ? "user_token = NULL"
        : kind === "bot"
          ? "bot_token = NULL"
          : "user_token = NULL, bot_token = NULL";
    let sql = `UPDATE installations SET status = 'revoked', ${cleared}, updated_at = ?`;
    const params: (string | number)[] = [this.now()];
    if ("id" in where) {
      sql += " WHERE id = ?";
      params.push(where.id);
    } else {
      sql += " WHERE team_id = ?";
      params.push(where.teamId);
      if (where.userIds) {
        if (where.userIds.length === 0) return 0;
        sql += ` AND user_id IN (${where.userIds.map(() => "?").join(", ")})`;
        params.push(...where.userIds);
      }
    }
    return Number(this.db.prepare(sql).run(...params).changes);
  }

  deleteInstallation(id: string): void {
    this.transaction(() => {
      this.clearDestination(id);
      this.db.prepare("DELETE FROM installations WHERE id = ?").run(id);
    });
  }

  private clearDestination(installationId: string): void {
    this.db
      .prepare(
        "UPDATE accounts SET destination_installation_id = NULL, cross_workspace_consent_at = NULL WHERE destination_installation_id = ?",
      )
      .run(installationId);
  }

  // Deliveries (durable outbox)

  deliveryPausedUntil(): number {
    return Number(
      (this.db.prepare("SELECT paused_until FROM delivery_control WHERE id = 1").get() as Row).paused_until,
    );
  }

  pauseDeliveriesUntil(timestamp: number): void {
    this.db.prepare("UPDATE delivery_control SET paused_until = max(paused_until, ?) WHERE id = 1").run(timestamp);
  }

  /** Returns false when this event was already recorded for this recipient. */
  enqueueDelivery(d: Omit<Delivery, "id" | "attempts">): boolean {
    const now = this.now();
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO deliveries
           (event_id, source_installation_id, reactor_id, reaction, channel_id, message_ts, status, next_attempt_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(d.eventId, d.sourceInstallationId, d.reactorId, d.reaction, d.channelId, d.messageTs, now, now);
    return result.changes > 0;
  }

  dueDeliveries(limit: number): Delivery[] {
    const rows = this.db
      .prepare(
        `SELECT id, event_id, source_installation_id, reactor_id, reaction, channel_id, message_ts, attempts
         FROM deliveries WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?`,
      )
      .all(this.now(), limit) as Row[];
    return rows.map((row) => ({
      id: Number(row.id),
      eventId: String(row.event_id),
      sourceInstallationId: String(row.source_installation_id),
      reactorId: String(row.reactor_id),
      reaction: String(row.reaction),
      channelId: String(row.channel_id),
      messageTs: String(row.message_ts),
      attempts: Number(row.attempts),
    }));
  }

  getDeliveryStatus(id: number): { status: string; attempts: number; lastError: string | null } | undefined {
    const row = this.db.prepare("SELECT status, attempts, last_error FROM deliveries WHERE id = ?").get(id) as
      Row | undefined;
    return (
      row && {
        status: String(row.status),
        attempts: Number(row.attempts),
        lastError: (row.last_error as string) ?? null,
      }
    );
  }

  finishDelivery(id: number, status: "sent" | "failed", error: string | null = null): void {
    this.db
      .prepare("UPDATE deliveries SET status = ?, attempts = attempts + 1, last_error = ? WHERE id = ?")
      .run(status, error, id);
  }

  retryDelivery(id: number, nextAttemptAt: number, error: string): void {
    this.db
      .prepare("UPDATE deliveries SET attempts = attempts + 1, next_attempt_at = ?, last_error = ? WHERE id = ?")
      .run(nextAttemptAt, error, id);
  }

  /** Drops minimal event data, expired sessions, and expired OAuth state. */
  purgeExpired(retentionMs: number): void {
    const now = this.now();
    this.db.prepare("DELETE FROM deliveries WHERE created_at < ?").run(now - retentionMs);
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    this.db.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").run(now);
  }
}
