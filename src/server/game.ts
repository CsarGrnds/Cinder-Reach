// The world clock: every write goes through Game.run, which serialises writes with an advisory lock and
// first processes every scheduled event that is due, in time order.
import type { Db, Sql } from './db.js';
import {
  UN, BLD, TECH, battle, settle, plunder, moonChance, moonDiameter, missileStrike, expedition, espionageDepth, counterEspionage,
  revealFleet, revealDefence, revealBuildings, revealResearch, rollColony, unitList, resText, coordText, fmt, cargoCapacity,
  unitValue, sum3, flight, MAX_ORBIT_POSITION, maxPlanets, positionNeeds, POS_BONUS_METAL, POS_BONUS_CRYSTAL, H, lv, type Universe, type Levels, type Rng, type Res,
} from '../rules/index.js';
import {
  getUser, saveUser, addPoints, getPlanet, planetAt, savePlanet, insertPlanet, syncPlanet, getFleet, saveFleet, deleteFleet,
  schedule, addDebris, getDebris, setDebris, msg, userPlanets, type Planet, type Fleet, type User,
} from './repo.js';

const LOCK = 7_331_001;
export const EXPEDITION_HOLD = H;

export class Game {
  constructor(public db: Db, public U: Universe, public now: () => number = Date.now, public rng: Rng = Math.random) {}

  /** Run a write transaction at the current time, after catching the world up. */
  async run<T>(fn: (q: Sql, t: number) => Promise<T>): Promise<T> {
    return this.db.tx(async q => {
      await q.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
      const t = this.now();
      await this.processDue(q, t);
      return fn(q, t);
    });
  }

  /** Background tick: process due events if there are any. */
  async tick() {
    const r = (await this.db.query<{ due_at: number }>('SELECT due_at FROM events ORDER BY due_at LIMIT 1')).rows[0];
    if (r && r.due_at <= this.now()) await this.run(async () => {});
  }

  async processDue(q: Sql, now: number) {
    for (let i = 0; i < 100000; i++) {
      const e = (await q.query('SELECT * FROM events WHERE due_at <= $1 ORDER BY due_at, id LIMIT 1', [now])).rows[0];
      if (!e) return;
      await q.query('DELETE FROM events WHERE id=$1', [e.id]);
      const t = e.due_at as number;
      if (e.kind === 'build') await this.onBuild(q, e.ref_id, t);
      else if (e.kind === 'yard') await this.onYard(q, e.ref_id, t, now);
      else if (e.kind === 'research') await this.onResearch(q, e.ref_id, t);
      else if (e.kind === 'fleet') await this.onFleet(q, e.ref_id, t);
    }
  }

  /** Load a planet with its owner and bring its resources up to t. */
  async planetAt(q: Sql, id: number, t: number) {
    const P = await getPlanet(q, id);
    if (!P) return null;
    const u = (await getUser(q, P.userId))!;
    syncPlanet(P, u.tech, this.U, t);
    return { P, u };
  }

  /* ---------- scheduled completions ---------- */
  private async onBuild(q: Sql, planetId: number, t: number) {
    const x = await this.planetAt(q, planetId, t);
    if (!x || !x.P.bq) return;
    x.P.b[x.P.bq.id] = lv(x.P.b, x.P.bq.id) + 1;
    x.P.bq = null;
    await savePlanet(q, x.P);
  }

  private async onYard(q: Sql, planetId: number, t: number, now: number) {
    const x = await this.planetAt(q, planetId, t);
    if (!x) return;
    const P = x.P;
    // Complete every unit due before the next other event (or now), so batches don't need one event per unit.
    const next = (await q.query('SELECT due_at FROM events ORDER BY due_at LIMIT 1')).rows[0];
    const horizon = Math.min(now, next ? next.due_at : Infinity);
    while (P.yq.length && P.yEnd <= Math.max(t, horizon)) {
      const y = P.yq[0];
      const k = Math.min(y.n, Math.max(1, Math.floor((Math.max(t, horizon) - P.yEnd) / y.each) + 1));
      P.u[y.id] = lv(P.u, y.id) + k;
      y.n -= k;
      P.yEnd += (k - 1) * y.each;
      if (y.n <= 0) P.yq.shift();
      if (P.yq.length) P.yEnd += P.yq[0].each; else break;
    }
    await savePlanet(q, P);
    if (P.yq.length) await schedule(q, 'yard', P.id, P.yEnd);
  }

