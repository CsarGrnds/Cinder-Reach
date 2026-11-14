import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLD, TECH, UN, costAt, storageCap, production, buildTime, flight, distance, plunder, battle, settle, moonChance,
  maxPlanets, maxExpeditions, positionNeeds, missileStrike, espionageDepth, rollColony, noobProtected, H,
} from '../src/rules/index.ts';
import { TEST_UNIVERSE as U } from './helpers.ts';

const planet = (b: Record<string, number>, p = 8, temp = 50) => ({ p, temp, moon: false, fields: 163, b, u: {}, pc: {} });

test('classic building costs', () => {
  assert.deepEqual(costAt(BLD.mm, 0), [60, 15, 0]);
  assert.deepEqual(costAt(BLD.mm, 1), [90, 22, 0]);
  assert.deepEqual(costAt(BLD.cm, 1), [76, 38, 0]);
  assert.deepEqual(costAt(TECH.as, 1), [7000, 14000, 7000]);
});

test('storage starts at 10,000 and grows exponentially', () => {
  assert.equal(storageCap(0), 10000);
  assert.equal(storageCap(1), 20000);
  assert.equal(storageCap(2), 40000);
});

test('production: base income, mine output, energy shortfall, position bonus, universe speed', () => {
  const none = production(planet({}), {}, U);
  assert.deepEqual(none.h, [30, 15, 0]);
  const mm1 = production(planet({ mm: 1, sp: 1 }, 4), {}, U);
  assert.equal(Math.round(mm1.h[0]), 30 + 33);
  const starved = production(planet({ mm: 5 }, 4), {}, U);
  assert.equal(starved.k, 0);
  assert.equal(starved.h[0], 30);
  const bonus = production(planet({ mm: 1, sp: 1 }, 8), {}, U);
  assert.ok(Math.abs(bonus.x.mm - 33 * 1.35) < 1e-9);
  const fast = production(planet({ mm: 1, sp: 1 }, 4), {}, { ...U, speed: 4 });
  assert.equal(Math.round(fast.h[0]), 4 * 63);
});

test('build time scales with robotics and speed', () => {
  const c = costAt(BLD.mm, 10);
  const base = buildTime({}, c, U);
  assert.ok(Math.abs(buildTime({ ro: 1 }, c, U) - base / 2) < 1);
  assert.ok(Math.abs(buildTime({}, c, { ...U, speed: 5 }) - base / 5) < 1);
  assert.equal(buildTime({}, [0, 0, 0], U), 1000);
});

test('distances and flight', () => {
  assert.equal(distance({ g: 1, s: 1, p: 1 }, { g: 1, s: 1, p: 1 }), 5);
  assert.equal(distance({ g: 1, s: 1, p: 1 }, { g: 1, s: 1, p: 4 }), 1015);
  assert.equal(distance({ g: 1, s: 1, p: 1 }, { g: 1, s: 3, p: 1 }), 2890);
  assert.equal(distance({ g: 1, s: 1, p: 1 }, { g: 3, s: 1, p: 1 }), 40000);
  const f = flight({ lf: 1 }, { g: 1, s: 1, p: 1 }, { g: 1, s: 1, p: 4 }, 100, { cd: 0 }, U);
  assert.equal(f.dur, Math.round((350 * Math.sqrt(10150 / 12500) + 10) * 1000));
  const slow = flight({ lf: 1 }, { g: 1, s: 1, p: 1 }, { g: 1, s: 1, p: 4 }, 50, { cd: 0 }, U);
  assert.ok(slow.dur > f.dur && slow.fuel < f.fuel);
  const quick = flight({ lf: 1 }, { g: 1, s: 1, p: 1 }, { g: 1, s: 1, p: 4 }, 100, { cd: 0 }, { ...U, fleetSpeed: 2 });
  assert.ok(Math.abs(quick.dur - f.dur / 2) <= 1);
});

test('plunder takes at most half of each resource and respects the hold', () => {
  assert.deepEqual(plunder([10000, 10000, 10000], 1e9), [5000, 5000, 5000]);
  const t = plunder([100000, 100000, 100000], 9000);
  assert.equal(t[0] + t[1] + t[2], 9000);
});

test('battle: overwhelming force wins, shields bounce weak shots, debris is 30% of ships only', () => {
  const r = battle({ cr: 50 }, {}, { rl: 20 }, {});
  assert.equal(r.res, 'att');
  const bounce = battle({ lf: 1 }, {}, { ld: 1 }, {});
  assert.equal(bounce.D.ld, 1);
  const s = settle({ lf: 10, rl: 10 }, {}, 0.3, 0, () => 0.99);
  assert.deepEqual(s.debris, [9000, 3000]);
  assert.equal(s.lost.rl, 10);
  const rebuilt = settle({ rl: 10 }, {}, 0.3, 0.7, () => 0.1);
  assert.equal(rebuilt.out.rl, 10);
  assert.equal(moonChance(2_500_000), 20);
  assert.equal(moonChance(150_000), 1);
});

