// Player actions. Each runs inside Game.run, so the world is current at time t and writes are serialised.
import type { Sql } from './db.js';
import type { Game } from './game.js';
import {
  BLD, TECH, UN, SHIP_IDS, MISSIONS, EXPEDITION_POSITION, costAt, energyAt, buildTime, researchTime, unitTime, production, missing,
  fieldsOf, fieldsUsed, labNetwork, fleetSlots, maxExpeditions, maxPlanets, positionNeeds, missileRange, phalanxRange, siloSlots, siloUsed,
  flight, missileFlightTime, cargoCapacity, noobProtected, unitList, coordText, sum3, lv, unitValue, MISSIONS as M, type Coords, type Levels, type Res,
} from '../rules/index.js';
import {
  fail, getUser, saveUser, addPoints, getPlanet, planetAt, savePlanet, userPlanets, syncPlanet, insertFleet, getFleet, saveFleet,
  schedule, unschedule, getDebris, msg, fleetsAt, type Planet, type User,
} from './repo.js';

type Ctx = { game: Game; q: Sql; t: number; user: User };

async function ownPlanet(c: Ctx, planetId: number) {
  const P = await getPlanet(c.q, planetId);
  if (!P || P.userId !== c.user.id) fail('That planet is not yours.');
  syncPlanet(P!, c.user.tech, c.game.U, c.t);
  return P!;
}
const canPay = (P: Planet, c: Res) => c.every((x, i) => P.res[i] >= x);
async function spend(c: Ctx, P: Planet, cost: Res) {
  if (!canPay(P, cost)) fail('Not enough resources.');
  cost.forEach((x, i) => (P.res[i] -= x));
  await addPoints(c.q, c.user.id, sum3(cost));
}
async function refund(c: Ctx, P: Planet, cost: Res) {
  cost.forEach((x, i) => (P.res[i] += x));
  await addPoints(c.q, c.user.id, -sum3(cost));
}

/* ---------- buildings ---------- */
export async function build(c: Ctx, planetId: number, id: string) {
  const d = BLD[id] ?? fail('Unknown building.');
  const P = await ownPlanet(c, planetId);
  if (P.moon ? !d.m : d.mo) fail(`${d.n} cannot be built ${P.moon ? 'on a moon' : 'on a planet'}.`);
  if (P.bq) fail('A building is already under construction here.');
  if (fieldsUsed(P) >= fieldsOf(P)) fail('No free fields left.');
  const need = missing(d.req, P.b, c.user.tech);
  if (need.length) fail(`Requires ${need.join(', ')}.`);
  if (id === 'lab' && c.user.research?.planetId === P.id) fail('The lab cannot be upgraded while it is researching.');
  if ((id === 'sy' || id === 'na') && P.yq.length) fail('The shipyard must be idle to upgrade it.');
  const l = lv(P.b, id), e = energyAt(d, l);
  if (e && production(P, c.user.tech, c.game.U).out < e) fail(`Needs ${e.toLocaleString('en-US')} energy output.`);
  const cost = costAt(d, l);
  await spend(c, P, cost);
  const end = c.t + buildTime(P.b, cost, c.game.U);
  P.bq = { id, start: c.t, end, cost };
  await savePlanet(c.q, P);
  await schedule(c.q, 'build', P.id, end);
}
export async function cancelBuild(c: Ctx, planetId: number) {
  const P = await ownPlanet(c, planetId);
  if (!P.bq) fail('Nothing is under construction.');
  await refund(c, P, P.bq!.cost);
  P.bq = null;
  await savePlanet(c.q, P);
  await unschedule(c.q, 'build', P.id);
}