  private async onResearch(q: Sql, userId: number, t: number) {
    const u = await getUser(q, userId);
    if (!u || !u.research) return;
    // Production depends on research (plasma, energy): settle every planet at the old levels first.
    for (const P of await userPlanets(q, userId)) { syncPlanet(P, u.tech, this.U, t); await savePlanet(q, P); }
    const id = u.research.id;
    u.tech[id] = lv(u.tech, id) + 1;
    u.research = null;
    await saveUser(q, u);
    await msg(q, u.id, t, 'sys', 'Research complete', [`${TECH[id].n} reached level ${u.tech[id]}.`]);
  }

  /* ---------- fleets ---------- */
  private async onFleet(q: Sql, fleetId: number, t: number) {
    const f = await getFleet(q, fleetId);
    if (!f) return;
    if (f.phase === 'out') await this.arrive(q, f, t);
    else if (f.phase === 'hold') await this.explore(q, f, t);
    else await this.land(q, f, t);
  }

  async turnHome(q: Sql, f: Fleet, t: number) {
    if (Object.values(f.ships).every(n => !n)) return deleteFleet(q, f.id);
    // Inside one system the way home is timed from where both planets are now, not where they were at launch.
    const o = f.origin, d = f.target;
    if (o.g === d.g && o.s === d.s && o.p !== d.p && o.p <= MAX_ORBIT_POSITION && d.p <= MAX_ORBIT_POSITION) {
      const owner = await getUser(q, f.userId);
      f.dur = flight(f.ships, d, o, f.pct, owner?.tech ?? {}, this.U, t).dur;
    }
    f.phase = 'back'; f.start = t; f.end = t + f.dur;
    await saveFleet(q, f);
    await schedule(q, 'fleet', f.id, f.end);
  }

  private async land(q: Sql, f: Fleet, t: number) {
    let P = f.srcPlanetId ? await getPlanet(q, f.srcPlanetId) : null;
    if (!P || P.userId !== f.userId) P = (await userPlanets(q, f.userId))[0] ?? null;
    if (!P) return deleteFleet(q, f.id);
    const u = (await getUser(q, f.userId))!;
    syncPlanet(P, u.tech, this.U, t);
    for (const k in f.ships) if (f.ships[k] > 0) P.u[k] = lv(P.u, k) + f.ships[k];
    f.cargo.forEach((x, i) => (P!.res[i] += x));
    await savePlanet(q, P);
    await deleteFleet(q, f.id);
    if (sum3(f.cargo) > 0) await msg(q, f.userId, t, 'sys', 'Fleet returned', [`${unitList(f.ships)} landed at ${P.name} ${coordText(P)} with ${resText(f.cargo)}.`]);
  }

  private async arrive(q: Sql, f: Fleet, t: number) {
    const m = f.mission;
    if (m === 'expedition') {
      f.phase = 'hold'; f.start = t; f.end = t + EXPEDITION_HOLD;
      await saveFleet(q, f);
      return schedule(q, 'fleet', f.id, f.end);
    }
    const T = m === 'colonise' || m === 'recycle' ? null : await planetAt(q, f.target);
    const me = (await getUser(q, f.userId))!;
    if (m === 'colonise') return this.colonise(q, f, me, t);
    if (m === 'recycle') return this.recycle(q, f, t);
    if (!T) {
      await msg(q, f.userId, t, 'sys', 'Target not found', [`Nothing is left at ${coordText(f.target)}. The fleet is returning.`]);
      if (m === 'missile') return deleteFleet(q, f.id);
      return this.turnHome(q, f, t);
    }
    const owner = (await getUser(q, T.userId))!;
    syncPlanet(T, owner.tech, this.U, t);
    if (m === 'attack' && T.userId !== f.userId) return this.attack(q, f, me, T, owner, t);
    if (m === 'spy' && T.userId !== f.userId) return this.spy(q, f, me, T, owner, t);
    if (m === 'missile' && T.userId !== f.userId) return this.missile(q, f, me, T, owner, t);
    if (m === 'transport') {
      f.cargo.forEach((x, i) => (T.res[i] += x));
      await savePlanet(q, T);
      await msg(q, f.userId, t, 'sys', 'Transport delivered', [`Unloaded ${resText(f.cargo)} at ${T.name} ${coordText(T)}.`]);
      if (T.userId !== f.userId) await msg(q, T.userId, t, 'sys', 'Delivery received', [`${me.username} delivered ${resText(f.cargo)} to ${T.name} ${coordText(T)}.`]);
      f.cargo = [0, 0, 0];
      return this.turnHome(q, f, t);
    }
    if (m === 'deploy' && T.userId === f.userId) {
      for (const k in f.ships) if (f.ships[k] > 0) T.u[k] = lv(T.u, k) + f.ships[k];
      f.cargo.forEach((x, i) => (T.res[i] += x));
      await savePlanet(q, T);
      await deleteFleet(q, f.id);
      return msg(q, f.userId, t, 'sys', 'Fleet deployed', [`${unitList(f.ships)} stationed at ${T.name} ${coordText(T)}.`]);
    }
    return this.turnHome(q, f, t);
  }

