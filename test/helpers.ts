import { PGlite, types } from '@electric-sql/pglite';
import { migrate, type Db } from '../src/server/db.ts';
import { Game } from '../src/server/game.ts';
import { register } from '../src/server/auth.ts';
import { getUser, getPlanet, savePlanet, saveUser, userPlanets } from '../src/server/repo.ts';
import type { Universe } from '../src/rules/index.ts';

/** In-process Postgres for tests: same SQL, no Docker. */
export async function pgliteDb(): Promise<Db> {
  const pg = new PGlite({ parsers: { [types.INT8]: (v: string) => Number(v) } });
  let chain = Promise.resolve();
  const db: Db = {
    query: (t, p) => pg.query(t, p as any[]) as any,
    // PGlite has one connection: queue transactions so they never interleave.
    tx: fn => {
      const run = chain.then(() => pg.transaction(tx => fn({ query: (t, p) => tx.query(t, p as any[]) as any })));
      chain = run.then(() => {}, () => {});
      return run;
    },
    close: () => pg.close(),
  };
  await migrate(db);
  return db;
}

export const TEST_UNIVERSE: Universe = { speed: 1, fleetSpeed: 1, galaxies: 2, systems: 30, debrisFactor: 0.3, defenceRebuild: 0.7, noobProtection: 0 };

/** A game whose clock only moves when the test says so. */
export async function world(u: Partial<Universe> = {}) {
  const db = await pgliteDb();
  let now = Date.UTC(2026, 0, 1);
  let seed = 12345;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
  const game = new Game(db, { ...TEST_UNIVERSE, ...u }, () => now, rng);
  const w = {
    db, game,
    get now() { return now; },
    async advance(ms: number) { now += ms; await game.run(async () => {}); },
    async player(name: string) {
      const { userId } = await register(game, name, 'password123');
      const home = (await game.run(q => userPlanets(q, userId)))[0];
      return { id: userId, home: home.id };
    },
    /** Test setup only: put a planet and its owner into a given state. */
    async rig(planetId: number, patch: { res?: [number, number, number]; b?: Record<string, number>; u?: Record<string, number>; tech?: Record<string, number> }) {
      await game.run(async q => {
        const P = (await getPlanet(q, planetId))!;
        if (patch.res) P.res = patch.res;
        if (patch.b) Object.assign(P.b, patch.b);
        if (patch.u) Object.assign(P.u, patch.u);
        await savePlanet(q, P);
        if (patch.tech) { const u = (await getUser(q, P.userId))!; Object.assign(u.tech, patch.tech); await saveUser(q, u); }
      });
    },
    planet: (id: number) => game.run(q => getPlanet(q, id)),
    user: (id: number) => game.run(q => getUser(q, id)),
    messages: (uid: number) => game.run(async q => (await q.query('SELECT title, body FROM messages WHERE user_id=$1 ORDER BY at DESC, id DESC', [uid])).rows as { title: string; body: string }[]),
  };
  return w;
}