/* ---------- research ---------- */
export async function research(c: Ctx, planetId: number, id: string) {
  const d = TECH[id] ?? fail('Unknown research.');
  const P = await ownPlanet(c, planetId);
  if (P.moon) fail('Research needs a planet with a lab.');
  const need = missing(d.req, P.b, c.user.tech);
  if (need.length) fail(`Requires ${need.join(', ')}.`);
  const l = lv(c.user.tech, id);
  if (d.e) {
    const e = energyAt(d, l);
    if (production(P, c.user.tech, c.game.U).out < e) fail(`Needs ${e.toLocaleString('en-US')} energy output on this planet.`);
    if (c.user.research) fail('Finish the running research first.');
    c.user.tech[id] = l + 1;
    await saveUser(c.q, c.user);
    return msg(c.q, c.user.id, c.t, 'sys', 'Research complete', [`${d.n} reached level ${l + 1}.`]);
  }
  if (c.user.research) fail('A research project is already running.');
  if (P.bq?.id === 'lab') fail('The lab here is being upgraded.');
  const others = (await userPlanets(c.q, c.user.id)).filter(x => x.id !== P.id && !x.moon && x.bq?.id !== 'lab').map(x => lv(x.b, 'lab'));
  const cost = costAt(d, l);
  await spend(c, P, cost);
  const end = c.t + researchTime(labNetwork(lv(P.b, 'lab'), others, lv(c.user.tech, 'irn')), cost, c.game.U);
  c.user.research = { id, planetId: P.id, start: c.t, end, cost };
  await savePlanet(c.q, P);
  await saveUser(c.q, c.user);
  await schedule(c.q, 'research', c.user.id, end);
}
export async function cancelResearch(c: Ctx) {
  const r = c.user.research ?? fail('No research is running.');
  const P = await getPlanet(c.q, r.planetId);
  if (P) { syncPlanet(P, c.user.tech, c.game.U, c.t); await refund(c, P, r.cost); await savePlanet(c.q, P); }
  c.user.research = null;
  await saveUser(c.q, c.user);
  await unschedule(c.q, 'research', c.user.id);
}

/* ---------- shipyard ---------- */
export async function shipyard(c: Ctx, planetId: number, id: string, n: number) {
  const u = UN[id] ?? fail('Unknown unit.');
  const P = await ownPlanet(c, planetId);
  if (!lv(P.b, 'sy')) fail('There is no shipyard here.');
  if (P.bq?.id === 'sy' || P.bq?.id === 'na') fail('The shipyard is being upgraded.');
  const need = missing(u.req, P.b, c.user.tech);
  if (need.length) fail(`Requires ${need.join(', ')}.`);
  const queued = (k: string) => P.yq.filter(y => y.id === k).reduce((a, y) => a + y.n, 0);
  n = Math.floor(n);
  if (!(n >= 1)) fail('Order at least one.');
  if (u.max) { if (lv(P.u, id) + queued(id) >= 1) fail(`Only one ${u.n} per planet.`); n = 1; }
  if (u.miss) {
    const used = siloUsed(P.u) + queued('abm') * 1 + queued('ipm') * 2;
    const room = Math.floor((siloSlots(P.b) - used) / u.miss);
    if (room < 1) fail('The Missile Silo is full (10 slots per level).');
    n = Math.min(n, room);
  }
  const afford = Math.floor(Math.min(...u.c.map((x, i) => (x ? P.res[i] / x : Infinity))));
  if (afford < 1) fail('Not enough resources.');
  n = Math.min(n, afford);
  await spend(c, P, u.c.map(x => x * n) as Res);
  const each = unitTime(P.b, u.c, c.game.U);
  if (!P.yq.length) { P.yEnd = c.t + each; await schedule(c.q, 'yard', P.id, P.yEnd); }
  P.yq.push({ id, n, each });
  await savePlanet(c.q, P);
  return n;
}