  private async attack(q: Sql, f: Fleet, me: User, T: Planet, owner: User, t: number) {
    const defBefore: Levels = {};
    for (const k in T.u) if (T.u[k] > 0 && !UN[k].miss) defBefore[k] = T.u[k];
    const attBefore = { ...f.ships };
    const r = battle(attBefore, me.tech, defBefore, owner.tech, this.rng);
    const sa = settle(attBefore, r.A, this.U.debrisFactor, this.U.defenceRebuild, this.rng);
    const sd = settle(defBefore, r.D, this.U.debrisFactor, this.U.defenceRebuild, this.rng);
    f.ships = sa.out;
    for (const k in defBefore) T.u[k] = sd.out[k] ?? 0;
    const debris: [number, number] = [sa.debris[0] + sd.debris[0], sa.debris[1] + sd.debris[1]];
    const at = { g: T.g, s: T.s, p: T.p };
    await addDebris(q, at, debris);
    await addPoints(q, me.id, -unitValue(sa.lost));
    await addPoints(q, owner.id, -unitValue(sd.lost));
    const lines = [
      `Attacker ${me.username} from ${coordText(f.origin)}: ${unitList(attBefore)}.`, `Attacker lost: ${unitList(sa.lost)}.`,
      `Defender ${owner.username} at ${T.name} ${coordText(T)}: ${unitList(defBefore)}.`, `Defender lost: ${unitList(sd.lost)}.`,
      `${r.res === 'att' ? 'The attacker won' : r.res === 'def' ? 'The defender won' : 'The battle ended in a draw'} after ${r.rounds} round${r.rounds === 1 ? '' : 's'}.`,
    ];
    if (r.res === 'att') {
      const loot = plunder(T.res, cargoCapacity(f.ships) - sum3(f.cargo));
      loot.forEach((x, i) => { T.res[i] -= x; f.cargo[i] += x; });
      lines.push(`Captured ${resText(loot)}.`);
    }
    if (debris[0] + debris[1] > 0) lines.push(`A debris field of ${fmt(debris[0])} metal and ${fmt(debris[1])} crystal formed at ${coordText(at)}.`);
    lines.push(...(await this.moonRoll(q, T, debris[0] + debris[1], t)));
    T.raid = { at: t, kind: 'attack', by: me.username, won: r.res === 'att', lost: Object.values(sd.lost).reduce((x, y) => x + y, 0) };
    await savePlanet(q, T);
    const title = (w: boolean) => `${w ? 'Victory' : r.res === 'draw' ? 'Draw' : 'Defeat'} at ${coordText(T)}`;
    await msg(q, me.id, t, 'combat', title(r.res === 'att'), lines);
    await msg(q, owner.id, t, 'combat', title(r.res === 'def'), lines);
    return this.turnHome(q, f, t);
  }

  private async moonRoll(q: Sql, T: Planet, debrisTotal: number, t: number): Promise<string[]> {
    const ch = moonChance(debrisTotal);
    if (ch < 1) return [];
    const host = T.moon ? null : T;
    if (!host || (await planetAt(q, { g: T.g, s: T.s, p: T.p, moon: true }))) return [];
    if (this.rng() * 100 >= ch) return [`The moon chance was ${ch}%; no moon formed.`];
    const dia = moonDiameter(ch, this.rng);
    await insertPlanet(q, {
      userId: host.userId, g: host.g, s: host.s, p: host.p, moon: true, home: false, name: 'Moon', fields: 1, temp: host.temp - 30, dia,
      res: [0, 0, 0], resAt: t, b: {}, u: {}, pc: {}, bq: null, yq: [], yEnd: 0, jgReady: 0,
    }, t);
    return [`The debris clumped together into a moon of ${fmt(dia)} km (${ch}% chance).`];
  }

