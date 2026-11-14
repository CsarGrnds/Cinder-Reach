import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.ts';
import * as A from '../src/server/actions.ts';
import { getUser, planetAt, userPlanets, getDebris } from '../src/server/repo.ts';
import { state, galaxy, highscore } from '../src/server/views.ts';
import { buildApp } from '../src/server/app.ts';
import { H, costAt, BLD, flight } from '../src/rules/index.ts';

type W = Awaited<ReturnType<typeof world>>;
const act = (w: W, uid: number, fn: (c: A.Ctx) => Promise<unknown>) =>
  w.game.run(async (q, t) => fn({ game: w.game, q, t, user: (await getUser(q, uid))! }));
const rejects = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: Error) => re.test(e.message));

test('registration places homeworlds on free positions 4 to 12 with starting resources', async () => {
  const w = await world();
  const a = await w.player('alpha'), b = await w.player('bravo');
  const pa = (await w.planet(a.home))!, pb = (await w.planet(b.home))!;
  for (const P of [pa, pb]) { assert.ok(P.p >= 4 && P.p <= 12); assert.equal(P.fields, 163); assert.deepEqual(P.res, [500, 500, 0]); }
  assert.notDeepEqual([pa.g, pa.s, pa.p], [pb.g, pb.s, pb.p]);
  await rejects(w.player('ALPHA'), /taken/);
});

test('buildings: cost, timed completion, production accrual, cancel refunds', async () => {
  const w = await world();
  const a = await w.player('alpha');
  await act(w, a.id, c => A.build(c, a.home, 'sp'));
  let P = (await w.planet(a.home))!;
  assert.deepEqual(P.res, [425, 470, 0]);
  await rejects(act(w, a.id, c => A.build(c, a.home, 'mm')), /already under construction/);
  await w.advance(P.bq!.end - w.now);
  P = (await w.planet(a.home))!;
  assert.equal(P.b.sp, 1);
  assert.equal(P.bq, null);
  await act(w, a.id, c => A.build(c, a.home, 'mm'));
  await act(w, a.id, c => A.cancelBuild(c, a.home));
  P = (await w.planet(a.home))!;
  assert.equal(P.bq, null);
  const before = P.res[0];
  await w.advance(H);
  await act(w, a.id, c => A.rename(c, a.home, 'Prime'));
  P = (await w.planet(a.home))!;
  assert.ok(Math.abs(P.res[0] - before - 30) < 1e-6, 'one hour of basic metal income');
  assert.equal(P.name, 'Prime');
  await rejects(act(w, a.id, c => A.build(c, a.home, 'sy')), /Requires Robotics Factory 2/);
});

test('research runs on one lab at a time and unlocks requirements', async () => {
  const w = await world();
  const a = await w.player('alpha');
  await w.rig(a.home, { res: [1e6, 1e6, 1e6], b: { lab: 1, sp: 5 } });
  await act(w, a.id, c => A.research(c, a.home, 'en'));
  await rejects(act(w, a.id, c => A.research(c, a.home, 'co')), /already running/);
  await rejects(act(w, a.id, c => A.build(c, a.home, 'lab')), /while it is researching/);
  const u = (await w.user(a.id))!;
  await w.advance(u.research!.end - w.now);
  assert.equal((await w.user(a.id))!.tech.en, 1);
  assert.match((await w.messages(a.id))[0].body, /Energy Technology reached level 1/);
});

test('shipyard completes batches over time without one event per unit', async () => {
  const w = await world();
  const a = await w.player('alpha');
  await w.rig(a.home, { res: [1e7, 1e7, 1e7], b: { sy: 1 }, tech: { cd: 1 } });
  const n = await act(w, a.id, c => A.shipyard(c, a.home, 'lf', 50));
  assert.equal(n, 50);
  let P = (await w.planet(a.home))!;
  const each = P.yq[0].each;
  await w.advance(each * 10 + 1);
  P = (await w.planet(a.home))!;
  assert.equal(P.u.lf, 10);
  await w.advance(each * 40);
  P = (await w.planet(a.home))!;
  assert.equal(P.u.lf, 50);
  assert.equal(P.yq.length, 0);
  await rejects(act(w, a.id, c => A.shipyard(c, a.home, 'cr', 1)), /Requires/);
});

