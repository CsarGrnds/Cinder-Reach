import { orbitalDistance, MAX_ORBIT_POSITION } from './orbits.js';
import { BLD, TECH, UN, POS_BONUS_METAL, POS_BONUS_CRYSTAL, type Res, type Req, type BuildingDef, type TechDef } from './data.js';

export interface Universe {
  speed: number;          // economy speed
  fleetSpeed: number;     // fleet speed
  galaxies: number;
  systems: number;
  debrisFactor: number;   // share of destroyed ship metal/crystal turned into debris
  defenceRebuild: number; // chance each destroyed defence unit is rebuilt
  noobProtection: number; // points below which a player is protected from much stronger players
}

export type Levels = Record<string, number>;
export interface Coords { g: number; s: number; p: number; moon?: boolean }

/** The parts of a planet the rules need. */
export interface PlanetLike {
  p: number; temp: number; moon: boolean; fields: number;
  b: Levels; u: Levels; pc: Levels;
}

export const H = 3_600_000;
export const lv = (o: Levels, k: string) => o[k] ?? 0;
export const sum3 = (c: number[]) => c[0] + c[1] + c[2];
const f11 = (x: number, l: number) => x * l * Math.pow(1.1, l);

export const costAt = (d: BuildingDef | TechDef, level: number): Res =>
  d.c.map(x => Math.floor(x * Math.pow(d.f ?? 2, level))) as Res;
export const energyAt = (d: BuildingDef | TechDef, level: number) =>
  d.e ? Math.floor(d.e * Math.pow(d.f ?? 2, level)) : 0;

export const storageCap = (level: number) => 5000 * Math.floor(2.5 * Math.exp((20 * level) / 33));
export const fieldsOf = (P: PlanetLike) => (P.moon ? 1 + 3 * lv(P.b, 'lb') : P.fields + 5 * lv(P.b, 'tf'));
export const fieldsUsed = (P: PlanetLike) => Object.values(P.b).reduce((a, b) => a + b, 0);

/** Requirements not yet met, as readable strings. Building levels come from the planet, research from tech. */
export function missing(req: Req | undefined, b: Levels, tech: Levels): string[] {
  return Object.entries(req ?? {})
    .filter(([k, n]) => (k in BLD ? lv(b, k) : lv(tech, k)) < n)
    .map(([k, n]) => `${(BLD[k] ?? TECH[k]).n} ${n}`);
}

export const satEnergy = (temp: number) => Math.floor((temp + 140) / 6);

export interface Production {
  h: Res;          // net per hour
  use: number;     // energy demand
  out: number;     // energy supply
  k: number;       // mine efficiency 0..1
  cap: Res;
  x: { mm: number; cm: number; ds: number; frd: number; sol: number; fus: number; sat: number };
}

export function production(P: PlanetLike, tech: Levels, U: Universe): Production {
  const b = P.b, sp = U.speed;
  const cap: Res = [storageCap(lv(b, 'ms')), storageCap(lv(b, 'cs')), storageCap(lv(b, 'dt'))];
  if (P.moon) return { h: [0, 0, 0], use: 0, out: 0, k: 1, cap, x: { mm: 0, cm: 0, ds: 0, frd: 0, sol: 0, fus: 0, sat: 0 } };
  const pc = (k: string) => (P.pc[k] ?? 100) / 100;
  const use = f11(10, lv(b, 'mm')) * pc('mm') + f11(10, lv(b, 'cm')) * pc('cm') + f11(20, lv(b, 'ds')) * pc('ds');
  const sat = lv(P.u, 'sat') * satEnergy(P.temp) * pc('sat');
  const fus = 30 * lv(b, 'fr') * Math.pow(1.05 + 0.01 * lv(tech, 'en'), lv(b, 'fr')) * pc('fr');
  const sol = f11(20, lv(b, 'sp')) * pc('sp');
  const out = sol + fus + sat;
  const k = use ? Math.min(1, out / use) : 1;
  const pl = lv(tech, 'pl');
  const x = {
    mm: f11(30, lv(b, 'mm')) * pc('mm') * k * (1 + 0.01 * pl + (POS_BONUS_METAL[P.p] ?? 0)) * sp,
    cm: f11(20, lv(b, 'cm')) * pc('cm') * k * (1 + 0.0066 * pl + (POS_BONUS_CRYSTAL[P.p] ?? 0)) * sp,
    ds: f11(10, lv(b, 'ds')) * pc('ds') * k * (1.44 - 0.004 * P.temp) * (1 + 0.0033 * pl) * sp,
    frd: -f11(10, lv(b, 'fr')) * pc('fr') * sp,
    sol, fus, sat,
  };
  return { h: [30 * sp + x.mm, 15 * sp + x.cm, x.ds + x.frd], use, out, k, cap, x };
}

/** Advance stored resources by `ms` of production. Production stops at storage capacity; deuterium burn can go below it. */
export function accrue(res: Res, prod: Production, ms: number): Res {
  const hr = ms / H, out = res.slice() as Res;
  for (let i = 0; i < 3; i++) {
    const x = prod.h[i];
    if (x > 0) { if (out[i] < prod.cap[i]) out[i] = Math.min(prod.cap[i], out[i] + x * hr); }
    else out[i] = Math.max(0, out[i] + x * hr);
  }
  return out;
}

