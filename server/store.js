import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";

export async function openStore(connection) {
  const pool = postgres(connection, { max: 10, idle_timeout: 20, connect_timeout: 10 });
  const transactionContext = new AsyncLocalStorage();
  await pool.begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext('carwash-schema'))`;
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)`;
    const versions = await sql`SELECT version FROM schema_migrations WHERE version = 1`;
    if (versions.length === 0) {
      await sql.unsafe(await readFile(new URL("../migrations/0001_vault.sql", import.meta.url), "utf8"));
      await sql`INSERT INTO schema_migrations VALUES (1)`;
    }
  });
  const run = (query, ...parameters) => {
    let position = 0;
    const sql = transactionContext.getStore() || pool;
    return sql.unsafe(query.replace(/\?/g, () => `$${++position}`), parameters);
  };
  return {
    run,
    all: run,
    get: async (...args) => (await run(...args))[0],
    transaction: (callback) => pool.begin((sql) => transactionContext.run(sql, callback)),
    close: () => pool.end(),
  };
}
