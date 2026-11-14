import { UN, RF, DEFENCE_ORDER } from './data.js';
import { lv, type Levels } from './formulas.js';

export type Rng = () => number;

interface Unit { k: string; h: number; H: number; s: number; S: number; a: number; x: boolean }
export interface BattleResult { rounds: number; A: Levels; D: Levels; res: 'att' | 'def' | 'draw' }

/** Classic six-round battle: random targets, shields regenerate each round, shots under 1% of shield bounce,
 *  units below 70% hull may explode, rapid fire grants extra shots. */
export function battle(att: Levels, aTech: Levels, def: Levels, dTech: Levels, rng: Rng = Math.random): BattleResult {
  const mk = (o: Levels, T: Levels) => {
    const a: Unit[] = [];
    for (const k in o) {
      const u = UN[k];
      const Hh = ((u.c[0] + u.c[1]) / 10) * (1 + 0.1 * lv(T, 'ar'));
      const Sh = u.s * (1 + 0.1 * lv(T, 'sh'));
      const A = u.a * (1 + 0.1 * lv(T, 'we'));
      for (let i = 0; i < (o[k] || 0); i++) a.push({ k, h: Hh, H: Hh, s: Sh, S: Sh, a: A, x: false });
    }
    return a;
  };
  let A = mk(att, aTech), D = mk(def, dTech), rounds = 0;
  const volley = (F: Unit[], Tg: Unit[]) => {
    const n = Tg.length;
    for (const u of F) {
      let again = true;
      while (again) {
        again = false;
        const t = Tg[Math.floor(rng() * n)];
        if (u.a > 0 && !t.x && u.a >= t.S * 0.01) {
          let d = u.a;
          if (t.s >= d) t.s -= d;
          else {
            d -= t.s; t.s = 0; t.h -= d;
            if (t.h <= 0 || (t.h < 0.7 * t.H && rng() < 1 - t.h / t.H)) t.x = true;
          }
        }
        const rf = RF[u.k]?.[t.k];
        if (rf && rng() < (rf - 1) / rf) again = true;
      }
    }
  };
  while (rounds < 6 && A.length && D.length) {
    rounds++;
    volley(A, D); volley(D, A);
    A = A.filter(u => !u.x); D = D.filter(u => !u.x);
    A.forEach(u => (u.s = u.S)); D.forEach(u => (u.s = u.S));
  }
  const tally = (a: Unit[]) => { const o: Levels = {}; a.forEach(u => (o[u.k] = (o[u.k] || 0) + 1)); return o; };
  return { rounds, A: tally(A), D: tally(D), res: !D.length && A.length ? 'att' : !A.length ? 'def' : 'draw' };
}

/** Losses, defence rebuild and the debris they create. */
export function settle(before: Levels, after: Levels, debrisFactor: number, rebuild: number, rng: Rng = Math.random) {
  const lost: Levels = {}, out: Levels = {};
  let dm = 0, dc = 0;
  for (const k in before) {
    const b = before[k] || 0;
    if (!b) continue;
    let a = after[k] || 0;
    const l = b - a;
    if (l > 0) {
      if (UN[k].def) { let r = 0; for (let i = 0; i < l; i++) if (rng() < rebuild) r++; a += r; lost[k] = l - r; }
      else { lost[k] = l; dm += UN[k].c[0] * l * debrisFactor; dc += UN[k].c[1] * l * debrisFactor; }
    }
    if (a) out[k] = a;
    if (lost[k] === 0) delete lost[k];
  }
  return { out, lost, debris: [Math.floor(dm), Math.floor(dc)] as [number, number] };
}

/** Half of each resource is exposed; fill the hold a third metal, half the remainder crystal, then deuterium, then top up. */
export function plunder(res: number[], cap: number): [number, number, number] {
  const av = res.map(x => Math.floor(Math.max(0, x) / 2));
  const t = [0, 0, 0];
  let c = Math.max(0, cap), x: number;
  x = Math.min(av[0], c / 3); t[0] = x; c -= x;
  x = Math.min(av[1], c / 2); t[1] = x; c -= x;
  x = Math.min(av[2], c); t[2] = x; c -= x;
  x = Math.min(av[0] - t[0], c / 2); t[0] += x; c -= x;
  x = Math.min(av[1] - t[1], c); t[1] += x;
  return t.map(Math.floor) as [number, number, number];
}

/** 1% per 100,000 units of debris, up to 20%. */
export const moonChance = (debrisTotal: number) => Math.min(20, Math.floor(debrisTotal / 100000));
export const moonDiameter = (chance: number, rng: Rng = Math.random) => Math.floor(Math.sqrt(10 + rng() * 10 + 3 * chance) * 1000);

/** Interplanetary missile strike against defences, cheapest first. */
export function missileStrike(missiles: number, attackerWeapons: number, defence: Levels, defenderArmour: number, abm: number) {
  const intercepted = Math.min(missiles, abm);
  let dmg = (missiles - intercepted) * 12000 * (1 + 0.1 * attackerWeapons);
  const lost: Levels = {};
  for (const d of DEFENCE_ORDER) {
    const c = defence[d] || 0;
    if (!c) continue;
    const hp = ((UN[d].c[0] + UN[d].c[1]) / 10) * (1 + 0.1 * defenderArmour);
    const x = Math.min(c, Math.floor(dmg / hp));
    if (x) { lost[d] = x; dmg -= x * hp; }
  }
  return { intercepted, lost };
}
