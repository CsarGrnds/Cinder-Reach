// Read models sent to the client. They run inside Game.run so they reflect every event due by now.
import type { Sql } from './db.js';
import type { Game } from './game.js';
import { lv, EXPEDITION_POSITION, type Levels } from '../rules/index.js';
import { getUser, userPlanets, userFleets, incomingFleets, syncPlanet } from './repo.js';

export async function state(game: Game, q: Sql, t: number, userId: number) {
  const user = (await getUser(q, userId))!;
  await q.query('UPDATE users SET last_seen=$2 WHERE id=$1', [userId, t]);
  const points = (await q.query('SELECT points FROM users WHERE id=$1', [userId])).rows[0].points as number;
  const planets = await userPlanets(q, userId);
  for (const P of planets) syncPlanet(P, user.tech, game.U, t); // in memory only: the stored sync point stays valid
  const own = await userFleets(q, userId);
  const incoming = await incomingFleets(q, userId);
  const es = lv(user.tech, 'es');
  const unread = (await q.query('SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND NOT read', [userId])).rows[0].n as number;
  return {
    now: t,
    universe: game.U,
    me: { id: user.id, username: user.username, points, dm: user.dm },
    tech: user.tech,
    research: user.research,
    planets: planets.map(P => ({
      id: P.id, name: P.name, g: P.g, s: P.s, p: P.p, moon: P.moon, home: P.home, fields: P.fields, temp: P.temp, dia: P.dia,
      res: P.res, resAt: P.resAt, b: P.b, u: P.u, pc: P.pc, bq: P.bq, yq: P.yq, yEnd: P.yEnd, jgReady: P.jgReady, raid: P.raid,
    })),
    fleets: own.map(f => ({ ...f, own: true })),
    // Fleets other players aimed at you. Composition shows with Espionage Technology 2 or better.
    incoming: incoming.map(f => ({
      id: f.id, owner: f.owner, mission: f.mission, origin: f.origin, target: f.target, start: f.start, end: f.end,
      hostile: ['attack', 'spy', 'missile'].includes(f.mission),
      ships: es >= 2 ? f.ships : null, count: Object.values(f.ships).reduce((a: number, b) => a + (b as number), 0),
    })),
    unread,
  };
}

export async function galaxy(q: Sql, g: number, s: number) {
  const rows = (await q.query(`SELECT p.position, p.is_moon, p.name, p.user_id, u.username, u.points, u.last_seen
    FROM planets p JOIN users u ON u.id=p.user_id WHERE p.galaxy=$1 AND p.system=$2 ORDER BY p.position, p.is_moon`, [g, s])).rows;
  const debris = (await q.query('SELECT position, metal, crystal FROM debris WHERE galaxy=$1 AND system=$2', [g, s])).rows;
  const slots = [];
  for (let p = 1; p <= 15; p++) {
    const pl = rows.find(r => r.position === p && !r.is_moon), moon = rows.find(r => r.position === p && r.is_moon), d = debris.find(r => r.position === p);
    slots.push({
      p,
      planet: pl ? { name: pl.name, userId: pl.user_id, owner: pl.username, points: pl.points, lastSeen: pl.last_seen } : null,
      moon: !!moon,
      debris: d && d.metal + d.crystal >= 1 ? [d.metal, d.crystal] : null,
    });
  }
  return { g, s, slots, expedition: EXPEDITION_POSITION };
}

export async function highscore(q: Sql, userId: number, page: number) {
  const size = 50, off = Math.max(0, page - 1) * size;
  const rows = (await q.query(`SELECT u.id, u.username, u.points, (SELECT format('[%s:%s:%s]', galaxy, system, position) FROM planets WHERE user_id=u.id AND is_home) AS home
    FROM users u ORDER BY u.points DESC, u.id LIMIT $1 OFFSET $2`, [size, off])).rows;
  const total = (await q.query('SELECT count(*)::int AS n FROM users')).rows[0].n as number;
  const rank = (await q.query('SELECT 1 + count(*)::int AS r FROM users WHERE points > (SELECT points FROM users WHERE id=$1)', [userId])).rows[0].r as number;
  return { page, size, total, rank, rows: rows.map((r, i) => ({ rank: off + i + 1, id: r.id, username: r.username, points: r.points, home: r.home })) };
}

export async function messages(q: Sql, userId: number) {
  const rows = (await q.query('SELECT id, at, kind, title, body, read FROM messages WHERE user_id=$1 ORDER BY at DESC, id DESC LIMIT 100', [userId])).rows;
  await q.query('UPDATE messages SET read=true WHERE user_id=$1 AND NOT read', [userId]);
  return rows;
}

export type State = Awaited<ReturnType<typeof state>>;
export type { Levels };