/* ---------- planet management ---------- */
export async function setProduction(c: Ctx, planetId: number, key: string, pct: number) {
  if (!['mm', 'cm', 'ds', 'sp', 'fr', 'sat'].includes(key)) fail('Unknown producer.');
  if (!(pct >= 0 && pct <= 100 && pct % 10 === 0)) fail('Choose 0 to 100 in steps of 10.');
  const P = await ownPlanet(c, planetId);
  P.pc[key] = pct;
  await savePlanet(c.q, P);
}
export async function rename(c: Ctx, planetId: number, name: string) {
  const v = name.trim();
  if (!/^[\p{L}\p{N} _.-]{1,20}$/u.test(v)) fail('Use 1 to 20 letters, numbers, spaces, dots, dashes or underscores.');
  const P = await ownPlanet(c, planetId);
  P.name = v;
  await savePlanet(c.q, P);
}
export async function abandon(c: Ctx, planetId: number) {
  const P = await ownPlanet(c, planetId);
  if (P.home) fail('You cannot abandon your homeworld.');
  const group = P.moon ? [P] : (await userPlanets(c.q, c.user.id)).filter(x => x.g === P.g && x.s === P.s && x.p === P.p);
  const ids = group.map(x => x.id);
  const busy = (await c.q.query(`SELECT 1 FROM fleets WHERE src_planet_id = ANY($1) OR ((target->>'g')::int=$2 AND (target->>'s')::int=$3 AND (target->>'p')::int=$4) LIMIT 1`, [ids, P.g, P.s, P.p])).rows.length;
  if (busy) fail('Fleets are still flying to or from here.');
  if (c.user.research && ids.includes(c.user.research.planetId)) fail('Research is running here.');
  let value = 0;
  for (const x of group) {
    for (const k in x.b) for (let l = 0; l < x.b[k]; l++) value += sum3(costAt(BLD[k], l));
    value += unitValue(x.u);
    await unschedule(c.q, 'build', x.id); await unschedule(c.q, 'yard', x.id);
  }
  await c.q.query('DELETE FROM planets WHERE id = ANY($1)', [ids]);
  await addPoints(c.q, c.user.id, -value);
  await msg(c.q, c.user.id, c.t, 'sys', 'Planet abandoned', [`${P.name} ${coordText(P)} was given up.`]);
}

/* ---------- fleets ---------- */
export interface SendInput { planetId: number; ships: Levels; target: Coords; mission: string; pct: number; cargo: Res }

