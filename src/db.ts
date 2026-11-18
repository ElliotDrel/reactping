import pg from "pg";
import { parseDatabaseUrl } from "./config.ts";
import { decrypt, encrypt } from "./crypto.ts";
import { log } from "./log.ts";

/** One Slack user's installation in one workspace. Identity is Slack's own (team ID + user ID). */
export interface Installation {
  teamId: string;
  userId: string;
  workspaceUrl: string;
  botToken: string;
  userToken: string;
  /** Changes on every reinstall; lets a stale failure avoid deleting a fresh grant. */
  updatedAt: Date;
}

export type NewInstallation = Omit<Installation, "updatedAt">;

const TABLE = "reactping_slack.installations";
type Row = Record<string, unknown>;

export function createPool(connectionString: string, ca?: string): pg.Pool {
  const url = new URL(parseDatabaseUrl(connectionString));
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  // Remote connections always verify certificates. Use the provider's CA when system trust is insufficient.
  const pool = new pg.Pool({
    connectionString,
    ssl: local ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
  });
  pool.on("error", (error: Error) => log("warn", "pool_idle_error", { error: error.name }));
  return pool;
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

  /** Associated data binds each ciphertext to its workspace, user, and field. */
  private aad(teamId: string, userId: string, field: "bot" | "user"): string {
    return `${TABLE}:${teamId}:${userId}:${field}`;
  }

  private toInstallation(row: Row): Installation {
    const teamId = String(row.team_id);
    const userId = String(row.user_id);
    return {
      teamId,
      userId,
      workspaceUrl: String(row.workspace_url),
      botToken: decrypt(this.tokenKey, String(row.bot_token), this.aad(teamId, userId, "bot")),
      userToken: decrypt(this.tokenKey, String(row.user_token), this.aad(teamId, userId, "user")),
      updatedAt: row.updated_at as Date,
    };
  }

  /** Creates or replaces this Slack user's installation in this workspace only. */
  async upsert(install: NewInstallation): Promise<Installation> {
    const { teamId, userId } = install;
    const now = new Date(this.now());
    const { rows } = await this.pool.query(
      `insert into ${TABLE} (team_id, user_id, workspace_url, bot_token, user_token, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $6)
       on conflict (team_id, user_id) do update set
         workspace_url = excluded.workspace_url, bot_token = excluded.bot_token,
         user_token = excluded.user_token, updated_at = excluded.updated_at
       returning *`,
      [
        teamId,
        userId,
        install.workspaceUrl,
        encrypt(this.tokenKey, install.botToken, this.aad(teamId, userId, "bot")),
        encrypt(this.tokenKey, install.userToken, this.aad(teamId, userId, "user")),
        now,
      ],
    );
    return this.toInstallation(rows[0] as Row);
  }

  async get(teamId: string, userId: string): Promise<Installation | undefined> {
    const { rows } = await this.pool.query(`select * from ${TABLE} where team_id = $1 and user_id = $2`, [
      teamId,
      userId,
    ]);
    return rows[0] ? this.toInstallation(rows[0] as Row) : undefined;
  }

  /** Deletes exactly this installation and returns it (for revoking its user grant), if it existed. */
  async delete(teamId: string, userId: string): Promise<Installation | undefined> {
    const { rows } = await this.pool.query(`delete from ${TABLE} where team_id = $1 and user_id = $2 returning *`, [
      teamId,
      userId,
    ]);
    return rows[0] ? this.toInstallation(rows[0] as Row) : undefined;
  }

  /** Deletes the installation only if it was not reinstalled since `seen` was read. */
  async deleteIfUnchanged(seen: Installation): Promise<boolean> {
    const result = await this.pool.query(
      `delete from ${TABLE} where team_id = $1 and user_id = $2 and updated_at = $3`,
      [seen.teamId, seen.userId, seen.updatedAt],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Deletes the given users' installations in one workspace (their user grants were revoked). */
  async deleteUsers(teamId: string, userIds: string[]): Promise<number> {
    if (userIds.length === 0) return 0;
    const result = await this.pool.query(`delete from ${TABLE} where team_id = $1 and user_id = any($2::text[])`, [
      teamId,
      userIds,
    ]);
    return result.rowCount ?? 0;
  }

  /** Deletes every installation in one workspace (app uninstalled or bot token revoked). */
  async deleteTeam(teamId: string): Promise<number> {
    const result = await this.pool.query(`delete from ${TABLE} where team_id = $1`, [teamId]);
    return result.rowCount ?? 0;
  }

  /** Logs a connection change for a workspace. No user IDs: only the workspace, the event, and how many installs. */
  async recordActivity(teamId: string, event: ActivityEvent, installs = 1): Promise<void> {
    if (installs < 1) return;
    await this.pool.query(`insert into reactping_slack.activity (team_id, event, installs) values ($1, $2, $3)`, [
      teamId,
      event,
      installs,
    ]);
  }

  /** Adds one to the delivered-notification total. Nothing about the notification itself is stored. */
  async countNotification(): Promise<void> {
    await this.pool.query(`update reactping_slack.counters set value = value + 1 where name = 'notifications_sent'`);
  }

  /** Stores one piece of feedback. Slack feedback carries the sender's IDs; website feedback an optional name/email. */
  async saveFeedback(feedback: Feedback): Promise<void> {
    await this.pool.query(
      `insert into reactping_slack.feedback (source, team_id, user_id, name, email, message)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        feedback.source,
        feedback.teamId ?? null,
        feedback.userId ?? null,
        feedback.name ?? null,
        feedback.email ?? null,
        feedback.message,
      ],
    );
  }

  /** Any connected person's bot token in this workspace (the bot token is shared by everyone there). */
  async workspaceBotToken(teamId: string): Promise<string | undefined> {
    const { rows } = await this.pool.query(`select * from ${TABLE} where team_id = $1 limit 1`, [teamId]);
    return rows[0] ? this.toInstallation(rows[0] as Row).botToken : undefined;
  }

  /** Public totals: workspaces with at least one connected person, and reaction DMs delivered all time. */
  async stats(): Promise<Stats> {
    const { rows } = await this.pool.query(
      `select (select count(distinct team_id) from ${TABLE})::int as workspaces,
              (select value from reactping_slack.counters where name = 'notifications_sent')::bigint as notifications`,
    );
    const row = rows[0] as Row;
    return { workspaces: Number(row.workspaces ?? 0), notifications: Number(row.notifications ?? 0) };
  }
}

export interface Feedback {
  source: "slack" | "website";
  message: string;
  teamId?: string;
  userId?: string;
  name?: string;
  email?: string;
}

export type ActivityEvent = "connected" | "disconnected" | "uninstalled";
export interface Stats {
  workspaces: number;
  notifications: number;
}
