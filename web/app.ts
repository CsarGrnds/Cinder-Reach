// Browser client. The server decides every outcome; this file only displays state and sends actions.
// Shared rules are imported to show costs, times, requirements and live resource counters.
import {
  BLD, TECH, UN, RF, SHIP_IDS, MISSIONS, POS_BONUS_METAL, POS_BONUS_CRYSTAL, POS_FIELDS_MIN, POS_FIELDS_MAX, RES_NAMES,
  costAt, energyAt, buildTime, researchTime, unitTime, production, accrue, missing, fieldsOf, fieldsUsed, labNetwork,
  storageCap, satEnergy, shipSpeed, flight, cargoCapacity, maxPlanets, maxExpeditions, fleetSlots, positionNeeds,
  missileRange, phalanxRange, siloSlots, siloUsed, lv, sum3, distance, orbitalRange, closestApproach, orbitPeriod, missileFlightTime, MAX_ORBIT_POSITION, type Levels, type Res, type Universe,
} from '../src/rules/index.ts';
import { ART, UNIT_ART, TECH_ART } from './art.ts';
import { treeView, treeUI } from './tree.ts';
import { drawSystem, type Hit } from './orrery.ts';
import { Art, sceneH, slug, type SceneMode } from './scene.ts';

/* ---------- state ---------- */
type Planet = {
  id: number; name: string; g: number; s: number; p: number; moon: boolean; home: boolean; fields: number; temp: number; dia: number;
  res: Res; resAt: number; b: Levels; u: Levels; pc: Levels; bq: any; yq: { id: string; n: number; each: number }[]; yEnd: number; jgReady: number;
};
type Fleet = { id: number; mission: string; phase: string; origin: any; target: any; ships: Levels; cargo: Res; start: number; end: number; dur: number };
type Incoming = { id: number; owner: string; mission: string; origin: any; target: any; start: number; end: number; hostile: boolean; ships: Levels | null; count: number };
type State = {
  now: number; universe: Universe; me: { id: number; username: string; points: number; dm: number };
  tech: Levels; research: any; planets: Planet[]; fleets: Fleet[]; incoming: Incoming[]; unread: number;
};

let S: State | null = null;
let skew = 0;
let curId = 0;
const ui = {
  tab: 'overview', qty: {} as Record<string, number>, gal: { g: 1, s: 1, sel: null as number | null, ahead: 0 }, galData: null as any, hs: null as any, msgs: null as any[] | null,
  fl: { ships: {} as Record<string, number>, g: 1, s: 1, p: 1, moon: 0, mission: '', pct: 100, cargo: [0, 0, 0] as number[] },
  ipm: { n: 1, p: 1 }, abandonArm: 0, authMode: 'login' as 'login' | 'register', busy: false,
};
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const now = () => Date.now() + skew;
const U = () => S!.universe;
const cur = () => S!.planets.find(p => p.id === curId) ?? S!.planets[0];
const T = () => S!.tech;

/* ---------- helpers ---------- */
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');
const dur = (ms: number) => {
  let s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), p = (x: number) => String(x).padStart(2, '0');
  s %= 60;
  return d ? `${d}d ${p(h)}h ${p(m)}m` : h ? `${h}h ${p(m)}m ${p(s)}s` : m ? `${m}m ${p(s)}s` : `${s}s`;
};
const when = (t: number) => new Date(t).toLocaleString();
const co = (o: { g: number; s: number; p: number; moon?: boolean }) => `[${o.g}:${o.s}:${o.p}]${o.moon ? ' moon' : ''}`;
const list = (o: Levels | null) => (o ? Object.keys(o).filter(k => o[k] > 0).map(k => `${fmt(o[k])} ${UN[k].n}`).join(', ') : '') || 'none';
const resT = (r: number[]) => `${fmt(r[0])} metal, ${fmt(r[1])} crystal, ${fmt(r[2])} deuterium`;
const int = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
const resNow = (P: Planet): Res => accrue(P.res, production(P, T(), U()), Math.max(0, now() - P.resAt));
const prod = (P: Planet) => production(P, T(), U());
const can = (P: Planet, c: number[]) => { const r = resNow(P); return c.every((x, i) => r[i] >= x); };
const otherLabs = (P: Planet) => S!.planets.filter(x => x.id !== P.id && !x.moon && x.bq?.id !== 'lab').map(x => lv(x.b, 'lab'));
const labs = (P: Planet) => labNetwork(lv(P.b, 'lab'), otherLabs(P), lv(T(), 'irn'));
const nPlanets = () => S!.planets.filter(p => !p.moon).length;

let toastT = 0;
function toast(m: string) {
  const t = $('#toast'); t.textContent = m; t.hidden = false;
  clearTimeout(toastT); toastT = window.setTimeout(() => (t.hidden = true), 3500);
}

