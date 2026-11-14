// Row mapping and small persistence helpers. Every function takes the transaction's Sql handle.
import type { Sql } from './db.js';
import { accrue, production, sum3, type Levels, type Res, type Universe, type Coords, type PlanetLike } from '../rules/index.js';

export class GameError extends Error {}
export const fail = (m: string): never => { throw new GameError(m); };

export interface Planet extends PlanetLike {
  id: number; userId: number; g: number; s: number; home: boolean; name: string; dia: number;
  res: Res; resAt: number;
  bq: { id: string; start: number; end: number; cost: Res } | null;
  yq: { id: string; n: number; each: number }[]; yEnd: number; jgReady: number;
  raid: Raid | null;
}
/** The last hostile strike on a planet. */
export interface Raid { at: number; kind: 'attack' | 'missile'; by: string; won: boolean; lost: number }
export interface User {
  id: number; username: string; tech: Levels; points: number; dm: number;
  research: { id: string; planetId: number; start: number; end: number; cost: Res } | null;
}
export interface Fleet {
  id: number; userId: number; srcPlanetId: number | null; origin: Coords; target: Coords; targetUserId: number | null;
  mission: string; ships: Levels; cargo: Res; phase: 'out' | 'hold' | 'back'; start: number; end: number; dur: number;
  pct: number; // speed setting it was sent at
}

const planetOf = (r: any): Planet => ({
  id: r.id, userId: r.user_id, g: r.galaxy, s: r.system, p: r.position, moon: r.is_moon, home: r.is_home, name: r.name,
  fields: r.fields, temp: r.temp, dia: r.diameter, res: [r.metal, r.crystal, r.deut], resAt: r.res_at,
  b: r.buildings, u: r.units, pc: r.prod_pct, bq: r.build_queue, yq: r.yard_queue, yEnd: r.yard_end, jgReady: r.jg_ready,
  raid: r.raid ?? null,
});
const userOf = (r: any): User => ({ id: r.id, username: r.username, tech: r.tech, research: r.research, points: r.points, dm: r.dark_matter });
const fleetOf = (r: any): Fleet => ({
  id: r.id, userId: r.user_id, srcPlanetId: r.src_planet_id, origin: r.origin, target: r.target, targetUserId: r.target_user_id,
  mission: r.mission, ships: r.ships, cargo: r.cargo, phase: r.phase, start: r.start_at, end: r.end_at, dur: r.dur, pct: r.speed_pct ?? 100,
});
const j = (v: unknown) => JSON.stringify(v);