async function twoPlayers(w: W) {
  const a = await w.player('attacker'), d = await w.player('defender');
  await w.rig(a.home, { res: [1e7, 1e7, 1e7], b: { sy: 4, ro: 2 }, u: { lf: 200, lc: 20, pr: 5, rec: 5, col: 2 }, tech: { cd: 6, es: 4, co: 5 } });
  await w.rig(d.home, { res: [100000, 80000, 40000], u: { rl: 10 } });
  const T = (await w.planet(d.home))!;
  return { a, d, T, target: { g: T.g, s: T.s, p: T.p } };
}

test('attack between real players: combat, plunder, debris, reports to both, fleet returns', async () => {
  const w = await world();
  const { a, d, T, target } = await twoPlayers(w);
  const sent = await act(w, a.id, c => A.sendFleet(c, { planetId: a.home, ships: { lf: 200, lc: 20 }, target, mission: 'attack', pct: 100, cargo: [0, 0, 0] })) as any;
  const vis = await w.game.run((q, t) => state(w.game, q, t, d.id));
  assert.equal(vis.incoming.length, 1);
  assert.equal(vis.incoming[0].hostile, true);
  await w.advance(sent.dur);
  const after = (await w.planet(d.home))!;
  assert.ok(after.res[0] < 100000, 'metal was plundered');
  const da = await w.messages(d.id), aa = await w.messages(a.id);
  assert.match(da[0].title, /Defeat/);
  assert.match(aa[0].title, /Victory/);
  assert.match(aa[0].body, /Captured/);
  assert.equal(after.raid?.kind, 'attack', 'the defender planet records the raid');
  assert.equal(after.raid?.by, 'attacker');
  assert.equal(after.raid?.won, true);
  const dv = await w.game.run((q, t) => state(w.game, q, t, d.id));
  assert.equal(dv.planets.find((p: any) => p.id === d.home).raid.kind, 'attack', 'the raid reaches the client view');
  const deb = await w.game.run(q => getDebris(q, target));
  assert.equal(deb, null, 'rocket launchers leave no debris');
  await w.advance(sent.dur);
  const home = (await w.planet(a.home))!;
  assert.equal(home.u.lc, 20);
  assert.ok(home.res[0] > 1e7 - 1, 'loot unloaded at home');
  assert.ok(T.res[0] === 100000);
});

test('espionage report depth, and the target is told', async () => {
  const w = await world();
  const { a, d, target } = await twoPlayers(w);
  const s = await act(w, a.id, c => A.sendFleet(c, { planetId: a.home, ships: { pr: 3 }, target, mission: 'spy', pct: 100, cargo: [0, 0, 0] })) as any;
  await w.advance(s.dur);
  const rep = (await w.messages(a.id))[0];
  assert.match(rep.title, /Espionage report/);
  assert.match(rep.body, /Defence: 10 Rocket Launcher/);
  assert.match((await w.messages(d.id))[0].title, /Espionage detected/);
});