/* ---------- API ---------- */
class Unauthorized extends Error {}
async function api(path: string, body?: unknown) {
  const r = await fetch(path, body === undefined ? { credentials: 'same-origin' } : {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (r.status === 401) throw new Unauthorized();
  const j = await r.json().catch(() => ({ error: 'The server sent an unreadable reply.' }));
  if (!r.ok) throw new Error(j.error || 'Request failed.');
  return j;
}
async function refresh() {
  try {
    const t0 = Date.now();
    const st = await api('/api/state') as State;
    skew = st.now - Math.round((t0 + Date.now()) / 2);
    S = st;
    if (!S.planets.some(p => p.id === curId)) curId = S.planets[0]?.id ?? 0;
    render();
  } catch (e) {
    if (e instanceof Unauthorized) { S = null; renderAuth(); } else toast((e as Error).message);
  }
}
async function act(path: string, body: unknown, ok?: string) {
  if (ui.busy) return;
  ui.busy = true;
  try { const r = await api(path, body); if (ok) toast(ok); await refresh(); return r; }
  catch (e) { if (e instanceof Unauthorized) { S = null; renderAuth(); } else toast((e as Error).message); }
  finally { ui.busy = false; }
}
async function loadTab() {
  try {
    if (ui.tab === 'galaxy') ui.galData = await api(`/api/galaxy?g=${ui.gal.g}&s=${ui.gal.s}`);
    if (ui.tab === 'highscore') ui.hs = await api('/api/highscore?page=1');
    if (ui.tab === 'messages') { ui.msgs = await api('/api/messages'); if (S) S.unread = 0; }
  } catch (e) { if (e instanceof Unauthorized) { S = null; return renderAuth(); } toast((e as Error).message); }
  render();
}

/* ---------- actions ---------- */
const ACT: Record<string, (d: DOMStringMap) => unknown> = {
  tab: d => go(d.id!),
  logout: async () => { await api('/api/logout', {}).catch(() => {}); S = null; renderAuth(); },
  up: d => act('/api/build', { planetId: cur().id, id: d.id }),
  cancelB: () => act('/api/build/cancel', { planetId: cur().id }, 'Construction cancelled and refunded.'),
  tech: d => act('/api/research', { planetId: cur().id, id: d.id }),
  cancelR: () => act('/api/research/cancel', {}, 'Research cancelled and refunded.'),
  make: async d => {
    const r = await act('/api/shipyard', { planetId: cur().id, id: d.id, n: Math.max(1, Math.floor(ui.qty[d.id!] || 1)) });
    if (r) { const n = r.result as number; if (n < (ui.qty[d.id!] || 1)) toast(`Ordered ${n}, the most possible.`); ui.qty[d.id!] = 1; }
  },
  all: d => { ui.fl.ships[d.id!] = lv(cur().u, d.id!); render(); },
  maxc: () => {
    const i = flInfo(), r = resNow(cur()), fu = i.fl ? i.fl.fuel : 0;
    let c = Math.max(0, i.cap - fu);
    ui.fl.cargo = [0, 1, 2].map(k => { const x = Math.floor(Math.min(k === 2 ? Math.max(0, r[2] - fu) : r[k], c)); c -= x; return x; });
    render();
  },
  launch: async () => {
    const i = flInfo();
    if (!i.n) return toast('Select at least one ship.');
    if (!i.mission) return toast('No mission is possible at that target.');
    const r = await act('/api/fleet', { planetId: cur().id, ships: i.ships, target: i.t, mission: i.mission, pct: ui.fl.pct, cargo: i.cargo }, `${MISSIONS[i.mission as keyof typeof MISSIONS]} fleet launched.`);
    if (r) { ui.fl.ships = {}; ui.fl.cargo = [0, 0, 0]; render(); }
  },
  recall: d => act('/api/fleet/recall', { fleetId: Number(d.id) }, 'Fleet recalled.'),
  sys: d => { const n = Number(d.n); ui.gal.sel = null; ui.gal.s += n; if (ui.gal.s < 1) { ui.gal.g = Math.max(1, ui.gal.g - 1); ui.gal.s = U().systems; } if (ui.gal.s > U().systems) { ui.gal.g = Math.min(U().galaxies, ui.gal.g + 1); ui.gal.s = 1; } loadTab(); },
  spy: d => act('/api/fleet', { planetId: cur().id, ships: { pr: 1 }, target: { g: +d.g!, s: +d.s!, p: +d.p! }, mission: 'spy', pct: 100, cargo: [0, 0, 0] }, 'Probe launched.'),
  aim: d => { Object.assign(ui.fl, { g: +d.g!, s: +d.s!, p: +d.p!, moon: +(d.moon || 0), mission: d.m }); go('fleet'); },
  scan: async d => { const r = await act('/api/phalanx', { planetId: cur().id, target: { g: +d.g!, s: +d.s!, p: +d.p! } }, 'Scan complete. See Messages.'); if (r) go('messages'); },
  ipm: () => act('/api/missile', { planetId: cur().id, n: int(ui.ipm.n, lv(cur().u, 'ipm')), target: { g: ui.gal.g, s: ui.gal.s, p: int(ui.ipm.p, 15) } }, 'Missiles away.'),
  jump: async () => {
    const i = flInfo(), sel = $('#jgsel') as HTMLSelectElement | null;
    if (!sel) return;
    const r = await act('/api/jump', { planetId: cur().id, targetId: Number(sel.value), ships: i.ships }, 'Fleet jumped.');
    if (r) { ui.fl.ships = {}; render(); }
  },
  rename: () => act('/api/planet/rename', { planetId: cur().id, name: ($('#pname') as HTMLInputElement).value }, 'Renamed.'),
  abandon: async () => {
    if (!(ui.abandonArm && Date.now() - ui.abandonArm < 4000)) { ui.abandonArm = Date.now(); return toast('Press Abandon again within 4 seconds to confirm. Everything here is lost.'); }
    ui.abandonArm = 0;
    await act('/api/planet/abandon', { planetId: cur().id }, 'Planet abandoned.');
  },
  auth: async () => {
    const u = ($('#au') as HTMLInputElement).value, p = ($('#ap') as HTMLInputElement).value, err = $('#aerr');
    err.textContent = '';
    try { await api(ui.authMode === 'login' ? '/api/login' : '/api/register', { username: u, password: p }); await refresh(); }
    catch (e) { err.textContent = (e as Error).message; }
  },
  authMode: () => { ui.authMode = ui.authMode === 'login' ? 'register' : 'login'; renderAuth(); },
};
document.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!b || (b as HTMLButtonElement).disabled) return;
  e.preventDefault();
  ACT[b.dataset.act!]?.(b.dataset);
});
document.addEventListener('submit', e => { e.preventDefault(); ACT.auth({}); });
document.addEventListener('change', e => {
  const el = e.target as HTMLInputElement, d = el.dataset;
  if (d.pc) act('/api/production', { planetId: cur().id, key: d.pc, pct: Number(el.value) });
  else if (d.fl && ['g', 's', 'p', 'moon'].includes(d.fl)) { (ui.fl as any)[d.fl] = Number(el.value); render(); }
  else if (el.id === 'gsys' || el.id === 'ggal') { Object.assign(ui.gal, { g: int(($('#ggal') as HTMLInputElement).value, U().galaxies) || 1, s: int(($('#gsys') as HTMLInputElement).value, U().systems) || 1, sel: null }); loadTab(); }
});
document.addEventListener('input', e => {
  const el = e.target as HTMLInputElement, d = el.dataset;
  if (d.qty) ui.qty[d.qty] = Number(el.value);
  else if (d.ship) { ui.fl.ships[d.ship] = Number(el.value); updFleet(); }
  else if (d.cargo) { ui.fl.cargo[Number(d.cargo)] = Number(el.value); updFleet(); }
  else if (d.ipm) (ui.ipm as any)[d.ipm] = Number(el.value);
  else if (el.id === 'gahead') { ui.gal.ahead = Number(el.value); const o = $('#gahead-out'); if (o) o.textContent = aheadText(); renderSystemInfo(); }
  else if (d.fl === 'mission') ui.fl.mission = el.value;
  else if (d.fl === 'pct') { ui.fl.pct = Number(el.value); updFleet(); }
});
$('#psel').addEventListener('change', e => { curId = Number((e.target as HTMLSelectElement).value); ui.fl.ships = {}; render(); });
const TABS = [['overview', 'Overview'], ['resources', 'Resources'], ['facilities', 'Facilities'], ['research', 'Research'], ['tree', 'Tech tree'], ['shipyard', 'Shipyard'], ['defence', 'Defence'], ['fleet', 'Fleet'], ['galaxy', 'Galaxy'], ['highscore', 'Highscore'], ['messages', 'Messages']];
function go(id: string) {
  ui.tab = id;
  try { if (location.hash !== '#' + id) location.hash = id; } catch { /* ignore */ }
  if (id === 'galaxy' && !ui.galData) { const P = cur(); Object.assign(ui.gal, { g: P.g, s: P.s, sel: null }); }
  if (['galaxy', 'highscore', 'messages'].includes(id)) loadTab();
  render();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.some(t => t[0] === h) && h !== ui.tab && S) go(h); });

/* ---------- fleet form ---------- */
function targetInfo() {
  const f = ui.fl, P = cur(), g = int(f.g, U().galaxies) || 1, s = int(f.s, U().systems) || 1, p = int(f.p, 16) || 1, moon = !!f.moon && p < 16;
  if (p === 16) return { g, s, p, moon: false, ms: ['expedition'], label: 'outer space' };
  const mine = S!.planets.find(x => x.g === g && x.s === s && x.p === p && x.moon === moon);
  const slot = ui.galData && ui.galData.g === g && ui.galData.s === s ? ui.galData.slots[p - 1] : null;
  const other = slot?.planet && slot.planet.userId !== S!.me.id ? slot.planet : null;
  const ms: string[] = [];
  if (mine) { if (mine.id !== P.id) ms.push('transport', 'deploy'); }
  else if (other) ms.push('attack', 'spy', 'transport');
  else if (!slot) ms.push('attack', 'spy', 'transport', 'colonise');
  else if (!moon) ms.push('colonise');
  if (!moon && (!slot || slot.debris)) ms.push('recycle');
  const label = mine ? `${mine.name}${mine.id === P.id ? ' (this one)' : ' (yours)'}` : other ? `${other.name} (${other.owner})` : slot ? (moon ? 'no moon here' : 'empty position') : 'open the Galaxy view to see who is there';
  return { g, s, p, moon, ms, label, debris: slot?.debris as number[] | null };
}
function flInfo() {
  const P = cur(), ships: Levels = {};
  let n = 0;
  for (const k of SHIP_IDS) { const v = int(ui.fl.ships[k], lv(P.u, k)); if (v) { ships[k] = v; n += v; } }
  const t = targetInfo(), r = resNow(P);
  const fl = n ? flight(ships, P, t, ui.fl.pct, T(), U(), now()) : null;
  const cargo = ui.fl.cargo.map((x, i) => int(x, r[i])) as Res;
  return { ships, n, cap: cargoCapacity(ships), t, fl, cargo, mission: t.ms.includes(ui.fl.mission) ? ui.fl.mission : t.ms[0] };
}
/* ---------- orbits ---------- */
const sameSystem = (a: { g: number; s: number; p: number }, b: { g: number; s: number; p: number }) =>
  a.g === b.g && a.s === b.s && a.p !== b.p && a.p <= MAX_ORBIT_POSITION && b.p <= MAX_ORBIT_POSITION;
