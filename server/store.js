import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";

export async function openStore(connection) {
  const pool = postgres(connection, { max: 10, idle_timeout: 20, connect_timeout: 10 });
  const transactionContext = new AsyncLocalStorage();
  await pool.begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext('carwash-schema'))`;
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)`;
    const applied = new Set((await sql`SELECT version FROM schema_migrations`).map((row) => row.version));
    for (const [version, file] of [[1, "0001_vault.sql"], [2, "0002_catalog.sql"], [3, "0003_expiry_indexes.sql"]]) {
      if (applied.has(version)) continue;
      await sql.unsafe(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
      await sql`INSERT INTO schema_migrations VALUES (${version})`;
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