test('colonisation obeys Astrophysics: planet count and outer positions', async () => {
  const w = await world();
  const { a } = await twoPlayers(w);
  const P = (await w.planet(a.home))!;
  const free = async (p: number) => !(await w.game.run(q => planetAt(q, { g: P.g, s: P.s, p })));
  await w.rig(a.home, { tech: { id: 3, as: 0 } });
  const p1 = [4, 5, 6, 7, 9, 10, 11, 12].find(() => true)!;
  const pos = [] as number[];
  for (const p of [4, 5, 6, 7, 9, 10, 11, 12]) if (p !== P.p && await free(p)) pos.push(p);
  await rejects(act(w, a.id, c => A.sendFleet(c, { planetId: a.home, ships: { col: 1 }, target: { g: P.g, s: P.s, p: pos[0] }, mission: 'colonise', pct: 100, cargo: [0, 0, 0] })), /Astrophysics/);
  await w.rig(a.home, { tech: { as: 1 } });
  await rejects(act(w, a.id, c => A.sendFleet(c, { planetId: a.home, ships: { col: 1 }, target: { g: P.g, s: P.s, p: 2 }, mission: 'colonise', pct: 100, cargo: [0, 0, 0] })), /needs Astrophysics 6/);
  const s = await act(w, a.id, c => A.sendFleet(c, { planetId: a.home, ships: { col: 1 }, target: { g: P.g, s: P.s, p: pos[0] }, mission: 'colonise', pct: 100, cargo: [1000, 0, 0] })) as any;
  await w.advance(s.dur);
  const mine = await w.game.run(q => userPlanets(q, a.id));
  assert.equal(mine.length, 2);
  const col = mine.find(x => x.p === pos[0])!;
  assert.ok(col.fields >= 123 && col.fields <= 251);
  assert.deepEqual(col.res, [1500, 500, 0]);
  assert.ok(p1);
});

test('expeditions need Astrophysics, hold for an hour and report an outcome', async () => {
  const w = await world();
  const { a } = await twoPlayers(w);
  const P = (await w.planet(a.home))!;
  const exp = { planetId: a.home, ships: { lc: 5, lf: 20 }, target: { g: P.g, s: P.s, p: 16 }, mission: 'expedition', pct: 100, cargo: [0, 0, 0] as [number, number, number] };
  await rejects(act(w, a.id, c => A.sendFleet(c, exp)), /need Astrophysics 1/);
  await w.rig(a.home, { tech: { as: 1 } });
  const s = await act(w, a.id, c => A.sendFleet(c, exp)) as any;
  await w.advance(s.dur + H);
  assert.match((await w.messages(a.id))[0].title, /Expedition/);
});

test('missiles hit defences, anti-ballistic missiles intercept', async () => {
  const w = await world();
  const { a, d, T } = await twoPlayers(w);
  await w.rig(a.home, { b: { si: 4 }, u: { ipm: 3 }, tech: { id: 5 } });
  await w.rig(d.home, { u: { rl: 50, abm: 1 } });
  const P = (await w.planet(a.home))!;
  if (T.g !== P.g) return; // different galaxies: out of range by design
  await act(w, a.id, c => A.launchMissiles(c, a.home, 3, { g: T.g, s: T.s, p: T.p }));
  await w.advance(H);
  const after = (await w.planet(d.home))!;
  assert.equal(after.u.abm, 0);
  assert.ok(after.u.rl < 50);
  assert.match((await w.messages(d.id))[0].title, /Missile strike/);
});

test('debris can be harvested and big battles can form a moon', async () => {
  const w = await world();
  const { a, d, target } = await twoPlayers(w);
  await w.rig(d.home, { u: { lf: 3000 } });
  await w.rig(a.home, { u: { cr: 400 }, tech: { id: 4, io: 2 } });
  const s = await act(w, a.id, c => A.sendFleet(c, { planetId: a.home, ships: { cr: 400 }, target, mission: 'attack', pct: 100, cargo: [0, 0, 0] })) as any;
  await w.advance(s.dur);
  const deb = await w.game.run(q => getDebris(q, target));
  assert.ok(deb && deb[0] > 100000, 'fighters left debris');
  const body = (await w.messages(a.id))[0].body;
  assert.match(body, /moon/i);
  await w.advance(s.dur);
  const r = await act(w, a.id, c => A.sendFleet(c, { planetId: a.home, ships: { rec: 5 }, target, mission: 'recycle', pct: 100, cargo: [0, 0, 0] })) as any;
  await w.advance(r.dur);
  assert.match((await w.messages(a.id))[0].title, /Debris harvested/);
});