const aheadText = () => (ui.gal.ahead ? `in ${ui.gal.ahead} h` : 'now');
const galT = () => now() + ui.gal.ahead * 3_600_000;
/** Distance from the selected planet now, whether it is closing or opening, and when it is closest. */
function orbitInfo(from: { g: number; s: number; p: number }, to: { g: number; s: number; p: number }, t: number) {
  const step = Math.min(60_000, orbitPeriod(Math.min(from.p, to.p, MAX_ORBIT_POSITION), U()) / 200);
  const d = distance(from, to, t, U()), soon = distance(from, to, t + step, U());
  if (!sameSystem(from, to)) return { d, trend: '', html: `${fmt(d)}` };
  const ca = closestApproach(from, to, t, U()), rg = orbitalRange(from.p, to.p);
  const trend = soon < d ? '↓' : soon > d ? '↑' : '';
  return { d, trend, ca, rg, html: `${fmt(d)} <span class="${trend === '↓' ? 'okc' : 'dim'}" title="${trend === '↓' ? 'closing' : 'opening'}">${trend}</span>` };
}
function updFleet() {
  const el = $('#fsum'); if (!el) return;
  const i = flInfo(), r = resNow(cur());
  if (!i.n || !i.fl) { el.innerHTML = '<dt>Flight</dt><dd>select ships to see time and fuel</dd>'; return; }
  const load = sum3(i.cargo), room = i.cap - i.fl.fuel;
  const P = cur(), oi = sameSystem(P, i.t) ? orbitInfo(P, i.t, now()) : null;
  const orbitRow = oi && oi.ca ? `<dt>Orbits</dt><dd>${oi.trend === '↓' ? 'closing' : 'opening'} · closest ${fmt(oi.ca.distance)} in ${dur(oi.ca.at - now())} · range ${fmt(oi.rg!.min)}–${fmt(oi.rg!.max)}</dd>` : '';
  const back = oi && oi.ca && !['deploy', 'colonise'].includes(i.mission) ? flight(i.ships, i.t, P, ui.fl.pct, T(), U(), now() + i.fl.dur).dur : i.fl.dur;
  el.innerHTML = `<dt>Distance</dt><dd>${fmt(i.fl.d)}</dd>${orbitRow}<dt>Flight time</dt><dd>${dur(i.fl.dur)} there${i.mission === 'deploy' ? '' : ` · about ${dur(back)} back${oi && oi.ca ? ' (planets will have moved)' : ''}`}</dd><dt>Arrives</dt><dd>${when(now() + i.fl.dur)}</dd>
    <dt>Fuel</dt><dd class="${r[2] < i.fl.fuel + i.cargo[2] ? 'badc' : ''}">${fmt(i.fl.fuel)} deuterium</dd><dt>Hold</dt><dd class="${load > room ? 'badc' : ''}">${fmt(load)} / ${fmt(Math.max(0, room))}</dd>`;
}

