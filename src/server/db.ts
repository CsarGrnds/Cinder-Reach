import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

export interface Sql { query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }> }
export interface Db extends Sql { tx<T>(fn: (q: Sql) => Promise<T>): Promise<T>; close(): Promise<void> }

// Ids are bigserial; they stay well inside Number's safe range.
pg.types.setTypeParser(20, v => Number(v));

export function pgDb(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return {
    query: (t, p) => pool.query(t, p as any[]) as any,
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn({ query: (t, p) => c.query(t, p as any[]) as any });
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { c.release(); }
    },
    close: () => pool.end(),
  };
}

export const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');

export async function migrate(db: Db, dir = MIGRATIONS_DIR) {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(r => r.name));
  const applied: string[] = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    await db.tx(async q => {
      for (const stmt of sql.split(/;\s*$/m).map(s => s.trim()).filter(Boolean)) await q.query(stmt);
      await q.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
    });
    applied.push(f);
  }
  return applied;
}