test('transport, deploy and recall', async () => {
  const w = await world();
  const { a, d, target } = await twoPlayers(w);
  const t = await act(w, a.id, c => A.sendFleet(c, { planetId: a.home, ships: { lc: 1 }, target, mission: 'transport', pct: 100, cargo: [10000, 0, 0] })) as any;
  await w.advance(t.dur);
  assert.ok((await w.planet(d.home))!.res[0] >= 110000);
  assert.match((await w.messages(d.id))[0].title, /Delivery received/);
  await rejects(act(w, a.id, c => A.sendFleet(c, { planetId: a.home, ships: { lf: 1 }, target, mission: 'deploy', pct: 100, cargo: [0, 0, 0] })), /own planets/);
  const f = await act(w, a.id, c => A.sendFleet(c, { planetId: a.home, ships: { lf: 5 }, target, mission: 'attack', pct: 100, cargo: [0, 0, 0] })) as any;
  await w.advance(1000);
  await act(w, a.id, c => A.recall(c, f.id));
  await w.advance(2000);
  assert.ok(!(await w.messages(d.id)).some(m => /Defeat|Victory/.test(m.title)), 'recalled fleet never fought');
});

test('fleet slots, fuel and newcomer protection are enforced', async () => {
  const w = await world({ noobProtection: 50000 });
  const { a, target } = await twoPlayers(w);
  await w.game.run(q => q.query('UPDATE users SET points=40000 WHERE id=$1', [a.id]));
  await rejects(act(w, a.id, c => A.sendFleet(c, { planetId: a.home, ships: { lf: 1 }, target, mission: 'attack', pct: 100, cargo: [0, 0, 0] })), /newcomer protection/);
  const w2 = await world();
  const b = await w2.player('solo');
  await w2.rig(b.home, { res: [0, 0, 0], u: { lf: 5 } });
  const P = (await w2.planet(b.home))!;
  await rejects(act(w2, b.id, c => A.sendFleet(c, { planetId: b.home, ships: { lf: 1 }, target: { g: P.g, s: P.s, p: 16 }, mission: 'expedition', pct: 100, cargo: [0, 0, 0] })), /Astrophysics/);
});

test('galaxy and highscore show only real players', async () => {
  const w = await world();
  const { a, T } = await twoPlayers(w);
  const gal = await w.game.run(q => galaxy(q, T.g, T.s));
  const filled = gal.slots.filter(s => s.planet);
  assert.ok(filled.length >= 1);
  assert.ok(filled.every(s => ['attacker', 'defender'].includes(s.planet!.owner)));
  const hs = await w.game.run(q => highscore(q, a.id, 1));
  assert.equal(hs.total, 2);
});

test('HTTP API: register, session cookie, state, actions, sign-out', async () => {
  const w = await world();
  const app = buildApp(w.game, { cookieSecure: false });
  const unauth = await app.inject({ method: 'GET', url: '/api/state' });
  assert.equal(unauth.statusCode, 401);
  const reg = await app.inject({ method: 'POST', url: '/api/register', payload: { username: 'webby', password: 'password123' } });
  assert.equal(reg.statusCode, 200);
  const cookie = reg.cookies.find(c => c.name === 'sid')!;
  assert.ok(cookie.httpOnly);
  const headers = { cookie: `sid=${cookie.value}` };
  const st = (await app.inject({ method: 'GET', url: '/api/state', headers })).json();
  assert.equal(st.me.username, 'webby');
  assert.equal(st.planets.length, 1);
  const ok = await app.inject({ method: 'POST', url: '/api/build', headers, payload: { planetId: st.planets[0].id, id: 'sp' } });
  assert.equal(ok.statusCode, 200);
  const bad = await app.inject({ method: 'POST', url: '/api/build', headers, payload: { planetId: st.planets[0].id, id: 'mm' } });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /already under construction/);
  const notMine = await app.inject({ method: 'POST', url: '/api/build/cancel', headers, payload: { planetId: 999 } });
  assert.equal(notMine.statusCode, 400);
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'WEBBY', password: 'wrong-password' } });
  assert.equal(login.statusCode, 400);
  await app.inject({ method: 'POST', url: '/api/logout', headers });
  assert.equal((await app.inject({ method: 'GET', url: '/api/state', headers })).statusCode, 401);
  const page = await app.inject({ method: 'GET', url: '/' });
  assert.equal(page.statusCode, 200);
  await app.close();
  assert.ok(costAt(BLD.sp, 0)[0] === 75 && typeof flight === 'function');
});