test('astrophysics limits', () => {
  assert.equal(maxPlanets({}), 1);
  assert.equal(maxPlanets({ as: 1 }), 2);
  assert.equal(maxPlanets({ as: 3 }), 3);
  assert.equal(maxExpeditions({ as: 4 }), 2);
  assert.deepEqual([1, 2, 3, 8, 13, 14, 15].map(positionNeeds), [8, 6, 4, 1, 4, 6, 8]);
});

test('colony size stays inside the position table', () => {
  for (let i = 0; i < 200; i++) {
    const { fields } = rollColony(15);
    assert.ok(fields >= 65 && fields <= 74);
  }
});

test('missiles: interception and cheapest defences first', () => {
  const s = missileStrike(3, 0, { rl: 100, pt: 1 }, 0, 1);
  assert.equal(s.intercepted, 1);
  assert.equal(s.lost.rl, 100);
  assert.equal(s.lost.pt, undefined);
});

test('espionage depth and newcomer protection', () => {
  assert.equal(espionageDepth(1, 4, 2), 5);
  assert.equal(espionageDepth(3, 1, 2), 2);
  const U2 = { ...U, noobProtection: 50000 };
  assert.ok(noobProtected(10000, 1000, U2));
  assert.equal(noobProtected(10000, 5000, U2), '');
  assert.equal(noobProtected(900000, 100000, U2), '');
});

test('every unit has a positive cost and every requirement exists', () => {
  for (const [k, u] of Object.entries(UN)) {
    assert.ok(u.c[0] + u.c[1] + u.c[2] > 0, k);
    for (const r of Object.keys(u.req)) assert.ok(r in BLD || r in TECH, `${k} needs unknown ${r}`);
  }
  assert.equal(H, 3_600_000);
});

test('orbits: in-system distance moves between the closest and furthest possible as planets orbit', async () => {
  const { orbitalDistance, orbitalRange, closestApproach, orbitPeriod } = await import('../src/rules/index.ts');
  const a = { g: 1, s: 7, p: 4 }, b = { g: 1, s: 7, p: 9 };
  const r = orbitalRange(4, 9);
  assert.equal(r.min, 1300);
  assert.equal(r.max, 1780);
  const t0 = Date.UTC(2026, 0, 1);
  const seen: number[] = [];
  for (let h = 0; h < 200; h++) seen.push(orbitalDistance(a, b, t0 + h * H, U));
  assert.ok(Math.min(...seen) < 1400 && Math.max(...seen) > 1700, 'distance swings across the range');
  assert.ok(seen.every(d => d >= r.min && d <= r.max));
  const ca = closestApproach(a, b, t0, U);
  assert.ok(ca.at >= t0 && ca.distance <= r.min + 2);
  assert.ok(orbitPeriod(4, U) < orbitPeriod(9, U), 'inner planets orbit faster');
  assert.ok(Math.abs(orbitPeriod(5, { ...U, fleetSpeed: 2 }) - 3 * H) < 1, 'fleet speed speeds up orbits');
  // Same coordinates, same answer for everyone; no time means the classic formula.
  assert.equal(orbitalDistance(a, b, t0, U), orbitalDistance({ ...b }, { ...a }, t0, U));
  assert.equal(distance(a, b), 1025);
  assert.equal(distance(a, b, t0, U), orbitalDistance(a, b, t0, U));
  assert.equal(distance({ g: 1, s: 7, p: 4 }, { g: 1, s: 7, p: 16 }, t0, U), 1060, 'outer space keeps the classic distance');
  const near = flight({ lf: 10 }, a, b, 100, {}, U, ca.at), far = flight({ lf: 10 }, a, b, 100, {}, U, ca.at + orbitPeriod(4, U) / 2);
  assert.ok(near.dur <= far.dur && near.fuel <= far.fuel);
});

test('orbits: missiles take longer when the target is on the far side of the star', async () => {
  const { missileFlightTime, closestApproach, orbitalDistance, orbitPeriod } = await import('../src/rules/index.ts');
  const a = { g: 1, s: 7, p: 4 }, b = { g: 1, s: 7, p: 9 }, t0 = Date.UTC(2026, 0, 1);
  const ca = closestApproach(a, b, t0, U);
  let far = ca.at, fd = 0;
  for (let i = 0; i < 2000; i++) { const t = ca.at + i * 60_000; const d = orbitalDistance(a, b, t, U); if (d > fd) { fd = d; far = t; } }
  const near = missileFlightTime(a, b, ca.at, U), away = missileFlightTime(a, b, far, U);
  assert.equal(near, Math.round(30 * ca.distance));
  assert.ok(away > near * 1.3);
  assert.equal(missileFlightTime(a, { g: 1, s: 9, p: 4 }, t0, U), 150_000, 'other systems keep 30 s + 60 s per system');
  assert.ok(orbitPeriod(4, U) > 0);
});