  private async spy(q: Sql, f: Fleet, me: User, T: Planet, owner: User, t: number) {
    const probes = lv(f.ships, 'pr');
    const depth = espionageDepth(probes, lv(me.tech, 'es'), lv(owner.tech, 'es'));
    const ships: Levels = {}, def: Levels = {};
    for (const k in T.u) if (T.u[k] > 0) (UN[k].def ? def : ships)[k] = T.u[k];
    const shipCount = Object.values(ships).reduce((a, b) => a + b, 0);
    const cc = counterEspionage(shipCount, probes, lv(me.tech, 'es'), lv(owner.tech, 'es'));
    const caught = this.rng() < cc;
    const lines = [`Owner: ${owner.username}.`, `Resources: ${resText(T.res)}.`];
    if (revealFleet(depth)) lines.push(`Fleet: ${unitList(ships)}.`);
    if (revealDefence(depth)) lines.push(`Defence: ${unitList(def)}.`);
    if (revealBuildings(depth)) lines.push(`Buildings: ${Object.keys(T.b).filter(k => T.b[k] > 0).map(k => `${BLD[k].n} ${T.b[k]}`).join(', ') || 'none'}.`);
    if (revealResearch(depth)) lines.push(`Research: ${Object.keys(owner.tech).filter(k => owner.tech[k] > 0).map(k => `${TECH[k].n} ${owner.tech[k]}`).join(', ') || 'none'}.`);
    else lines.push('More probes or a higher Espionage Technology reveal more.');
    lines.push(`Chance of counter-espionage: ${Math.round(cc * 100)}%.${caught ? ' Your probes were detected and destroyed.' : ''}`);
    await msg(q, me.id, t, 'spy', `Espionage report: ${T.name} ${coordText(T)}`, lines);
    await msg(q, owner.id, t, 'spy', 'Espionage detected', [
      `${probes} probe${probes === 1 ? '' : 's'} from ${me.username} at ${coordText(f.origin)} scanned ${T.name} ${coordText(T)}.`,
      caught ? 'Your fleet shot them down.' : `Chance of counter-espionage was ${Math.round(cc * 100)}%.`,
    ]);
    if (caught) {
      await addDebris(q, { g: T.g, s: T.s, p: T.p }, [0, Math.floor(UN.pr.c[1] * probes * this.U.debrisFactor)]);
      await addPoints(q, me.id, -unitValue(f.ships));
      return deleteFleet(q, f.id);
    }
    return this.turnHome(q, f, t);
  }

  private async missile(q: Sql, f: Fleet, me: User, T: Planet, owner: User, t: number) {
    const n = lv(f.ships, 'ipm');
    const s = missileStrike(n, lv(me.tech, 'we'), T.u, lv(owner.tech, 'ar'), lv(T.u, 'abm'));
    T.u.abm = lv(T.u, 'abm') - s.intercepted;
    for (const k in s.lost) T.u[k] -= s.lost[k];
    T.raid = { at: t, kind: 'missile', by: me.username, won: Object.keys(s.lost).length > 0, lost: Object.values(s.lost).reduce((x, y) => x + y, 0) };
    await savePlanet(q, T);
    await addPoints(q, owner.id, -unitValue(s.lost) - s.intercepted * sum3(UN.abm.c));
    const lines = [`${n} missiles from ${me.username} at ${coordText(f.origin)} struck ${T.name} ${coordText(T)}.`, `Intercepted: ${s.intercepted}.`, `Destroyed: ${unitList(s.lost)}.`];
    await msg(q, me.id, t, 'combat', `Missile strike on ${coordText(T)}`, lines);
    await msg(q, owner.id, t, 'combat', `Missile strike on ${T.name}`, lines);
    return deleteFleet(q, f.id);
  }

  private async colonise(q: Sql, f: Fleet, me: User, t: number) {
    const c = f.target, p = c.p;
    const mine = await userPlanets(q, me.id);
    const why = (await planetAt(q, { ...c, moon: false })) ? 'the position is already occupied'
      : mine.filter(x => !x.moon).length >= maxPlanets(me.tech) ? `your Astrophysics level allows only ${maxPlanets(me.tech)} planets`
      : lv(me.tech, 'as') < positionNeeds(p) ? `position ${p} needs Astrophysics ${positionNeeds(p)}`
      : !lv(f.ships, 'col') ? 'no Colony Ship arrived' : '';
    if (why) {
      await msg(q, me.id, t, 'sys', 'Colonisation failed', [`The fleet reached ${coordText(c)} but could not settle: ${why}. It is returning.`]);
      return this.turnHome(q, f, t);
    }
    const { fields, temp } = rollColony(p, this.rng);
    await insertPlanet(q, {
      userId: me.id, g: c.g, s: c.s, p, moon: false, home: false, name: 'Colony', fields, temp, dia: fields * 80,
      res: [500 + f.cargo[0], 500 + f.cargo[1], f.cargo[2]], resAt: t, b: {}, u: {}, pc: {}, bq: null, yq: [], yEnd: 0, jgReady: 0,
    }, t);
    f.cargo = [0, 0, 0];
    f.ships.col -= 1;
    await addPoints(q, me.id, -sum3(UN.col.c));
    const bonus = POS_BONUS_METAL[p] ? ` Position bonus: +${Math.round(POS_BONUS_METAL[p] * 100)}% metal.` : POS_BONUS_CRYSTAL[p] ? ` Position bonus: +${Math.round(POS_BONUS_CRYSTAL[p] * 100)}% crystal.` : '';
    await msg(q, me.id, t, 'sys', 'Colony founded', [`Settlers landed at ${coordText(c)}: ${fields} fields, ${temp - 40}°C to ${temp}°C.${bonus}`, 'The Colony Ship was dismantled for the first structures.']);
    return this.turnHome(q, f, t);
  }