export const buildTime = (b: Levels, c: Res, U: Universe) =>
  Math.max(1000, ((c[0] + c[1]) / (2500 * (1 + lv(b, 'ro')) * Math.pow(2, lv(b, 'na')) * U.speed)) * H);
export const researchTime = (labLevels: number, c: Res, U: Universe) =>
  Math.max(1000, ((c[0] + c[1]) / (1000 * (1 + labLevels) * U.speed)) * H);
export const unitTime = (b: Levels, c: Res, U: Universe) =>
  Math.max(1000, ((c[0] + c[1]) / (2500 * (1 + lv(b, 'sy')) * Math.pow(2, lv(b, 'na')) * U.speed)) * H);

/** Research speed uses this lab plus, with the network, the highest labs on your other planets. */
export function labNetwork(labHere: number, otherLabs: number[], irn: number) {
  return labHere + otherLabs.slice().sort((a, b) => b - a).slice(0, irn).reduce((a, b) => a + b, 0);
}

export const maxPlanets = (tech: Levels) => 1 + Math.floor((lv(tech, 'as') + 1) / 2);
export const maxExpeditions = (tech: Levels) => Math.floor(Math.sqrt(lv(tech, 'as')));
export const fleetSlots = (tech: Levels) => 1 + lv(tech, 'co');
export const positionNeeds = (p: number) => (p === 1 || p === 15 ? 8 : p === 2 || p === 14 ? 6 : p === 3 || p === 13 ? 4 : 1);
export const missileRange = (tech: Levels) => Math.max(0, lv(tech, 'id') * 5 - 1);
export const phalanxRange = (level: number) => Math.max(0, level * level - 1);
export const siloSlots = (b: Levels) => lv(b, 'si') * 10;
export const siloUsed = (u: Levels) => lv(u, 'abm') * 1 + lv(u, 'ipm') * 2;

/* ---------- flight ---------- */
/** Flight distance. Inside a system it depends on where the two planets are on their orbits at time t;
 *  without a time (or for outer space, position 16) the classic fixed formula applies. */
export function distance(a: Coords, b: Coords, t?: number, U?: Universe) {
  if (a.g !== b.g) return 20000 * Math.abs(a.g - b.g);
  if (a.s !== b.s) return 2700 + 95 * Math.abs(a.s - b.s);
  if (a.p !== b.p) {
    if (t != null && U && a.p <= MAX_ORBIT_POSITION && b.p <= MAX_ORBIT_POSITION) return orbitalDistance(a, b, t, U);
    return 1000 + 5 * Math.abs(a.p - b.p);
  }
  return 5;
}

export function shipSpeed(k: string, tech: Levels) {
  const u = UN[k];
  let v = u.v ?? 0, dr = u.dr ?? 'cd', fu = u.fu ?? 0;
  if (k === 'sc' && lv(tech, 'id') >= 5) { v = 10000; dr = 'id'; fu = 20; }
  if (k === 'bo' && lv(tech, 'hd') >= 8) { v = 5000; dr = 'hd'; }
  return { v: v * (1 + { cd: 0.1, id: 0.2, hd: 0.3 }[dr] * lv(tech, dr)), fu };
}

/** Flight time (ms, one way) and deuterium for a fleet at speed `pct` (10..100), departing at time t. */
export function flight(ships: Levels, a: Coords, b: Coords, pct: number, tech: Levels, U: Universe, t?: number) {
  const d = distance(a, b, t, U);
  let vmin = Infinity;
  for (const k in ships) if (ships[k] > 0) vmin = Math.min(vmin, shipSpeed(k, tech).v);
  const sec = (35000 / pct) * Math.sqrt((d * 10) / vmin) + 10;
  let fuel = 0;
  for (const k in ships) if (ships[k] > 0) {
    const sp = shipSpeed(k, tech);
    const x = (35000 / (sec - 10)) * Math.sqrt((d * 10) / sp.v);
    fuel += (sp.fu * ships[k] * d / 35000) * Math.pow(x / 10 + 1, 2);
  }
  return { d, dur: Math.round((sec / U.fleetSpeed) * 1000), fuel: Math.round(fuel) + 1 };
}

export const cargoCapacity = (ships: Levels) => Object.keys(ships).reduce((a, k) => a + (UN[k].cap ?? 0) * ships[k], 0);
export const unitValue = (units: Levels) => Object.keys(units).reduce((a, k) => a + sum3(UN[k].c) * (units[k] || 0), 0);
export const count = (o: Levels) => Object.values(o).reduce((a, n) => a + (n || 0), 0);

/** Players under the protection limit cannot be attacked by, and cannot attack, players 5x their size. */
export function noobProtected(attackerPts: number, defenderPts: number, U: Universe) {
  if (defenderPts < U.noobProtection && attackerPts > defenderPts * 5) return 'target is under newcomer protection';
  if (attackerPts < U.noobProtection && defenderPts > attackerPts * 5) return 'you are under newcomer protection and the target is too strong';
  return '';
}
