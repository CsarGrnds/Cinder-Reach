// Solar system view: a star with its 15 orbits seen from slightly above, planets drawn where the
// shared orbit rules put them at time t. Pure drawing; the caller supplies what sits on each orbit.
import { orbitAngle, orbitPhase, type OrbitUniverse } from '../src/rules/orbits.ts';

export interface SystemSlot {
  p: number;
  owner: 'me' | 'other' | null;   // null = free orbit
  name?: string;
  moon?: boolean;
  debris?: boolean;
}
export interface SystemScene {
  g: number; s: number; t: number; U: OrbitUniverse;
  slots: SystemSlot[];
  selected: number | null;
  home: number | null;            // your selected planet's position, when it is in this system
  distanceLabel?: string;         // shown on the line from home to the selected planet
}
export interface Hit { p: number; x: number; y: number; r: number }

const TILT = 0.42;
const TAU = Math.PI * 2;

function rng(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Look of a world by distance from its star: scorched rock, temperate, gas giants, ice. */
function look(g: number, s: number, p: number) {
  const r = rng(Math.floor(orbitPhase(g, s, p) * 1e6));
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  if (p <= 3) return { size: 3.6 + r() * 1.2, cols: pick([['#e08a55', '#7a2e22'], ['#c9744a', '#5c2a24'], ['#d9a066', '#6e3826']]), gas: false, ring: false };
  if (p <= 6) return { size: 5 + r() * 1.4, cols: pick([['#6fb6a0', '#1f4a5e'], ['#7fa6d6', '#24406e'], ['#a8b071', '#3e4a2c']]), gas: false, ring: false };
  if (p <= 10) return { size: 8 + r() * 3, cols: pick([['#e6c497', '#9a6542'], ['#e3b07a', '#8a4f33'], ['#d8c8a8', '#7a6a55']]), gas: true, ring: r() < 0.45 };
  if (p <= 12) return { size: 7 + r() * 1.5, cols: pick([['#c3d3e8', '#5e7aa6'], ['#b5e0dc', '#4a7f8c']]), gas: true, ring: r() < 0.3 };
  return { size: 3.8 + r() * 1.4, cols: pick([['#e1f1f7', '#7ea7c4'], ['#d0e4ff', '#6a86b8']]), gas: false, ring: false };
}

export function drawSystem(cv: HTMLCanvasElement, sc: SystemScene, css: (v: string) => string): Hit[] {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = w / 2, cy = h / 2;
  const sunR = Math.max(9, Math.min(w, h / TILT) * 0.028);
  const maxR = Math.min(w * 0.47, (h * 0.46) / TILT);
  const inner = sunR * 2.4;
  const rx = (p: number) => inner + ((maxR - inner) * (p - 1)) / 14;
  const amber = css('--amber') || '#ffb454', ink = css('--ink') || '#e7e9f6', dim = css('--dim') || '#959cc4', line = css('--line') || '#2a3263';

  // Space.
  ctx.fillStyle = css('--void') || '#0b0d1c';
  ctx.fillRect(0, 0, w, h);
  const st = rng(sc.g * 1000 + sc.s);
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = `rgba(${200 + st() * 55 | 0},${205 + st() * 45 | 0},255,${0.12 + st() * 0.5})`;
    const z = st() < 0.07 ? 1.5 : 0.8;
    ctx.fillRect(st() * w, st() * h, z, z);
  }

  // Orbits.
  for (let p = 1; p <= 15; p++) {
    const sel = p === sc.selected, mine = p === sc.home;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx(p), rx(p) * TILT, 0, 0, TAU);
    ctx.strokeStyle = sel ? amber : mine ? 'rgba(255,180,84,.45)' : line;
    ctx.globalAlpha = sel || mine ? 0.9 : 0.55;
    ctx.lineWidth = sel ? 1.4 : 1;
    ctx.setLineDash(sc.slots.find(x => x.p === p)?.owner ? [] : [2, 4]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Where everything is right now.
  const bodies = sc.slots.map(slot => {
    const a = orbitAngle({ g: sc.g, s: sc.s, p: slot.p }, sc.t, sc.U);
    return { slot, a, x: cx + rx(slot.p) * Math.cos(a), y: cy + rx(slot.p) * TILT * Math.sin(a), lk: look(sc.g, sc.s, slot.p) };
  });
  const hits: Hit[] = [];

  const drawSun = () => {
    const glow = ctx.createRadialGradient(cx, cy, sunR * 0.4, cx, cy, sunR * 4.2);
    glow.addColorStop(0, 'rgba(255,214,140,.55)'); glow.addColorStop(0.35, 'rgba(255,160,70,.18)'); glow.addColorStop(1, 'rgba(255,140,60,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, sunR * 4.2, 0, TAU); ctx.fill();
    const core = ctx.createRadialGradient(cx - sunR * 0.3, cy - sunR * 0.3, sunR * 0.1, cx, cy, sunR);
    core.addColorStop(0, '#fffbe8'); core.addColorStop(0.5, '#ffd27a'); core.addColorStop(1, '#ff9a3c');
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, sunR, 0, TAU); ctx.fill();
  };

  const drawBody = (b: typeof bodies[number]) => {
    const { slot, x, y, lk } = b;
    if (!slot.owner) {
      // A free orbit: a faint marker where a colony would settle.
      ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU);
      ctx.strokeStyle = slot.p === sc.selected ? amber : dim; ctx.globalAlpha = 0.6; ctx.setLineDash([1.5, 2]); ctx.lineWidth = 1; ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      hits.push({ p: slot.p, x, y, r: 10 });
    } else {
      const r = lk.size * Math.max(0.8, Math.min(1.35, w / 900));
      if (lk.ring) { ctx.beginPath(); ctx.ellipse(x, y, r * 2, r * 0.62, -0.25, Math.PI, TAU); ctx.strokeStyle = 'rgba(230,210,170,.45)'; ctx.lineWidth = r * 0.28; ctx.stroke(); }
      // Lit from the star.
      const dx = cx - x, dy = cy - y, dl = Math.hypot(dx, dy) || 1;
      const hx = x + (dx / dl) * r * 0.45, hy = y + (dy / dl) * r * 0.45;
      const gr = ctx.createRadialGradient(hx, hy, r * 0.1, x, y, r * 1.1);
      gr.addColorStop(0, lk.cols[0]); gr.addColorStop(0.75, lk.cols[1]); gr.addColorStop(1, '#0a0b18');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      if (lk.gas) {
        ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
        ctx.globalAlpha = 0.22; ctx.fillStyle = '#2a1c14';
        for (const k of [-0.45, -0.1, 0.3]) ctx.fillRect(x - r, y + k * r, r * 2, r * 0.16);
        ctx.restore(); ctx.globalAlpha = 1;
      }
      if (lk.ring) { ctx.beginPath(); ctx.ellipse(x, y, r * 2, r * 0.62, -0.25, 0, Math.PI); ctx.strokeStyle = 'rgba(230,210,170,.55)'; ctx.lineWidth = r * 0.28; ctx.stroke(); }
      if (slot.moon) {
        const ma = (sc.t / 3_600_000) * 1.3 + slot.p;
        ctx.fillStyle = '#b9bcc8'; ctx.beginPath(); ctx.arc(x + Math.cos(ma) * r * 1.9, y + Math.sin(ma) * r * 0.9, Math.max(1.4, r * 0.28), 0, TAU); ctx.fill();
      }
      if (slot.debris) {
        const dr = rng(slot.p * 31);
        ctx.fillStyle = 'rgba(212,154,120,.8)';
        for (let i = 0; i < 9; i++) ctx.fillRect(x + (dr() - 0.5) * r * 5, y + (dr() - 0.5) * r * 2.2, 1.2, 1.2);
      }
      if (slot.owner === 'me') { ctx.beginPath(); ctx.arc(x, y, r + 3, 0, TAU); ctx.strokeStyle = amber; ctx.lineWidth = 1.3; ctx.stroke(); }
      if (slot.p === sc.selected) { ctx.beginPath(); ctx.arc(x, y, r + 6, 0, TAU); ctx.setLineDash([3, 3]); ctx.strokeStyle = amber; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]); }
      if (slot.name) {
        ctx.font = `${slot.owner === 'me' ? 600 : 500} 11px "IBM Plex Sans", system-ui, sans-serif`;
        ctx.fillStyle = slot.owner === 'me' ? amber : ink; ctx.textAlign = 'left';
        const label = w < 520 ? String(slot.p) : `${slot.p} · ${slot.name}`;
        const tx = Math.min(w - ctx.measureText(label).width - 4, x + r + 5);
        ctx.fillText(label, tx, y - r - 2);
      }
      hits.push({ p: slot.p, x, y, r: Math.max(12, r + 6) });
    }
  };

  const behind = bodies.filter(b => Math.sin(b.a) < 0).sort((a, b) => a.y - b.y);
  const front = bodies.filter(b => Math.sin(b.a) >= 0).sort((a, b) => a.y - b.y);
  behind.forEach(drawBody);
  drawSun();
  front.forEach(drawBody);

  // Route from your planet to the selected one.
  const from = bodies.find(b => b.slot.p === sc.home), to = bodies.find(b => b.slot.p === sc.selected);
  if (from && to && from !== to) {
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = amber; ctx.globalAlpha = 0.75; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.2; ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (sc.distanceLabel) {
      const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
      ctx.font = '500 12px "IBM Plex Mono", ui-monospace, monospace';
      const tw = ctx.measureText(sc.distanceLabel).width;
      ctx.fillStyle = 'rgba(11,13,28,.85)'; ctx.fillRect(mx - tw / 2 - 6, my - 10, tw + 12, 20);
      ctx.fillStyle = amber; ctx.textAlign = 'center'; ctx.fillText(sc.distanceLabel, mx, my + 4);
    }
  }
  return hits;
}