  private async recycle(q: Sql, f: Fleet, t: number) {
    const at = { g: f.target.g, s: f.target.s, p: f.target.p };
    const d = await getDebris(q, at);
    if (d) {
      let c = lv(f.ships, 'rec') * (UN.rec.cap ?? 0) - sum3(f.cargo);
      const take = [Math.min(d[0], c / 2), 0];
      c -= take[0]; take[1] = Math.min(d[1], c); c -= take[1];
      const more = Math.min(d[0] - take[0], c); take[0] += more;
      const got = take.map(Math.floor);
      f.cargo[0] += got[0]; f.cargo[1] += got[1];
      await setDebris(q, at, [d[0] - got[0], d[1] - got[1]]);
      await msg(q, f.userId, t, 'sys', 'Debris harvested', [`Recyclers collected ${fmt(got[0])} metal and ${fmt(got[1])} crystal at ${coordText(at)}.`]);
    } else await msg(q, f.userId, t, 'sys', 'No debris', [`There was no debris left at ${coordText(at)}.`]);
    return this.turnHome(q, f, t);
  }

  private async explore(q: Sql, f: Fleet, t: number) {
    const me = (await getUser(q, f.userId))!;
    const top = (await q.query('SELECT COALESCE(MAX(points),0) AS m FROM users')).rows[0].m as number;
    const o = expedition(f.ships, sum3(f.cargo), top, me.tech, this.rng);
    let title = 'Expedition: nothing found', line = 'The fleet charted empty space and is returning.';
    if (o.kind === 'resources') {
      o.res.forEach((x, i) => (f.cargo[i] += x));
      title = 'Expedition: resources found'; line = `The fleet recovered ${resText(o.res)}.`;
    } else if (o.kind === 'ships') {
      for (const k in o.ships) f.ships[k] = lv(f.ships, k) + o.ships[k];
      await addPoints(q, me.id, unitValue(o.ships));
      title = 'Expedition: abandoned ships'; line = `Derelict ships joined your fleet: ${unitList(o.ships)}.`;
    } else if (o.kind === 'darkMatter') {
      me.dm += o.amount; await saveUser(q, me);
      title = 'Expedition: dark matter'; line = `The fleet collected ${o.amount} dark matter.`;
    } else if (o.kind === 'pirates' || o.kind === 'aliens') {
      const before = { ...f.ships };
      const r = battle(o.enemy, o.enemyTech, before, me.tech, this.rng);
      const s = settle(before, r.D, 0, 0, this.rng);
      f.ships = s.out;
      await addPoints(q, me.id, -unitValue(s.lost));
      title = `Expedition: ${o.kind === 'aliens' ? 'alien' : 'pirate'} attack`;
      line = `${o.kind === 'aliens' ? 'Aliens' : 'Pirates'} ambushed the fleet with ${unitList(o.enemy)}. ${r.res === 'att' ? 'Your fleet was wiped out.' : `Your fleet survived and lost ${unitList(s.lost)}.`}`;
    } else if (o.kind === 'delay') {
      f.dur *= o.factor; title = 'Expedition: delayed'; line = `A navigation error makes the return flight take ${o.factor} times as long.`;
    } else if (o.kind === 'early') {
      f.dur /= 2; title = 'Expedition: early return'; line = 'A slipstream halves the return flight.';
    } else if (o.kind === 'blackHole') {
      await addPoints(q, me.id, -unitValue(f.ships));
      await msg(q, me.id, t, 'sys', 'Expedition lost', ['The fleet vanished into a black hole. Nothing returned.']);
      return deleteFleet(q, f.id);
    }
    await msg(q, me.id, t, 'sys', title, [line]);
    return this.turnHome(q, f, t);
  }
}

export type { Res };