/* ---------- users ---------- */
export async function getUser(q: Sql, id: number) {
  const r = (await q.query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
  return r ? userOf(r) : null;
}
export async function saveUser(q: Sql, u: User) {
  // Points are only ever changed through addPoints, so a stale User object cannot overwrite them.
  await q.query('UPDATE users SET tech=$2, research=$3, dark_matter=$4 WHERE id=$1', [u.id, j(u.tech), j(u.research), u.dm]);
}
export async function addPoints(q: Sql, userId: number, resources: number) {
  await q.query('UPDATE users SET points = GREATEST(0, points + $2) WHERE id=$1', [userId, resources / 1000]);
}

/* ---------- planets ---------- */
export async function getPlanet(q: Sql, id: number) {
  const r = (await q.query('SELECT * FROM planets WHERE id=$1', [id])).rows[0];
  return r ? planetOf(r) : null;
}
export async function planetAt(q: Sql, c: Coords) {
  const r = (await q.query('SELECT * FROM planets WHERE galaxy=$1 AND system=$2 AND position=$3 AND is_moon=$4', [c.g, c.s, c.p, !!c.moon])).rows[0];
  return r ? planetOf(r) : null;
}
export async function userPlanets(q: Sql, userId: number) {
  return (await q.query('SELECT * FROM planets WHERE user_id=$1 ORDER BY is_home DESC, created_at, is_moon', [userId])).rows.map(planetOf);
}
export async function savePlanet(q: Sql, P: Planet) {
  await q.query(`UPDATE planets SET name=$2, metal=$3, crystal=$4, deut=$5, res_at=$6, buildings=$7, units=$8, prod_pct=$9,
    build_queue=$10, yard_queue=$11, yard_end=$12, jg_ready=$13, fields=$14, raid=$15 WHERE id=$1`,
    [P.id, P.name, P.res[0], P.res[1], P.res[2], P.resAt, j(P.b), j(P.u), j(P.pc), j(P.bq), j(P.yq), P.yEnd, P.jgReady, P.fields, j(P.raid ?? null)]);
}
export async function insertPlanet(q: Sql, P: Omit<Planet, 'id' | 'raid'>, createdAt: number) {
  const r = await q.query(`INSERT INTO planets (user_id, galaxy, system, position, is_moon, is_home, name, fields, temp, diameter,
      metal, crystal, deut, res_at, buildings, units, prod_pct, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'{}','{}','{}',$15) RETURNING id`,
    [P.userId, P.g, P.s, P.p, P.moon, P.home, P.name, P.fields, P.temp, P.dia, P.res[0], P.res[1], P.res[2], P.resAt, createdAt]);
  return r.rows[0].id as number;
}

/** Bring a planet's resources up to time t using its owner's research. */
export function syncPlanet(P: Planet, tech: Levels, U: Universe, t: number) {
  if (t > P.resAt) { P.res = accrue(P.res, production(P, tech, U), t - P.resAt); P.resAt = t; }
}

/* ---------- fleets ---------- */
export async function getFleet(q: Sql, id: number) {
  const r = (await q.query('SELECT * FROM fleets WHERE id=$1', [id])).rows[0];
  return r ? fleetOf(r) : null;
}
export async function insertFleet(q: Sql, f: Omit<Fleet, 'id'>) {
  const r = await q.query(`INSERT INTO fleets (user_id, src_planet_id, origin, target, target_user_id, mission, ships, cargo, phase, start_at, end_at, dur, speed_pct)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [f.userId, f.srcPlanetId, j(f.origin), j(f.target), f.targetUserId, f.mission, j(f.ships), j(f.cargo), f.phase, f.start, f.end, f.dur, f.pct]);
  return r.rows[0].id as number;
}
export async function saveFleet(q: Sql, f: Fleet) {
  await q.query('UPDATE fleets SET ships=$2, cargo=$3, phase=$4, start_at=$5, end_at=$6, dur=$7 WHERE id=$1',
    [f.id, j(f.ships), j(f.cargo), f.phase, f.start, f.end, f.dur]);
}
export async function deleteFleet(q: Sql, id: number) {
  await q.query('DELETE FROM fleets WHERE id=$1', [id]);
  await unschedule(q, 'fleet', id);
}
export async function userFleets(q: Sql, userId: number) {
  return (await q.query('SELECT * FROM fleets WHERE user_id=$1 ORDER BY end_at', [userId])).rows.map(fleetOf);
}
export async function incomingFleets(q: Sql, userId: number) {
  return (await q.query(`SELECT f.*, u.username AS owner FROM fleets f JOIN users u ON u.id=f.user_id
    WHERE f.target_user_id=$1 AND f.user_id<>$1 AND f.phase='out' ORDER BY f.end_at`, [userId])).rows.map(r => ({ ...fleetOf(r), owner: r.owner as string }));
}
export async function fleetsAt(q: Sql, c: Coords) {
  return (await q.query(`SELECT f.*, u.username AS owner FROM fleets f JOIN users u ON u.id=f.user_id
    WHERE (f.target->>'g')::int=$1 AND (f.target->>'s')::int=$2 AND (f.target->>'p')::int=$3
       OR (f.origin->>'g')::int=$1 AND (f.origin->>'s')::int=$2 AND (f.origin->>'p')::int=$3 ORDER BY f.end_at`,
    [c.g, c.s, c.p])).rows.map(r => ({ ...fleetOf(r), owner: r.owner as string }));
}

/* ---------- events ---------- */
export async function schedule(q: Sql, kind: string, ref: number, due: number) {
  await q.query('INSERT INTO events (due_at, kind, ref_id) VALUES ($1,$2,$3) ON CONFLICT (kind, ref_id) DO UPDATE SET due_at=EXCLUDED.due_at', [due, kind, ref]);
}
export async function unschedule(q: Sql, kind: string, ref: number) {
  await q.query('DELETE FROM events WHERE kind=$1 AND ref_id=$2', [kind, ref]);
}

/* ---------- debris and messages ---------- */
export async function addDebris(q: Sql, c: Coords, d: [number, number]) {
  if (d[0] + d[1] <= 0) return;
  await q.query(`INSERT INTO debris (galaxy, system, position, metal, crystal) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (galaxy, system, position) DO UPDATE SET metal=debris.metal+EXCLUDED.metal, crystal=debris.crystal+EXCLUDED.crystal`,
    [c.g, c.s, c.p, d[0], d[1]]);
}
export async function getDebris(q: Sql, c: Coords): Promise<[number, number] | null> {
  const r = (await q.query('SELECT metal, crystal FROM debris WHERE galaxy=$1 AND system=$2 AND position=$3', [c.g, c.s, c.p])).rows[0];
  return r && r.metal + r.crystal >= 1 ? [r.metal, r.crystal] : null;
}
export async function setDebris(q: Sql, c: Coords, d: [number, number]) {
  if (d[0] + d[1] < 1) await q.query('DELETE FROM debris WHERE galaxy=$1 AND system=$2 AND position=$3', [c.g, c.s, c.p]);
  else await q.query('UPDATE debris SET metal=$4, crystal=$5 WHERE galaxy=$1 AND system=$2 AND position=$3', [c.g, c.s, c.p, d[0], d[1]]);
}
export async function msg(q: Sql, userId: number, at: number, kind: 'sys' | 'combat' | 'spy', title: string, lines: string[]) {
  await q.query('INSERT INTO messages (user_id, at, kind, title, body) VALUES ($1,$2,$3,$4,$5)', [userId, at, kind, title, lines.join('\n')]);
}
export { sum3 };