export async function sendFleet(c: Ctx, inp: SendInput) {
  const P = await ownPlanet(c, inp.planetId);
  const U = c.game.U, tg = { g: inp.target.g, s: inp.target.s, p: inp.target.p, moon: !!inp.target.moon };
  if (!(tg.g >= 1 && tg.g <= U.galaxies && tg.s >= 1 && tg.s <= U.systems && tg.p >= 1 && tg.p <= EXPEDITION_POSITION)) fail('Those coordinates are outside the universe.');
  if (!(inp.pct >= 10 && inp.pct <= 100 && inp.pct % 10 === 0)) fail('Speed must be 10% to 100% in steps of 10.');
  if (!(inp.mission in MISSIONS) || inp.mission === 'missile') fail('Unknown mission.');
  const ships: Levels = {};
  for (const k in inp.ships) {
    const n = Math.floor(inp.ships[k]);
    if (!n) continue;
    if (!SHIP_IDS.includes(k)) fail(`${UN[k]?.n ?? k} cannot fly.`);
    if (!(n > 0) || n > lv(P.u, k)) fail(`Not enough ${UN[k].n} here.`);
    ships[k] = n;
  }
  if (!Object.keys(ships).length) fail('Select at least one ship.');
  const cargo = inp.cargo.map(x => Math.max(0, Math.floor(x))) as Res;
  const m = inp.mission;
  let targetUserId: number | null = null;

  if (m === 'expedition') {
    if (tg.p !== EXPEDITION_POSITION || tg.moon) fail('Expeditions fly to position 16.');
    const running = (await c.q.query(`SELECT count(*)::int AS n FROM fleets WHERE user_id=$1 AND mission='expedition'`, [c.user.id])).rows[0].n;
    if (running >= maxExpeditions(c.user.tech)) fail(maxExpeditions(c.user.tech) ? `Astrophysics ${lv(c.user.tech, 'as')} allows ${maxExpeditions(c.user.tech)} expeditions at a time.` : 'Expeditions need Astrophysics 1.');
  } else {
    if (tg.p > 15) fail('Only expeditions fly to position 16.');
    const T = m === 'recycle' ? null : await planetAt(c.q, tg);
    if (m === 'colonise') {
      if (tg.moon) fail('Moons cannot be colonised.');
      if (!ships.col) fail('Colonisation needs a Colony Ship.');
      if (await planetAt(c.q, tg)) fail('That position is taken.');
      if (lv(c.user.tech, 'as') < positionNeeds(tg.p)) fail(`Position ${tg.p} needs Astrophysics ${positionNeeds(tg.p)}.`);
      const planets = (await userPlanets(c.q, c.user.id)).filter(x => !x.moon).length;
      if (planets >= maxPlanets(c.user.tech)) fail(`Astrophysics ${lv(c.user.tech, 'as')} allows ${maxPlanets(c.user.tech)} planets.`);
    } else if (m === 'recycle') {
      if (!ships.rec) fail('Harvesting needs Recyclers.');
      if (!(await getDebris(c.q, tg))) fail('There is no debris there.');
    } else {
      if (!T) fail('There is nothing at that position.');
      targetUserId = T!.userId;
      const own = T!.userId === c.user.id;
      if (T!.id === P.id) fail('The fleet is already here.');
      if (m === 'deploy' && !own) fail('You can only deploy to your own planets.');
      if ((m === 'attack' || m === 'spy') && own) fail('You cannot attack or spy on yourself.');
      if (m === 'spy' && !ships.pr) fail('Espionage needs at least one Espionage Probe.');
      if (m === 'attack') {
        const other = (await getUser(c.q, T!.userId))!;
        const why = noobProtected(c.user.points, other.points, U);
        if (why) fail(`Attack not allowed: ${why}.`);
      }
    }
  }
  const used = (await c.q.query(`SELECT count(*)::int AS n FROM fleets WHERE user_id=$1 AND mission<>'missile'`, [c.user.id])).rows[0].n;
  if (used >= fleetSlots(c.user.tech)) fail('All fleet slots are in use. Research Computer Technology for more.');
  const fl = flight(ships, P, tg, inp.pct, c.user.tech, U, c.t);
  if (P.res[2] < fl.fuel + cargo[2]) fail(`Not enough deuterium: the flight burns ${fl.fuel.toLocaleString('en-US')}.`);
  if (cargo.some((x, i) => x > P.res[i])) fail('Not enough resources to load.');
  if (sum3(cargo) > Math.max(0, cargoCapacity(ships) - fl.fuel)) fail('Cargo exceeds the hold (fuel takes space too).');
  P.res[2] -= fl.fuel;
  cargo.forEach((x, i) => (P.res[i] -= x));
  for (const k in ships) P.u[k] -= ships[k];
  await savePlanet(c.q, P);
  const id = await insertFleet(c.q, {
    userId: c.user.id, srcPlanetId: P.id, origin: { g: P.g, s: P.s, p: P.p, moon: P.moon }, target: tg, targetUserId,
    mission: m, ships, cargo, phase: 'out', start: c.t, end: c.t + fl.dur, dur: fl.dur, pct: inp.pct,
  });
  await schedule(c.q, 'fleet', id, c.t + fl.dur);
  return { id, ...fl };
}

export async function recall(c: Ctx, fleetId: number) {
  const f = await getFleet(c.q, fleetId);
  if (!f || f.userId !== c.user.id) fail('That fleet is not yours.');
  if (f!.phase === 'back' || f!.mission === 'missile') fail('That fleet cannot be recalled.');
  const out = f!.phase === 'out' ? c.t - f!.start : f!.dur; // a holding expedition flies the full way back
  f!.phase = 'back'; f!.start = c.t; f!.end = c.t + out; f!.dur = out;
  await saveFleet(c.q, f!);
  await schedule(c.q, 'fleet', f!.id, f!.end);
}

