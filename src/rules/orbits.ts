// Orbital mechanics (not in the classic game): every planet circles its star, so two planets in the
// same system drift closer together and further apart over time. Flights between them cost less time
// and fuel when the planets are aligned and more when they sit on opposite sides of the star.
//
// Orbit radius grows linearly with position (1 = closest to the star). Periods follow Kepler's third law
// (period ∝ radius^1.5), scaled so position 5 takes ORBIT_BASE_HOURS, and divided by the universe fleet
// speed. Each planet's starting angle comes from a hash of its coordinates, so everyone sees the same sky.

export interface OrbitUniverse { fleetSpeed: number }
export interface OrbitCoords { g: number; s: number; p: number }

const HOUR = 3_600_000;
const TAU = Math.PI * 2;
export const ORBIT_BASE_HOURS = 6;
/** Distance units per orbit-radius unit; in-system distance = 1000 + scale × separation. */
export const ORBIT_DISTANCE_SCALE = 60;
export const MAX_ORBIT_POSITION = 15;

export const orbitRadius = (p: number) => p;
export const orbitPeriod = (p: number, U: OrbitUniverse) => (ORBIT_BASE_HOURS * HOUR * Math.pow(p / 5, 1.5)) / U.fleetSpeed;

/** Deterministic starting angle in [0, 2π) for a position. */
export function orbitPhase(g: number, s: number, p: number) {
  let h = (g * 73856093) ^ (s * 19349663) ^ (p * 83492791);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * TAU;
}

export const orbitAngle = (c: OrbitCoords, t: number, U: OrbitUniverse) =>
  (orbitPhase(c.g, c.s, c.p) + (TAU * (t % orbitPeriod(c.p, U))) / orbitPeriod(c.p, U)) % TAU;

export function orbitXY(c: OrbitCoords, t: number, U: OrbitUniverse): [number, number] {
  const a = orbitAngle(c, t, U), r = orbitRadius(c.p);
  return [r * Math.cos(a), r * Math.sin(a)];
}

/** Straight-line separation in orbit-radius units. */
export function orbitSeparation(a: OrbitCoords, b: OrbitCoords, t: number, U: OrbitUniverse) {
  const [x1, y1] = orbitXY(a, t, U), [x2, y2] = orbitXY(b, t, U);
  return Math.hypot(x1 - x2, y1 - y2);
}

/** Missile flight time (ms). Inside a system it scales with the orbital distance: 30 s per 1,000 units,
 *  so about 32 s when lined up and up to about 82 s from the far side of the star. Between systems it is
 *  the classic 30 s plus 60 s per system. Divided by the universe fleet speed. */
export function missileFlightTime(from: OrbitCoords, to: OrbitCoords, t: number, U: OrbitUniverse) {
  const sec = from.s === to.s && from.g === to.g
    ? (from.p === to.p ? 30 : (30 * orbitalDistance(from, to, t, U)) / 1000)
    : 30 + 60 * Math.abs(from.s - to.s);
  return Math.round((sec * 1000) / U.fleetSpeed);
}

/** In-system flight distance between two different positions at time t. */
export const orbitalDistance = (a: OrbitCoords, b: OrbitCoords, t: number, U: OrbitUniverse) =>
  Math.round(1000 + ORBIT_DISTANCE_SCALE * orbitSeparation(a, b, t, U));

/** Shortest and longest in-system distance two positions can ever have. */
export const orbitalRange = (pa: number, pb: number) => ({
  min: Math.round(1000 + ORBIT_DISTANCE_SCALE * Math.abs(orbitRadius(pa) - orbitRadius(pb))),
  max: Math.round(1000 + ORBIT_DISTANCE_SCALE * (orbitRadius(pa) + orbitRadius(pb))),
});

/** When the two planets are next closest (within one synodic period), and how close they get. */
export function closestApproach(a: OrbitCoords, b: OrbitCoords, t: number, U: OrbitUniverse) {
  if (a.p === b.p) return { at: t, distance: orbitalDistance(a, b, t, U) };
  const pa = orbitPeriod(a.p, U), pb = orbitPeriod(b.p, U);
  const synodic = 1 / Math.abs(1 / pa - 1 / pb);
  const steps = 360;
  let best = t, bestD = Infinity;
  for (let i = 0; i <= steps; i++) {
    const tt = t + (synodic * i) / steps, d = orbitSeparation(a, b, tt, U);
    if (d < bestD) { bestD = d; best = tt; }
  }
  // Refine around the best sample.
  let lo = Math.max(t, best - synodic / steps), hi = best + synodic / steps;
  for (let i = 0; i < 40; i++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (orbitSeparation(a, b, m1, U) < orbitSeparation(a, b, m2, U)) hi = m2; else lo = m1;
  }
  const at = (lo + hi) / 2;
  return { at, distance: orbitalDistance(a, b, at, U) };
}