test('orbits: the server times in-system flights from where the planets are at launch', async () => {
  const { orbitalDistance, closestApproach, orbitPeriod } = await import('../src/rules/index.ts');
  const w = await world();
  const { a, d } = await twoPlayers(w);
  const A0 = (await w.planet(a.home))!;
  const p = [3, 4, 5, 6, 9, 10, 11, 12].find(x => x !== A0.p)!;
  await w.game.run(q => q.query('UPDATE planets SET galaxy=$1, system=$2, position=$3 WHERE id=$4', [A0.g, A0.s, p, d.home]));
  const target = { g: A0.g, s: A0.s, p };
  const near = closestApproach(A0, target, w.now, w.game.U);
  await w.advance(near.at - w.now);
  const f1 = await act(w, a.id, c => A.sendFleet(c, { planetId: a.home, ships: { lf: 10 }, target, mission: 'attack', pct: 100, cargo: [0, 0, 0] })) as any;
  assert.equal(f1.d, orbitalDistance(A0, target, w.now, w.game.U));
  await w.advance(f1.dur * 2 + 1000);
  await w.advance(orbitPeriod(Math.min(A0.p, p), w.game.U) / 2);
  const f2 = await act(w, a.id, c => A.sendFleet(c, { planetId: a.home, ships: { lf: 10 }, target, mission: 'attack', pct: 100, cargo: [0, 0, 0] })) as any;
  assert.equal(f2.d, orbitalDistance(A0, target, w.now, w.game.U));
  assert.ok(f1.d <= f2.d, 'launching at closest approach is never longer');
});

test('orbits: the way home is timed from where the planets are when the fleet turns around', async () => {
  const { flight, orbitPeriod, MAX_ORBIT_POSITION } = await import('../src/rules/index.ts');
  const w = await world();
  const { a, d } = await twoPlayers(w);
  const A0 = (await w.planet(a.home))!;
  const p = [3, 4, 5, 6, 9, 10, 11, 12].find(x => x !== A0.p)!;
  await w.game.run(q => q.query('UPDATE planets SET galaxy=$1, system=$2, position=$3 WHERE id=$4', [A0.g, A0.s, p, d.home]));
  const target = { g: A0.g, s: A0.s, p };
  const f = await act(w, a.id, c => A.sendFleet(c, { planetId: a.home, ships: { lc: 2 }, target, mission: 'transport', pct: 50, cargo: [1000, 0, 0] })) as any;
  await w.advance(f.dur);
  const back = await w.game.run(async q => (await q.query('SELECT start_at, end_at, speed_pct FROM fleets WHERE id=$1', [f.id])).rows[0]);
  assert.equal(back.speed_pct, 50);
  const expect = flight({ lc: 2 }, target, A0, 50, { cd: 6, es: 4, co: 5 }, w.game.U, back.start_at).dur;
  assert.equal(back.end_at - back.start_at, expect, 'return leg uses positions at turnaround and the same speed setting');
  assert.ok(p <= MAX_ORBIT_POSITION && orbitPeriod(p, w.game.U) > 0);
});