export async function launchMissiles(c: Ctx, planetId: number, n: number, target: Coords) {
  const P = await ownPlanet(c, planetId);
  n = Math.floor(n);
  if (!(n >= 1) || n > lv(P.u, 'ipm')) fail('Not enough Interplanetary Missiles here.');
  const T = await planetAt(c.q, { ...target, moon: false });
  if (!T || T.userId === c.user.id) fail('There is no enemy planet at that position.');
  if (T!.g !== P.g || Math.abs(T!.s - P.s) > missileRange(c.user.tech)) fail(`Out of range: Impulse Drive ${lv(c.user.tech, 'id')} reaches ${missileRange(c.user.tech)} systems in your galaxy.`);
  const other = (await getUser(c.q, T!.userId))!;
  const why = noobProtected(c.user.points, other.points, c.game.U);
  if (why) fail(`Strike not allowed: ${why}.`);
  P.u.ipm -= n;
  await savePlanet(c.q, P);
  await addPoints(c.q, c.user.id, -n * sum3(UN.ipm.c));
  const dur = missileFlightTime(P, T!, c.t, c.game.U);
  const id = await insertFleet(c.q, {
    userId: c.user.id, srcPlanetId: P.id, origin: { g: P.g, s: P.s, p: P.p }, target: { g: T!.g, s: T!.s, p: T!.p }, targetUserId: T!.userId,
    mission: 'missile', ships: { ipm: n }, cargo: [0, 0, 0], phase: 'out', start: c.t, end: c.t + dur, dur, pct: 100,
  });
  await schedule(c.q, 'fleet', id, c.t + dur);
}

export async function jump(c: Ctx, planetId: number, targetId: number, shipsIn: Levels) {
  const P = await ownPlanet(c, planetId), T = await ownPlanet(c, targetId);
  if (!P.moon || !T.moon || !lv(P.b, 'jg') || !lv(T.b, 'jg')) fail('Both moons need a Jump Gate.');
  if (P.id === T.id) fail('Pick another moon.');
  if (c.t < P.jgReady || c.t < T.jgReady) fail('The gates are recharging.');
  let any = false;
  for (const k in shipsIn) {
    const n = Math.floor(shipsIn[k]);
    if (!n) continue;
    if (!SHIP_IDS.includes(k) || n < 0 || n > lv(P.u, k)) fail(`Not enough ${UN[k]?.n ?? k} here.`);
    P.u[k] -= n; T.u[k] = lv(T.u, k) + n; any = true;
  }
  if (!any) fail('Select the ships to jump.');
  P.jgReady = T.jgReady = c.t + 3_600_000 / c.game.U.fleetSpeed;
  await savePlanet(c.q, P); await savePlanet(c.q, T);
}

export async function phalanx(c: Ctx, planetId: number, target: Coords) {
  const P = await ownPlanet(c, planetId);
  if (!P.moon || !lv(P.b, 'ph')) fail('Scanning needs a Sensor Phalanx on a moon.');
  if (target.g !== P.g || Math.abs(target.s - P.s) > phalanxRange(lv(P.b, 'ph'))) fail(`Out of phalanx range (${phalanxRange(lv(P.b, 'ph'))} systems).`);
  const T = await planetAt(c.q, { ...target, moon: false });
  if (!T) fail('There is no planet there.');
  if (P.res[2] < 5000) fail('A scan costs 5,000 deuterium.');
  P.res[2] -= 5000;
  await savePlanet(c.q, P);
  const seen = await fleetsAt(c.q, T!);
  const lines = seen.length ? seen.map(f => `${f.owner}: ${M[f.mission as keyof typeof M] ?? f.mission} ${coordText(f.origin)} → ${coordText(f.target)}, ${f.phase === 'back' ? 'returning' : 'outbound'}, ${unitList(f.ships)}, arrives in ${Math.max(0, Math.round((f.end - c.t) / 1000))} s.`) : ['No fleet movements at this planet.'];
  await msg(c.q, c.user.id, c.t, 'spy', `Phalanx scan: ${T!.name} ${coordText(T!)}`, lines);
}

export type { Ctx };