/* ---------- views ---------- */
const costH = (c: number[], e = 0) => c.map((x, i) => (x ? `<span class="c r${i}" data-need="${i}:${x}" title="${RES_NAMES[i]}"><i></i>${fmt(x)}</span>` : '')).join('') + (e ? `<span class="c nrg"><i></i>${fmt(e)} energy</span>` : '');
const progH = (q: { start: number; end: number }, label: string) => `<div class="prog"><span>${label} · <span data-cd="${q.end}"></span></span><div class="track"><b data-bar="${q.start},${q.end}"></b></div></div>`;
const pic = (inner: string, label: string, ground: boolean, cls = 'art') => `<svg class="${cls}" viewBox="0 0 64 64" role="img" aria-label="${label}"><rect x="1" y="1" width="62" height="62" rx="6" fill="var(--void)" stroke="var(--line)"/>${ground ? '<path d="M8 50h48" fill="none" stroke="var(--line)" stroke-width="1.5"/>' : ''}<g fill="none" stroke="var(--ink)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${inner}</g></svg>`;
const artFiles = new Art();
const shot = (name: string, cls: string) => { const u = artFiles.url(slug(name)); return u ? `<img class="${cls} shot" src="${u}" alt="${name}">` : ''; };
const art = (id: string) => shot(BLD[id].n, 'art') || pic(ART[id] || '', BLD[id].n, id !== 'na');
const unitArt = (id: string, cls = 'art') => shot(UN[id].n, cls) || pic(UNIT_ART[id] || '', UN[id].n, !!UN[id].def && id !== 'sd' && id !== 'ld' ? true : false, cls);
const techArt = (id: string) => pic(TECH_ART[id] || '', TECH[id].n, false);
const f11 = (x: number, l: number) => x * l * Math.pow(1.1, l);
function fxB(id: string, P: Planet) {
  const l = lv(P.b, id), r = Math.round, t = 1.44 - 0.004 * P.temp, sp = U().speed, bm = 1 + (POS_BONUS_METAL[P.p] || 0), bc = 1 + (POS_BONUS_CRYSTAL[P.p] || 0);
  switch (id) {
    case 'mm': return `${fmt(f11(30, l) * bm * sp)} → ${fmt(f11(30, l + 1) * bm * sp)} metal/h · energy ${r(f11(10, l))} → ${r(f11(10, l + 1))}${bm > 1 ? ` · position bonus +${r((bm - 1) * 100)}%` : ''}`;
    case 'cm': return `${fmt(f11(20, l) * bc * sp)} → ${fmt(f11(20, l + 1) * bc * sp)} crystal/h · energy ${r(f11(10, l))} → ${r(f11(10, l + 1))}${bc > 1 ? ` · position bonus +${r((bc - 1) * 100)}%` : ''}`;
    case 'ds': return `${fmt(f11(10, l) * t * sp)} → ${fmt(f11(10, l + 1) * t * sp)} deuterium/h · energy ${r(f11(20, l))} → ${r(f11(20, l + 1))}`;
    case 'sp': return `${fmt(f11(20, l))} → ${fmt(f11(20, l + 1))} energy`;
    case 'fr': { const k = 1.05 + 0.01 * lv(T(), 'en'); return `${fmt(30 * l * Math.pow(k, l))} → ${fmt(30 * (l + 1) * Math.pow(k, l + 1))} energy · burns ${fmt(f11(10, l + 1) * sp)} deuterium/h`; }
    case 'ms': case 'cs': case 'dt': return `${fmt(storageCap(l))} → ${fmt(storageCap(l + 1))} capacity`;
    case 'ro': return `Construction time ÷${l + 1} → ÷${l + 2}`;
    case 'na': return 'Halves construction and shipyard times per level';
    case 'sy': return `Shipyard time ÷${l + 1} → ÷${l + 2}; unlocks ships and defence`;
    case 'si': return `${l * 10} → ${(l + 1) * 10} missile slots`;
    case 'tf': return `+5 fields per level (${fieldsOf(P)} → ${fieldsOf(P) + 5})`;
    case 'lb': return `+3 moon fields per level (${fieldsOf(P)} → ${fieldsOf(P) + 3})`;
    case 'ph': return `Scan range ${phalanxRange(l)} → ${phalanxRange(l + 1)} systems · 5,000 deuterium per scan`;
    case 'jg': return 'Instant fleet jumps between your moons; one hour recharge';
    default: return `Research time ÷${l + 1} → ÷${l + 2}; unlocks technologies`;
  }
}
function bldView(g: 'r' | 'f', title: string) {
  const P = cur(), q = P.bq, full = fieldsUsed(P) >= fieldsOf(P), out = prod(P).out;
  return `<div class="panel"><h2>${title} · ${fieldsUsed(P)} / ${fieldsOf(P)} fields</h2>
    ${scene(g === 'r' ? 'resources' : 'facilities')}<ul class="rows">${Object.keys(BLD).filter(k => BLD[k].g === g && (P.moon ? BLD[k].m : !BLD[k].mo)).map(id => {
    const d = BLD[id], l = lv(P.b, id), c = costAt(d, l), e = energyAt(d, l), nd = missing(d.req, P.b, T());
    return `<li class="row ${nd.length && !(q && q.id === id) ? 'locked' : ''}" id="row-${id}">${art(id)}<div class="row-main"><h3>${d.n}<span class="lv">Lv ${l}</span></h3><p class="fx">${fxB(id, P)}</p><div class="meta">${costH(c, e)}<span>${dur(buildTime(P.b, c, U()))}</span></div></div>
      ${q && q.id === id ? progH(q, `Building level ${l + 1}`) + '<div class="row-act"><button class="sm" data-act="cancelB">Cancel</button></div>' : nd.length ? `<span class="lock">Requires ${nd.join(', ')}</span>`
      : `<div class="row-act"><button class="${l ? '' : 'go'}" data-act="up" data-id="${id}" data-ok="${q || full || e > out ? 0 : 1}" data-cost="${c}">${l ? `Upgrade to ${l + 1}` : 'Build'}</button></div>`}</li>`;
  }).join('')}</ul></div>`;
}
function unitView(def: boolean, title: string) {
  const P = cur();
  const q = P.yq;
  const notice = lv(P.b, 'sy') ? '' : `<div class="panel"><div class="goal"><p>There is no Shipyard here yet, so everything below is locked. A Shipyard needs Robotics Factory 2.</p><button class="go" data-act="tab" data-id="facilities">Facilities</button></div></div>`;
  const pic = scene(def ? 'defence' : 'shipyard'), sceneP = pic ? `<div class="panel"><h2>${def ? 'Defences' : 'Spaceport'} · ${esc(P.name)}</h2>${pic}</div>` : '';
  return notice + sceneP + (lv(P.b, 'sy') ? `<div class="panel"><h2>Shipyard queue</h2>${q.length ? '<ul class="rows">' + q.map((o, i) => `<li class="row">${i ? `<p class="dim">${fmt(o.n)}× ${UN[o.id].n} · waiting · ${dur(o.each)} each</p>` : progH({ start: P.yEnd - o.each, end: P.yEnd }, `${fmt(o.n)}× ${UN[o.id].n} · next unit`)}</li>`).join('') + '</ul>' : '<p class="dim">Nothing under construction.</p>'}</div>` : '') + `
  <div class="panel"><h2>${title}${def && lv(P.b, 'si') ? ` · silo ${siloUsed(P.u)} / ${siloSlots(P.b)} slots` : ''}</h2><ul class="rows">${Object.keys(UN).filter(k => !!UN[k].def === def).map(id => {
    const u = UN[id], nd = missing(u.req, P.b, T());
    const rf = RF[id] ? Object.keys(RF[id]).filter(k => k !== 'pr' && k !== 'sat').map(k => `${UN[k].n} ×${RF[id][k]}`).join(', ') : '';
    return `<li class="row ${nd.length ? 'locked' : ''}" id="row-${id}">${unitArt(id)}<div class="row-main"><h3>${u.n}<span class="lv">${fmt(lv(P.u, id))}</span></h3>
      ${u.miss ? `<p>${u.d}</p>` : `<p class="fx">hull ${fmt((u.c[0] + u.c[1]) / 10)} · shield ${fmt(u.s)} · attack ${fmt(u.a)}${u.cap != null ? ` · cargo ${fmt(u.cap)} · speed ${fmt(shipSpeed(id, T()).v)}` : ''}${id === 'sat' ? ` · ${satEnergy(P.temp)} energy each here` : ''}</p>`}
      ${rf ? `<p>Rapid fire: ${rf}</p>` : ''}<div class="meta">${costH(u.c)}<span>${dur(unitTime(P.b, u.c, U()))} each</span></div></div>
      ${nd.length ? `<span class="lock">Requires ${nd.join(', ')}</span>` : `<div class="row-act">${u.max ? '' : `<label class="dim" for="n-${id}">Qty</label><input type="number" id="n-${id}" data-qty="${id}" min="1" value="${Math.max(1, Math.floor(ui.qty[id] || 1))}">`}<button data-act="make" data-id="${id}" data-ok="1" data-cost="${u.c}">Build</button></div>`}</li>`;
  }).join('')}</ul></div>`;
}
function eventsH() {
  const own = S!.fleets.map(f => ({ ...f, kind: 'own' as const })), inc = S!.incoming.map(f => ({ ...f, kind: 'in' as const }));
  const all = [...own, ...inc].sort((a, b) => a.end - b.end);
  if (!all.length) return '<p class="dim">No fleet movements.</p>';
  return '<ul class="rows">' + all.map(f => f.kind === 'in'
    ? `<li class="row"><div class="row-main"><h3 class="${f.hostile ? 'badc' : ''}">${MISSIONS[f.mission as keyof typeof MISSIONS]} from ${esc(f.owner)} → ${co(f.target)}</h3><p>From ${co(f.origin)} · ${f.ships ? list(f.ships) : `${fmt(f.count)} ships`}</p></div>${progH(f, 'Arrives')}</li>`
    : `<li class="row"><div class="row-main"><h3>${f.phase === 'out' ? `${MISSIONS[f.mission as keyof typeof MISSIONS]} → ${co(f.target)}` : f.phase === 'hold' ? `Expedition exploring ${co(f.target)}` : `Returning to ${co(f.origin)}`}</h3><p>${list(f.ships)}${sum3(f.cargo) > 0 ? ` · cargo ${resT(f.cargo)}` : ''}</p></div>${progH(f, f.phase === 'out' ? 'Arrives' : f.phase === 'hold' ? 'Explores' : 'Lands')}
      ${f.phase !== 'back' && f.mission !== 'missile' ? `<div class="row-act"><button class="sm" data-act="recall" data-id="${f.id}">Recall</button></div>` : ''}</li>`).join('') + '</ul>';
}
const GOALS: [string, string, () => boolean][] = [
  ['Build a Solar Plant, then raise the Metal Mine to level 2.', 'resources', () => S!.planets.some(P => lv(P.b, 'sp') >= 1 && lv(P.b, 'mm') >= 2)],
  ['Raise the Crystal Mine to 2 and build a Deuterium Synthesizer.', 'resources', () => S!.planets.some(P => lv(P.b, 'cm') >= 2 && lv(P.b, 'ds') >= 1)],
  ['Build Robotics Factory 2, then a Shipyard.', 'facilities', () => S!.planets.some(P => lv(P.b, 'sy') >= 1)],
  ['Build a Research Lab and research Energy Technology, then Combustion Drive.', 'research', () => lv(T(), 'cd') >= 1],
  ['Research Espionage Technology 2 and build Espionage Probes to scout your neighbours.', 'research', () => lv(T(), 'es') >= 2],
  ['Research Astrophysics, build a Colony Ship and settle a free position between 4 and 12.', 'galaxy', () => nPlanets() > 1],
];
const VIEWS: Record<string, () => string> = {
  overview() {
    const P = cur(), g = GOALS.find(x => !x[2]()), q = P.yq[0];
    return `<div class="cols"><div class="stack">
      <div class="panel"><h2>${esc(P.name)} ${co(P)}</h2><canvas id="planet" aria-label="The ${P.moon ? 'moon' : 'planet'} seen from orbit"></canvas></div>
      <div class="panel"><h2>Structures · ${fieldsUsed(P)} / ${fieldsOf(P)} fields</h2><div class="tiles">${Object.keys(BLD).filter(k => (P.moon ? BLD[k].m : !BLD[k].mo)).map(id => {
        const l = lv(P.b, id), busy = P.bq && P.bq.id === id;
        return `<button class="tile ${l || busy ? '' : 'off'} ${busy ? 'busy' : ''}" data-act="tab" data-id="${BLD[id].g === 'r' ? 'resources' : 'facilities'}" title="${BLD[id].n}, level ${l}">${art(id)}<span class="lv">${l}</span><span>${BLD[id].n}</span>${busy ? `<span class="eta">to ${l + 1} · <span data-cd="${P.bq.end}"></span></span>` : ''}</button>`;
      }).join('')}</div><p class="dim" style="margin-top:10px;font-size:13px">Faded structures are not built yet. Select one to build or upgrade it.</p></div>
      ${g ? `<div class="panel"><h2>Next step</h2><div class="goal"><p>${g[0]}</p><button class="go" data-act="tab" data-id="${g[1]}">Go</button></div></div>` : ''}
      <div class="panel"><h2>Manage</h2><p class="row-act" style="margin:0"><label class="dim" for="pname">Name</label><input id="pname" type="text" maxlength="20" value="${esc(P.name)}"><button class="sm" data-act="rename">Rename</button>${P.home ? '' : '<button class="sm" data-act="abandon">Abandon</button>'}</p></div>
    </div><div class="stack">
      <div class="panel"><h2>${P.moon ? 'Moon' : 'Planet'}</h2><dl class="kv"><dt>Fields</dt><dd>${fieldsUsed(P)} / ${fieldsOf(P)}</dd>${P.moon ? `<dt>Diameter</dt><dd>${fmt(P.dia)} km</dd>` : `<dt>Temperature</dt><dd>${P.temp - 40}°C to ${P.temp}°C</dd>
        <dt>Position bonus</dt><dd>${POS_BONUS_METAL[P.p] ? `+${Math.round(POS_BONUS_METAL[P.p] * 100)}% metal` : POS_BONUS_CRYSTAL[P.p] ? `+${Math.round(POS_BONUS_CRYSTAL[P.p] * 100)}% crystal` : 'none'}</dd>`}
        <dt>Points</dt><dd>${fmt(S!.me.points)}</dd><dt>Planets</dt><dd>${nPlanets()} / ${maxPlanets(T())}</dd><dt>Fleet slots</dt><dd>${S!.fleets.filter(f => f.mission !== 'missile').length} / ${fleetSlots(T())}</dd>
        <dt>Expeditions</dt><dd>${S!.fleets.filter(f => f.mission === 'expedition').length} / ${maxExpeditions(T())}</dd><dt>Dark matter</dt><dd>${fmt(S!.me.dm)}</dd><dt>Stationed</dt><dd>${list(P.u)}</dd></dl></div>
      <div class="panel"><h2>In progress</h2><ul class="rows">
        <li class="row">${P.bq ? progH(P.bq, `${BLD[P.bq.id].n} ${lv(P.b, P.bq.id) + 1}`) : '<p class="dim">No building under construction.</p>'}</li>
        <li class="row">${S!.research ? progH(S!.research, `${TECH[S!.research.id].n} ${lv(T(), S!.research.id) + 1}`) : '<p class="dim">No research running.</p>'}</li>
        <li class="row">${q ? progH({ start: P.yEnd - q.each, end: P.yEnd }, `${fmt(q.n)}× ${UN[q.id].n}`) : '<p class="dim">Shipyard idle.</p>'}</li></ul></div>
      <div class="panel"><h2>Fleet movements</h2>${eventsH()}</div>
    </div></div>`;
  },
  resources() {
    const P = cur(), r = prod(P), b = P.b, x = r.x, sp = U().speed;
    if (P.moon) return bldView('r', 'Storage') + '<div class="panel"><h2>Production</h2><p class="dim">Moons produce nothing. Resources only arrive by fleet.</p></div>';
    const pc = (k: string) => (P.pc[k] ?? 100);
    const sel = (k: string) => `<select data-pc="${k}" aria-label="Output setting">${[100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0].map(v => `<option value="${v}" ${pc(k) === v ? 'selected' : ''}>${v}%</option>`).join('')}</select>`;
    const row = (n: string, v: (number | '')[], s = '') => `<tr><td>${n}</td>${v.map(y => `<td class="n ${typeof y === 'number' && y < 0 ? 'badc' : ''}">${y === '' ? '' : fmt(y)}</td>`).join('')}<td>${s}</td></tr>`;
    return bldView('r', 'Resource buildings') + `<div class="panel"><h2>Hourly production</h2><div class="scroll"><table style="min-width:560px">
      <tr><th></th><th class="n">Metal</th><th class="n">Crystal</th><th class="n">Deuterium</th><th class="n">Energy</th><th>Setting</th></tr>
      ${row('Basic income', [30 * sp, 15 * sp, 0, 0])}
      ${row(`Metal Mine ${lv(b, 'mm')}`, [x.mm, 0, 0, -f11(10, lv(b, 'mm')) * pc('mm') / 100], sel('mm'))}
      ${row(`Crystal Mine ${lv(b, 'cm')}`, [0, x.cm, 0, -f11(10, lv(b, 'cm')) * pc('cm') / 100], sel('cm'))}
      ${row(`Deuterium Synthesizer ${lv(b, 'ds')}`, [0, 0, x.ds, -f11(20, lv(b, 'ds')) * pc('ds') / 100], sel('ds'))}
      ${row(`Solar Plant ${lv(b, 'sp')}`, [0, 0, 0, x.sol], sel('sp'))}
      ${row(`Fusion Reactor ${lv(b, 'fr')}`, [0, 0, x.frd, x.fus], sel('fr'))}
      ${row(`Solar Satellites ×${lv(P.u, 'sat')}`, [0, 0, 0, x.sat], sel('sat'))}
      ${row('Storage capacity', [r.cap[0], r.cap[1], r.cap[2], ''])}
      ${row('Total per hour', [r.h[0], r.h[1], r.h[2], r.out - r.use])}</table></div>
      ${r.k < 1 ? `<p class="badc" style="margin-top:10px">Energy shortfall: mines run at ${Math.round(r.k * 100)}%.</p>` : ''}</div>`;
  },
  facilities: () => bldView('f', 'Facilities'),
  tree: () => { const P = cur(); return treeView({ BLD, TECH, UN, ART, UNIT_ART, TECH_ART, b: P.b, u: P.u, tech: T(), moon: P.moon }); },
  research() {
    const P = cur(), q = S!.research, out = prod(P).out;
    const notice = P.moon ? '<div class="panel"><p class="dim">Research runs in a planet\'s lab. Switch to a planet to start a project.</p></div>'
      : lv(P.b, 'lab') ? '' : '<div class="panel"><div class="goal"><p>There is no Research Lab here yet, so everything below is locked.</p><button class="go" data-act="tab" data-id="facilities">Facilities</button></div></div>';
    return notice + `<div class="panel"><h2>Research · Lab ${lv(P.b, 'lab')}${labs(P) > lv(P.b, 'lab') ? ` (network ${labs(P)})` : ''}</h2><ul class="rows">${Object.keys(TECH).map(id => {
      const t = TECH[id], l = lv(T(), id), c = costAt(t, l), e = energyAt(t, l), nd = missing(t.req, P.b, T());
      return `<li class="row ${nd.length && !(q && q.id === id) ? 'locked' : ''}">${techArt(id)}<div class="row-main"><h3>${t.n}<span class="lv">Lv ${l}</span></h3><p>${t.d}</p><div class="meta">${costH(c, e)}<span>${e ? 'instant' : dur(researchTime(labs(P), c, U()))}</span></div></div>
        ${q && q.id === id ? progH(q, `Researching level ${l + 1}`) + '<div class="row-act"><button class="sm" data-act="cancelR">Cancel</button></div>' : nd.length ? `<span class="lock">Requires ${nd.join(', ')}</span>`
        : `<div class="row-act"><button data-act="tech" data-id="${id}" data-ok="${e ? (e <= out && !q ? 1 : 0) : q ? 0 : 1}" data-cost="${c}">Research ${l + 1}</button></div>`}</li>`;
    }).join('')}</ul></div>`;
  },
  shipyard: () => unitView(false, 'Ships'),
  defence: () => unitView(true, 'Defence and missiles'),
  fleet() {
    const P = cur(), f = ui.fl, av = SHIP_IDS.filter(k => lv(P.u, k) > 0), t = targetInfo(), mis = t.ms.includes(f.mission) ? f.mission : t.ms[0];
    const gates = S!.planets.filter(x => x.id !== P.id && x.moon && lv(x.b, 'jg')), r = resNow(P);
    return `<div class="cols"><div class="stack">
      <div class="panel"><h2>Ships at ${esc(P.name)}</h2>${av.length ? `<div class="form">${av.map(k => `<label for="s-${k}" class="shiplabel">${unitArt(k, 'mini')}${UN[k].n} <span class="dim mono">${fmt(lv(P.u, k))}</span></label><input type="number" id="s-${k}" data-ship="${k}" min="0" max="${lv(P.u, k)}" value="${int(f.ships[k], lv(P.u, k))}"><button class="sm" data-act="all" data-id="${k}">All</button>`).join('')}</div>`
        : '<div class="goal"><p>No ships stationed here.</p><button class="go" data-act="tab" data-id="shipyard">Shipyard</button></div>'}</div>
      <div class="panel"><h2>Cargo</h2><div class="form">${RES_NAMES.map((n, i) => `<label for="c-${i}">${n}</label><input type="number" id="c-${i}" data-cargo="${i}" min="0" value="${int(f.cargo[i], r[i])}"><span></span>`).join('')}</div>
        <p style="margin-top:10px"><button class="sm" data-act="maxc">Load as much as fits</button></p></div>
      ${P.moon && lv(P.b, 'jg') ? `<div class="panel"><h2>Jump Gate</h2>${gates.length ? `<p class="row-act" style="margin:0"><select id="jgsel">${gates.map(x => `<option value="${x.id}">${esc(x.name)} ${co(x)}</option>`).join('')}</select><button data-act="jump">Jump selected ships</button></p><p class="dim" style="margin-top:8px;font-size:13px">${now() < P.jgReady ? `Recharging: <span data-cd="${P.jgReady}"></span> left.` : 'Ready. Ships arrive instantly; cargo stays behind.'}</p>` : '<p class="dim">No other moon of yours has a Jump Gate.</p>'}</div>` : ''}
    </div><div class="stack">
      <div class="panel"><h2>Destination</h2><div class="form">
        <label for="f-g">Galaxy (1 to ${U().galaxies})</label><input type="number" id="f-g" data-fl="g" min="1" max="${U().galaxies}" value="${t.g}"><span></span>
        <label for="f-s">System (1 to ${U().systems})</label><input type="number" id="f-s" data-fl="s" min="1" max="${U().systems}" value="${t.s}"><span></span>
        <label for="f-p">Position (1 to 15, 16 is outer space)</label><input type="number" id="f-p" data-fl="p" min="1" max="16" value="${t.p}"><span></span>
        <label for="f-t">Target type</label><select id="f-t" data-fl="moon"><option value="0" ${t.moon ? '' : 'selected'}>Planet</option><option value="1" ${t.moon ? 'selected' : ''}>Moon</option></select><span></span>
        <label for="f-m">Mission</label><select id="f-m" data-fl="mission">${t.ms.map(m => `<option value="${m}" ${m === mis ? 'selected' : ''}>${MISSIONS[m as keyof typeof MISSIONS]}</option>`).join('') || '<option value="">None available</option>'}</select><span></span>
        <label for="f-v">Speed</label><select id="f-v" data-fl="pct">${[100, 90, 80, 70, 60, 50, 40, 30, 20, 10].map(v => `<option value="${v}" ${v === f.pct ? 'selected' : ''}>${v}%</option>`).join('')}</select><span></span></div>
        <dl class="kv" style="margin-top:12px"><dt>Target</dt><dd>${co(t)} ${esc(t.label)}</dd>${t.debris ? `<dt>Debris</dt><dd>${fmt(t.debris[0])} metal, ${fmt(t.debris[1])} crystal</dd>` : ''}
          ${mis === 'colonise' ? `<dt>Colony rules</dt><dd class="${lv(T(), 'as') < positionNeeds(t.p) || nPlanets() >= maxPlanets(T()) ? 'badc' : ''}">planets ${nPlanets()} / ${maxPlanets(T())} · position needs Astrophysics ${positionNeeds(t.p)} · ${POS_FIELDS_MIN[t.p - 1]} to ${POS_FIELDS_MAX[t.p - 1]} fields</dd>` : ''}
          ${mis === 'expedition' ? `<dt>Expedition</dt><dd class="${maxExpeditions(T()) ? '' : 'badc'}">slots ${S!.fleets.filter(x => x.mission === 'expedition').length} / ${maxExpeditions(T())} · explores for 1 hour</dd>` : ''}</dl>
        <dl class="kv" id="fsum" style="margin-top:4px"></dl>
        <p style="margin-top:12px"><button class="go" data-act="launch">Send fleet</button></p></div>
      <div class="panel"><h2>Fleet movements</h2>${eventsH()}</div>
    </div></div>`;
  },
  galaxy() {
    const P = cur(), d = ui.galData, ph = P.moon && lv(P.b, 'ph');
    const head = `<p class="row-act" style="margin:0 0 12px"><button class="sm" data-act="sys" data-n="-1">◀ Previous</button>
      <label class="dim" for="ggal">Galaxy</label><input type="number" id="ggal" min="1" max="${U().galaxies}" value="${ui.gal.g}">
      <label class="dim" for="gsys">System</label><input type="number" id="gsys" min="1" max="${U().systems}" value="${ui.gal.s}"><button class="sm" data-act="sys" data-n="1">Next ▶</button></p>`;
    if (!d) return `<div class="panel"><h2>Solar system</h2>${head}<p class="dim">Loading…</p></div>`;
    const here = P.g === d.g && P.s === d.s;
    const t = galT();
    const A = (p: number, m: string, l: string, mo = 0) => `<button class="sm" data-act="aim" data-g="${d.g}" data-s="${d.s}" data-p="${p}" data-m="${m}" data-moon="${mo}">${l}</button> `;
    const actions = (x: any) => {
      const pl = x.planet, mine = pl && pl.userId === S!.me.id;
      const acts = !pl ? (lv(T(), 'as') < positionNeeds(x.p) ? `<span class="dim">Astrophysics ${positionNeeds(x.p)}</span> ` : A(x.p, 'colonise', 'Colonise'))
        : mine ? (S!.planets.some(q => q.g === d.g && q.s === d.s && q.p === x.p && q.id !== P.id) ? A(x.p, 'transport', 'Transport') : '')
        : `<button class="sm" data-act="spy" data-g="${d.g}" data-s="${d.s}" data-p="${x.p}">Spy</button> ${A(x.p, 'attack', 'Attack')}${A(x.p, 'transport', 'Transport')}${ph ? `<button class="sm" data-act="scan" data-g="${d.g}" data-s="${d.s}" data-p="${x.p}">Scan</button> ` : ''}${lv(P.u, 'ipm') ? `<button class="sm" data-act="aimIpm" data-p="${x.p}">Missiles</button> ` : ''}`;
      return acts + (x.debris ? A(x.p, 'recycle', 'Harvest') : '');
    };
    const rows = d.slots.map((x: any) => {
      const pl = x.planet, mine = pl && pl.userId === S!.me.id, inactive = pl && !mine && now() - pl.lastSeen > 7 * 86400000;
      const dist = here && x.p === P.p ? '<span class="dim">you</span>' : orbitInfo(P, { g: d.g, s: d.s, p: x.p }, t).html;
      return `<tr class="${mine ? 'me' : ''} ${ui.gal.sel === x.p ? 'sel' : ''}" data-act="galSel" data-p="${x.p}"><td class="n">${x.p}</td><td>${pl ? esc(pl.name) + (x.moon ? ' + moon' : '') : '<span class="dim">free orbit</span>'}</td>
        <td>${pl ? (mine ? 'You' : `${esc(pl.owner)} <span class="dim mono">${fmt(pl.points)}</span>${inactive ? ' <span class="dim">(inactive)</span>' : ''}`) : ''}</td>
        <td class="n">${dist}</td><td class="n">${x.debris ? fmt(x.debris[0] + x.debris[1]) : ''}</td><td>${actions(x)}</td></tr>`;
    }).join('') + `<tr><td class="n">16</td><td class="dim">Outer space</td><td></td><td class="n">${fmt(distance(P, { g: d.g, s: d.s, p: 16 }))}</td><td></td><td>${A(16, 'expedition', 'Expedition')}</td></tr>`;
    return `<div class="panel"><h2>Solar system ${d.g}:${d.s}</h2>${head}
      <canvas id="orrery" aria-label="Solar system ${d.g}:${d.s} with its planets on their orbits. Select a planet to see its distance from you."></canvas>
      <div class="sys-bar"><label for="gahead" class="dim">Orbit preview</label><input type="range" id="gahead" min="0" max="72" step="1" value="${ui.gal.ahead}"><output id="gahead-out" class="mono">${aheadText()}</output>
        <span class="dim" style="font-size:13px">Planets move along their orbits, so distances inside a system change over time. Fleets launch at the current positions.</span></div>
      <div id="sysinfo"></div></div>
      <div class="panel"><div class="scroll"><table class="gal"><tr><th class="n">Pos</th><th>Planet</th><th>Player</th><th class="n">Distance ${aheadText()}</th><th class="n">Debris</th><th>Actions</th></tr>${rows}</table></div>
      <p class="dim" style="margin-top:10px;font-size:13px">Distances are from ${esc(P.name)} ${co(P)}. ↓ means the planets are closing in. Spy sends one probe. Planets: ${nPlanets()} of ${maxPlanets(T())}.</p></div>
      ${lv(P.u, 'ipm') > 0 ? `<div class="panel"><h2>Interplanetary missiles · ${lv(P.u, 'ipm')} ready</h2><p class="row-act" style="margin:0"><label class="dim" for="ipn">Missiles</label><input type="number" id="ipn" data-ipm="n" min="1" max="${lv(P.u, 'ipm')}" value="${int(ui.ipm.n, lv(P.u, 'ipm')) || 1}">
        <label class="dim" for="ipp">Position in system ${d.s}</label><input type="number" id="ipp" data-ipm="p" min="1" max="15" value="${int(ui.ipm.p, 15) || 1}"><button data-act="ipm">Launch</button></p>
        <p class="dim" style="margin-top:8px;font-size:13px">Range ${missileRange(T())} systems within your galaxy. Inside your own system the flight time follows the orbits, from about 30 seconds when lined up to about 80 from the far side of the star; other systems take 30 seconds plus 60 per system.</p></div>` : ''}`;
  },
  highscore() {
    const h = ui.hs;
    if (!h) return '<div class="panel"><h2>Highscore</h2><p class="dim">Loading…</p></div>';
    return `<div class="panel"><h2>Highscore · you are rank ${h.rank} of ${h.total}</h2><div class="scroll"><table class="gal" style="min-width:420px"><tr><th class="n">Rank</th><th>Player</th><th>Home</th><th class="n">Points</th></tr>
      ${h.rows.map((x: any) => `<tr class="${x.id === S!.me.id ? 'me' : ''}"><td class="n">${x.rank}</td><td>${esc(x.username)}</td><td>${esc(x.home ?? '')}</td><td class="n">${fmt(x.points)}</td></tr>`).join('')}</table></div>
      <p class="dim" style="margin-top:10px;font-size:13px">One point per 1,000 resources invested in buildings, research, ships and defence.</p></div>`;
  },
  messages() {
    if (!ui.msgs) return '<div class="panel"><h2>Messages</h2><p class="dim">Loading…</p></div>';
    if (!ui.msgs.length) return '<div class="panel"><h2>Messages</h2><p class="dim">No messages yet.</p></div>';
    return `<div class="panel"><h2>Messages</h2><ul class="msgs">${ui.msgs.map(m => `<li class="${esc(m.kind)}"><time>${when(m.at)}</time><h3>${esc(m.title)}</h3><div class="b">${esc(m.body).replace(/\n/g, '<br>')}</div></li>`).join('')}</ul></div>`;
  },
};
ACT.treeSel = d => { treeUI.sel = d.id!; render(); };
ACT.treeCat = d => { treeUI.cat = d.id!; render(); };
/* The colony picture: image files placed on a landscape (web/scene.ts). */
function scene(mode: SceneMode) {
  const P = cur(), units = mode === 'shipyard' || mode === 'defence';
  const items = units ? Object.keys(UN).filter(k => !!UN[k].def === (mode === 'defence')).map(id => ({ id, name: UN[id].n, n: lv(P.u, id), building: P.yq.some(o => o.id === id) }))
    : Object.keys(BLD).filter(k => BLD[k].g === (mode === 'resources' ? 'r' : 'f')).map(id => ({ id, name: BLD[id].n, n: lv(P.b, id), building: !!P.bq && P.bq.id === id }));
  return sceneH({ mode, moon: P.moon, temp: P.temp, planet: P.name, items, art: artFiles, units });
}
ACT.jump = d => {
  const row = document.getElementById('row-' + d.id);
  if (row) { row.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' }); row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); }
};
const SHIP_ORDER = SHIP_IDS.concat(['sat']);
ACT.galSel = d => { ui.gal.sel = Number(d.p); render(); };
function renderSystemInfo() {
  const el = $('#sysinfo'), d = ui.galData;
  if (!el || !d) return;
  const p = ui.gal.sel;
  if (p == null) { el.innerHTML = '<p class="dim" style="margin-top:10px">Select a planet or an empty orbit to see how far it is and when it comes closest.</p>'; return; }
  const P = cur(), x = d.slots[p - 1], pl = x.planet, target = { g: d.g, s: d.s, p }, t = galT();
  const mine = pl && pl.userId === S!.me.id;
  let orbit = '';
  if (P.g === d.g && P.s === d.s && P.p === p) orbit = '<dd>This is the planet your fleets leave from.</dd>';
  else {
    const oi = orbitInfo(P, target, t);
    orbit = `<dd>${fmt(oi.d)} ${aheadText()}${oi.ca ? ` · ${oi.trend === '↓' ? 'closing in' : 'moving apart'} · closest ${fmt(oi.ca.distance)} ${oi.ca.at - t < 60_000 ? 'right about now' : `in ${dur(oi.ca.at - t)}`} · furthest ${fmt(oi.rg!.max)}` : ' · another system, so the distance does not change'}</dd>`;
  }
  el.innerHTML = `<div class="sysinfo"><h3>${p} · ${pl ? esc(pl.name) : 'Free orbit'}${pl ? ` <span class="dim">${mine ? 'yours' : esc(pl.owner)}</span>` : ''}</h3>
    <dl class="kv"><dt>Distance from ${esc(P.name)}</dt>${orbit}${P.g === d.g && !(P.s === d.s && P.p === p) ? `<dt>Missile flight</dt><dd>${dur(missileFlightTime(P, target, t, U()))}${Math.abs(P.s - d.s) > missileRange(T()) ? ' <span class="dim">(out of your missile range)</span>' : ''}</dd>` : ''}<dt>Orbit</dt><dd>${dur(orbitPeriodMs(p))} per lap</dd></dl></div>`;
}
const orbitPeriodMs = (p: number) => orbitPeriod(p, U());
let sysHits: Hit[] = [];
document.addEventListener('click', e => {
  const cv = e.target as HTMLCanvasElement;
  if (cv.id !== 'orrery') return;
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  let best: Hit | null = null, bd = Infinity;
  for (const h of sysHits) { const dd = Math.hypot(h.x - x, h.y - y); if (dd < h.r && dd < bd) { bd = dd; best = h; } }
  if (best) { ui.gal.sel = best.p; render(); }
});
function drawOrrery(cv: HTMLCanvasElement) {
  const d = ui.galData, P = cur();
  if (!d || !S) return;
  const here = P.g === d.g && P.s === d.s;
  const slots = d.slots.map((x: any) => ({ p: x.p, owner: x.planet ? (x.planet.userId === S!.me.id ? 'me' : 'other') : null, name: x.planet?.name, moon: x.moon, debris: !!x.debris }));
  const t = galT(), sel = ui.gal.sel;
  const label = here && sel && sel !== P.p ? `${fmt(distance(P, { g: d.g, s: d.s, p: sel }, t, U()))}` : undefined;
  sysHits = drawSystem(cv, { g: d.g, s: d.s, t, U: U(), slots, selected: sel, home: here ? P.p : null, distanceLabel: label }, v => getComputedStyle(document.documentElement).getPropertyValue(v).trim());
}
ACT.aimIpm = d => { ui.ipm.p = Number(d.p); render(); ($('#ipn') as HTMLInputElement | null)?.focus(); };

/* ---------- render ---------- */
function renderAuth() {
  $('#game-head').hidden = true; $('#bar').hidden = true; $('#alert').hidden = true;
  const reg = ui.authMode === 'register';
  $('#view').innerHTML = `<form class="panel auth" autocomplete="on"><h2>${reg ? 'Create your empire' : 'Sign in'}</h2>
    <label for="au">Commander name</label><input id="au" name="username" autocomplete="username" required minlength="3" maxlength="20">
    <label for="ap">Password</label><input id="ap" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required minlength="8">
    <p class="err" id="aerr" role="alert"></p>
    <button class="go" type="submit">${reg ? 'Create account' : 'Sign in'}</button>
    <p class="dim">${reg ? 'Already playing?' : 'New here?'} <button type="button" class="switch" data-act="authMode">${reg ? 'Sign in' : 'Create an account'}</button></p></form>`;
}
function render() {
  if (!S) return renderAuth();
  $('#game-head').hidden = false; $('#bar').hidden = false;
  const a = document.activeElement?.id;
  $('#who').textContent = `${S.me.username} · ${fmt(S.me.points)} points`;
  $('#tabs').innerHTML = TABS.map(t => `<button data-act="tab" data-id="${t[0]}" ${t[0] === ui.tab ? 'aria-current="page"' : ''}>${t[1]}${t[0] === 'messages' && S!.unread ? ` (${S!.unread})` : ''}</button>`).join('');
  $('#psel').innerHTML = S.planets.map(P => `<option value="${P.id}" ${P.id === cur().id ? 'selected' : ''}>${esc(P.name)} ${co(P)}</option>`).join('');
  $('#view').innerHTML = VIEWS[ui.tab]();
  const hs = S.incoming.filter(f => f.hostile).sort((x, y) => x.end - y.end)[0], al = $('#alert');
  if (hs) { al.hidden = false; al.innerHTML = `<div class="warn"><strong>Under attack</strong><span>${esc(hs.owner)}'s ${MISSIONS[hs.mission as keyof typeof MISSIONS].toLowerCase()} reaches ${co(hs.target)} in <span class="mono" data-cd="${hs.end}"></span>. Move ships and resources out or strengthen the defence.</span></div>`; }
  else al.hidden = true;
  if (a && a !== 'psel') (document.getElementById(a) as HTMLElement | null)?.focus();
  updFleet(); renderSystemInfo(); live();
}
let refreshing = false;
function live() {
  if (!S) return;
  const P = cur(), r = prod(P), res = resNow(P), t = now();
  for (let i = 0; i < 3; i++) {
    const v = $('#v' + i); v.textContent = fmt(res[i]); v.classList.toggle('full', res[i] >= r.cap[i]);
    $('#h' + i).textContent = `${r.h[i] < 0 ? '' : '+'}${fmt(r.h[i])}/h`;
  }
  const e = $('#vE'), net = Math.round(r.out - r.use);
  e.textContent = fmt(net); e.classList.toggle('low', net < 0); $('#hE').textContent = `${fmt(r.use)} of ${fmt(r.out)} used`;
  $('#clock').textContent = new Date(t).toLocaleTimeString();
  let due = false;
  document.querySelectorAll<HTMLElement>('[data-cd]').forEach(x => { const left = Number(x.dataset.cd) - t; if (left <= 0) due = true; x.textContent = dur(left); });
  document.querySelectorAll<HTMLElement>('[data-bar]').forEach(x => { const [a, b] = x.dataset.bar!.split(',').map(Number); x.style.width = `${Math.max(0, Math.min(100, ((t - a) / (b - a)) * 100))}%`; });
  document.querySelectorAll<HTMLElement>('[data-need]').forEach(x => { const [k, v] = x.dataset.need!.split(':'); x.classList.toggle('short', res[+k] < +v); });
  document.querySelectorAll<HTMLButtonElement>('button[data-cost]').forEach(b => { b.disabled = !(b.dataset.ok === '1' && can(P, b.dataset.cost!.split(',').map(Number))); });
  if (due && !refreshing) { refreshing = true; setTimeout(() => refresh().finally(() => (refreshing = false)), 600); }
}

/* ---------- planet canvas ---------- */
function rng(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const VOID = getComputedStyle(document.documentElement).getPropertyValue('--void').trim() || '#0b0d1c';
function drawPlanet(cv: HTMLCanvasElement, t: number) {
  const P = cur(), d = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(d, 0, 0, d, 0, 0); ctx.fillStyle = VOID; ctx.fillRect(0, 0, w, h);
  let r = rng(7);
  for (let i = 0; i < 140; i++) { ctx.fillStyle = `rgba(${(200 + r() * 55) | 0},${(205 + r() * 40) | 0},255,${0.15 + r() * 0.6})`; const s = r() < 0.08 ? 1.6 : 0.9; ctx.fillRect(r() * w, r() * h, s, s); }
  const R = Math.min(w, h) * (P.moon ? 0.2 : 0.3), cx = w * 0.5, cy = h * 0.52, rot = -0.32;
  const pal = P.moon ? ['#8d8f9c', '#b9bcc8', '#7c7f8e', '#3b3d4c'] : P.temp >= 90 ? ['#7a2c2c', '#c8663a', '#8a3a34', '#40202f'] : P.temp >= 10 ? ['#2c5a6b', '#3f8a6a', '#2f5f7d', '#1f2a4a'] : ['#7d93b8', '#c9d8ea', '#8aa0c4', '#39466e'];
  const ring = (a: number, b: number) => { if (P.moon) return; ctx.beginPath(); ctx.ellipse(cx, cy, R * 1.75, R * 0.36, rot, a, b); ctx.strokeStyle = 'rgba(127,216,234,.25)'; ctx.lineWidth = R * 0.07; ctx.stroke(); };
  ring(Math.PI, Math.PI * 2);
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip();
  const g = ctx.createLinearGradient(0, cy - R, 0, cy + R); pal.forEach((c, i) => g.addColorStop(i / 3, c)); ctx.fillStyle = g; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  r = rng(P.g * 9973 + P.s * 32 + P.p * 2 + (P.moon ? 1 : 0));
  if (P.moon) for (let i = 0; i < 14; i++) { const a = r() * 7, q = Math.sqrt(r()) * R * 0.85; ctx.fillStyle = `rgba(20,20,34,${0.15 + r() * 0.25})`; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * q, cy + Math.sin(a) * q, R * (0.04 + r() * 0.1), 0, 7); ctx.fill(); }
  else for (let i = 0; i < 16; i++) { const y = cy - R + r() * 2 * R, hh = R * (0.03 + r() * 0.1); ctx.fillStyle = r() < 0.5 ? `rgba(14,12,34,${0.1 + r() * 0.2})` : `rgba(255,240,220,${0.05 + r() * 0.13})`; ctx.beginPath(); ctx.ellipse(cx + Math.sin(t / 14000 + i) * R * 0.06, y, R * 1.15, hh, 0, 0, 7); ctx.fill(); }
  const sh = ctx.createRadialGradient(cx - R * 0.45, cy - R * 0.5, R * 0.1, cx - R * 0.1, cy - R * 0.1, R * 1.25);
  sh.addColorStop(0, 'rgba(255,240,220,.16)'); sh.addColorStop(0.5, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(6,7,20,.92)');
  ctx.fillStyle = sh; ctx.fillRect(cx - R, cy - R, R * 2, R * 2); ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.strokeStyle = 'rgba(255,180,84,.3)'; ctx.lineWidth = 1.5; ctx.stroke();
  ring(0, Math.PI);
  const n = Math.min(18, SHIP_IDS.reduce((a, k) => a + lv(P.u, k), 0) + lv(P.u, 'sat'));
  for (let i = 0; i < n; i++) {
    const a = t / (5200 + i * 310) + i * 2.4, rx = R * (1.22 + (i % 3) * 0.1), x0 = Math.cos(a) * rx, y0 = Math.sin(a) * rx * 0.28;
    const x = cx + x0 * Math.cos(rot) - y0 * Math.sin(rot), y = cy + x0 * Math.sin(rot) + y0 * Math.cos(rot);
    if (Math.sin(a) < 0 && Math.hypot(x - cx, y - cy) < R) continue;
    ctx.fillStyle = Math.sin(a) < 0 ? 'rgba(231,233,246,.45)' : '#e7e9f6'; ctx.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
  }
}
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
function frame(t: number) {
  const p = document.getElementById('planet') as HTMLCanvasElement | null; if (S && p && p.clientWidth) drawPlanet(p, still ? 0 : t);
  const o = document.getElementById('orrery') as HTMLCanvasElement | null; if (S && o && o.clientWidth) drawOrrery(o);
  requestAnimationFrame(frame);
}

/* ---------- boot ---------- */
const h0 = location.hash.slice(1);
if (TABS.some(t => t[0] === h0)) ui.tab = h0;
refresh().then(() => {
  fetch('/api/art').then(r => r.json()).then(j => { artFiles.set(j.files || []); if (S) render(); }).catch(() => { /* no artwork: lists only */ });
  if (S && ['galaxy', 'highscore', 'messages'].includes(ui.tab)) { if (ui.tab === 'galaxy') { const P = cur(); Object.assign(ui.gal, { g: P.g, s: P.s, sel: null }); } loadTab(); } });
requestAnimationFrame(frame);
setInterval(() => live(), 250);
setInterval(() => { if (S && document.visibilityState === 'visible' && !ui.busy) refresh(); }, 15000);
export type { Res };
