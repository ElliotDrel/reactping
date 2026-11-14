import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { Store } from "../src/db.ts";
import { Clock, dbSkip, useDatabase } from "./helpers.ts";

describe("installations table", { skip: dbSkip }, () => {
  const db = useDatabase();
  const install = (teamId: string, userId: string) => ({
    teamId,
    userId,
    workspaceUrl: "https://acme.slack.com/",
    botToken: `xoxb-${teamId}`,
    userToken: `xoxp-${teamId}-${userId}`,
  });

  it("is private: RLS on, no policies, and no privileges for anon or authenticated", async () => {
    const pool = db.pool();
    const { rows } = await pool.query(
      `select c.relrowsecurity as rls, (select count(*)::int from pg_policies p
         where p.schemaname = 'reactping_slack' and p.tablename = 'installations') as policies
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'reactping_slack' and c.relname = 'installations'`,
    );
    assert.deepEqual(rows, [{ rls: true, policies: 0 }]);
    for (const role of ["anon", "authenticated"]) {
      const privileges = await pool.query(
        `select has_schema_privilege($1, 'reactping_slack', 'usage') as usage,
                has_table_privilege($1, 'reactping_slack.installations', 'select,insert,update,delete') as any_table`,
        [role],
      );
      assert.deepEqual(privileges.rows, [{ usage: false, any_table: false }], role);
    }
    const client = await pool.connect();
    try {
      await client.query("set role anon");
      await assert.rejects(client.query("select * from reactping_slack.installations"), /permission denied/);
    } finally {
      await client.query("reset role");
      client.release();
    }
  });

  it("is additive: the original schema remains until the separate cleanup migration", async () => {
    const { rows } = await db
      .pool()
      .query("select table_name from information_schema.tables where table_schema = 'reactping' order by table_name");
    assert.deepEqual(
      rows.map((r) => r.table_name),
      ["accounts", "deliveries", "delivery_control", "installations", "oauth_states"],
    );
  });

  it("stores tokens only as ciphertext bound to their row and field", async () => {
    const key = randomBytes(32);
    const store = new Store(db.pool(), key, new Clock().now);
    await store.upsert(install("T1", "U1"));
    await store.upsert(install("T1", "U2"));
    const { rows } = await db.pool().query("select * from reactping_slack.installations order by user_id");
    assert.ok(!JSON.stringify(rows).includes("xox"));

    // Swap U2's ciphertext into U1's row, and the bot ciphertext into the user field: both fail to decrypt.
    await db.pool().query(
      `update reactping_slack.installations set user_token = (select user_token from reactping_slack.installations
         where user_id = 'U2') where user_id = 'U1'`,
    );
    await assert.rejects(store.get("T1", "U1"));
    await db.pool().query("update reactping_slack.installations set user_token = bot_token where user_id = 'U2'");
    await assert.rejects(store.get("T1", "U2"));
    // A different key cannot read anything.
    await store.upsert(install("T2", "U1"));
    await assert.rejects(new Store(db.pool(), randomBytes(32)).get("T2", "U1"));
  });

  it("validates identities and workspace URLs in the schema as well", async () => {
    const store = new Store(db.pool(), randomBytes(32));
    await assert.rejects(store.upsert(install("t1", "U1")), /check constraint/);
    await assert.rejects(store.upsert(install("T1", "B1")), /check constraint/);
    await assert.rejects(
      store.upsert({ ...install("T1", "U1"), workspaceUrl: "https://evil.test/" }),
      /check constraint/,
    );
  });

  it("deletes by exact identity and workspace without touching others", async () => {
    const clock = new Clock();
    const store = new Store(db.pool(), randomBytes(32), clock.now);
    for (const [team, user] of [
      ["T1", "U1"],
      ["T1", "U2"],
      ["T2", "U1"],
    ] as const) {
      await store.upsert(install(team, user));
    }
    assert.equal((await store.delete("T1", "U1"))?.userToken, "xoxp-T1-U1");
    assert.equal(await store.delete("T1", "U1"), undefined);
    assert.equal(await store.deleteUsers("T2", ["U2"]), 0);
    assert.equal(await store.deleteTeam("T1"), 1);
    assert.ok(await store.get("T2", "U1"));

    const seen = (await store.get("T2", "U1"))!;
    clock.t += 1000;
    await store.upsert(install("T2", "U1"));
    assert.equal(await store.deleteIfUnchanged(seen), false, "a newer install survives");
    assert.equal(await store.deleteIfUnchanged((await store.get("T2", "U1"))!), true);
  });
});
