import { UN, RES_NAMES, POS_FIELDS_MIN, POS_FIELDS_AVG, POS_FIELDS_MAX, POS_TEMP } from './data.js';
import { lv, cargoCapacity, sum3, type Levels } from './formulas.js';
import type { Rng } from './combat.js';

/* ---------- espionage ---------- */
/** How much a report reveals: probes plus the squared Espionage lead (minus the squared deficit). */
export function espionageDepth(probes: number, attackerEs: number, defenderEs: number) {
  const d = attackerEs - defenderEs;
  return probes + Math.sign(d) * d * d;
}
export const revealFleet = (depth: number) => depth >= 2;
export const revealDefence = (depth: number) => depth >= 3;
export const revealBuildings = (depth: number) => depth >= 5;
export const revealResearch = (depth: number) => depth >= 7;
/** Chance the defender's ships catch the probes. */
export function counterEspionage(defenderShips: number, probes: number, attackerEs: number, defenderEs: number) {
  return Math.min(1, ((defenderShips * probes) / 400) * Math.pow(2, defenderEs - attackerEs));
}

/* ---------- colonisation ---------- */
/** Field count from a triangular distribution over the position's min/avg/max. */
export function rollColony(p: number, rng: Rng = Math.random) {
  const u = rng(), lo = POS_FIELDS_MIN[p - 1], av = POS_FIELDS_AVG[p - 1], hi = POS_FIELDS_MAX[p - 1];
  const fields = Math.round(u < 0.5 ? lo + (av - lo) * Math.sqrt(2 * u) : hi - (hi - av) * Math.sqrt(2 * (1 - u)));
  const temp = POS_TEMP[p - 1] - 20 + Math.floor(rng() * 41);
  return { fields, temp };
}

/* ---------- expeditions ---------- */
export type ExpeditionOutcome =
  | { kind: 'resources'; res: [number, number, number] }
  | { kind: 'ships'; ships: Levels }
  | { kind: 'darkMatter'; amount: number }
  | { kind: 'pirates' | 'aliens'; enemy: Levels; enemyTech: Levels }
  | { kind: 'delay'; factor: number }
  | { kind: 'early' }
  | { kind: 'blackHole' }
  | { kind: 'nothing' };

/** Expedition points are capped by the top player's score band; finds scale with ship value. */
export function expedition(ships: Levels, cargoUsed: number, topPoints: number, tech: Levels, rng: Rng = Math.random): ExpeditionOutcome {
  const raw = Object.keys(ships).reduce((a, k) => a + ships[k] * (UN[k].c[0] + UN[k].c[1]) / 200, 0);
  const cap = topPoints < 1e5 ? 2500 : topPoints < 1e6 ? 6000 : topPoints < 5e6 ? 9000 : 12000;
  const pts = Math.min(cap, raw);
  const r = rng(), z = rng();
  const fac = z < 0.89 ? 10 + rng() * 40 : z < 0.99 ? 50 + rng() * 50 : 100 + rng() * 100;
  if (r < 0.325) {
    const q = rng(), i = q < 0.5 ? 0 : q < 0.83 ? 1 : 2;
    const amt = Math.max(0, Math.floor(Math.min(cargoCapacity(ships) - cargoUsed, (fac * pts) / (i + 1))));
    const res: [number, number, number] = [0, 0, 0]; res[i] = amt;
    return { kind: 'resources', res };
  }
  if (r < 0.545) {
    let v = (fac * pts) / 2;
    const got: Levels = {}, pool = ['sc', 'lf', 'pr', 'lc', 'hf', 'cr', 'bs'];
    for (let i = 0; i < 400 && v >= 1000; i++) {
      const k = pool[Math.floor(rng() * pool.length)], c = UN[k].c[0] + UN[k].c[1];
      if (c <= v) { got[k] = (got[k] || 0) + 1; v -= c; }
    }
    return { kind: 'ships', ships: got };
  }
  if (r < 0.635) return { kind: 'darkMatter', amount: Math.floor(150 + rng() * 450) };
  if (r < 0.719) {
    const aliens = r >= 0.693, ratio = (aliens ? 0.4 : 0.3) + rng() * 0.2, d = aliens ? 3 : -3;
    const enemyTech = { we: Math.max(0, lv(tech, 'we') + d), sh: Math.max(0, lv(tech, 'sh') + d), ar: Math.max(0, lv(tech, 'ar') + d) };
    const enemy: Levels = {};
    for (const k in ships) if (ships[k] > 0 && UN[k].a > 1) enemy[k] = Math.ceil(ships[k] * ratio);
    enemy.lf = (enemy.lf || 0) + 5;
    return { kind: aliens ? 'aliens' : 'pirates', enemy, enemyTech };
  }
  if (r < 0.789) return { kind: 'delay', factor: [2, 3, 5][Math.floor(rng() * 3)] };
  if (r < 0.809) return { kind: 'early' };
  if (r < 0.812) return { kind: 'blackHole' };
  return { kind: 'nothing' };
}

/* ---------- text helpers shared by server reports and client ---------- */
export const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');
export const unitList = (o: Levels) =>
  Object.keys(o).filter(k => o[k] > 0).map(k => `${fmt(o[k])} ${UN[k].n}`).join(', ') || 'none';
export const resText = (r: number[]) => `${fmt(r[0])} metal, ${fmt(r[1])} crystal, ${fmt(r[2])} deuterium`;
export const coordText = (c: { g: number; s: number; p: number; moon?: boolean }) => `[${c.g}:${c.s}:${c.p}]${c.moon ? ' moon' : ''}`;
export const resName = (i: number) => RES_NAMES[i].toLowerCase();
export { sum3 };
