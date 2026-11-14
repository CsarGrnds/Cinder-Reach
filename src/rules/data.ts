// Static game data: buildings, research, ships, defence, rapid fire and position tables.
// Costs are [metal, crystal, deuterium] at level 0; `f` is the per-level cost factor.

export type Res = [number, number, number];
export type Req = Record<string, number>;

export interface BuildingDef {
  n: string; c: Res; f: number; g: 'r' | 'f';
  e?: number;        // energy output required (Terraformer)
  m?: 1;             // can be built on a moon
  mo?: 1;            // moon only
  req?: Req;
}
export interface TechDef { n: string; d: string; c: Res; f?: number; e?: number; req?: Req }
export interface UnitDef {
  n: string; c: Res; s: number; a: number;
  cap?: number; v?: number; fu?: number; dr?: 'cd' | 'id' | 'hd';
  def?: 1; stay?: 1; max?: 1; miss?: number; d?: string; req: Req;
}

export const BLD: Record<string, BuildingDef> = {
  mm: { n: 'Metal Mine', c: [60, 15, 0], f: 1.5, g: 'r' },
  cm: { n: 'Crystal Mine', c: [48, 24, 0], f: 1.6, g: 'r' },
  ds: { n: 'Deuterium Synthesizer', c: [225, 75, 0], f: 1.5, g: 'r' },
  sp: { n: 'Solar Plant', c: [75, 30, 0], f: 1.5, g: 'r' },
  fr: { n: 'Fusion Reactor', c: [900, 360, 180], f: 1.8, g: 'r', req: { ds: 5, en: 3 } },
  ms: { n: 'Metal Storage', c: [1000, 0, 0], f: 2, g: 'r', m: 1 },
  cs: { n: 'Crystal Storage', c: [1000, 500, 0], f: 2, g: 'r', m: 1 },
  dt: { n: 'Deuterium Tank', c: [1000, 1000, 0], f: 2, g: 'r', m: 1 },
  ro: { n: 'Robotics Factory', c: [400, 120, 200], f: 2, g: 'f', m: 1 },
  sy: { n: 'Shipyard', c: [400, 200, 100], f: 2, g: 'f', m: 1, req: { ro: 2 } },
  lab: { n: 'Research Lab', c: [200, 400, 200], f: 2, g: 'f' },
  si: { n: 'Missile Silo', c: [20000, 20000, 1000], f: 2, g: 'f', req: { sy: 1 } },
  na: { n: 'Nanite Factory', c: [1e6, 5e5, 1e5], f: 2, g: 'f', req: { ro: 10, co: 10 } },
  tf: { n: 'Terraformer', c: [0, 50000, 100000], e: 1000, f: 2, g: 'f', req: { na: 1, en: 12 } },
  lb: { n: 'Lunar Base', c: [20000, 40000, 20000], f: 2, g: 'f', m: 1, mo: 1 },
  ph: { n: 'Sensor Phalanx', c: [20000, 40000, 20000], f: 2, g: 'f', m: 1, mo: 1, req: { lb: 1 } },
  jg: { n: 'Jump Gate', c: [2e6, 4e6, 2e6], f: 2, g: 'f', m: 1, mo: 1, req: { lb: 1, hy: 7 } },
};

export const TECH: Record<string, TechDef> = {
  en: { n: 'Energy Technology', d: 'Prerequisite for most research; boosts fusion output.', c: [0, 800, 400], req: { lab: 1 } },
  la: { n: 'Laser Technology', d: 'Unlocks laser defences.', c: [200, 100, 0], req: { lab: 1, en: 2 } },
  io: { n: 'Ion Technology', d: 'Unlocks cruisers and ion cannons.', c: [1000, 300, 100], req: { lab: 4, la: 5, en: 4 } },
  hy: { n: 'Hyperspace Technology', d: 'Prerequisite for the hyperspace drive, capital ships and jump gates.', c: [0, 4000, 2000], req: { lab: 7, en: 5, sh: 5 } },
  pl: { n: 'Plasma Technology', d: 'Unlocks bombers and plasma turrets; +1% metal, +0.66% crystal, +0.33% deuterium per level.', c: [2000, 4000, 1000], req: { lab: 4, en: 8, la: 10, io: 5 } },
  cd: { n: 'Combustion Drive', d: '+10% speed per level for cargo ships, light fighters, recyclers and probes.', c: [400, 0, 600], req: { lab: 1, en: 1 } },
  id: { n: 'Impulse Drive', d: '+20% speed per level for heavy fighters, cruisers, colony ships and bombers. Missile range is 5 systems per level minus 1.', c: [2000, 4000, 600], req: { lab: 2, en: 1 } },
  hd: { n: 'Hyperspace Drive', d: '+30% speed per level for battleships, battlecruisers, destroyers and deathstars.', c: [10000, 20000, 6000], req: { lab: 7, hy: 3 } },
  es: { n: 'Espionage Technology', d: 'Probes reveal more of a target the further you lead its owner, and are harder to catch.', c: [200, 1000, 200], req: { lab: 3 } },
  co: { n: 'Computer Technology', d: '+1 fleet slot per level.', c: [0, 400, 600], req: { lab: 1 } },
  as: { n: 'Astrophysics', d: 'Every second level allows one more colony. Levels 4, 6 and 8 open positions 3/13, 2/14 and 1/15. Expedition slots equal the square root of the level.', c: [4000, 8000, 4000], f: 1.75, req: { lab: 3, es: 4, id: 3 } },
  irn: { n: 'Intergalactic Research Network', d: 'Each level links one more of your labs; their levels add up for research speed.', c: [240000, 400000, 160000], req: { lab: 10, co: 8, hy: 8 } },
  gr: { n: 'Graviton Technology', d: 'Needs a one-off energy output instead of resources and completes instantly. Unlocks the Deathstar.', c: [0, 0, 0], e: 300000, f: 3, req: { lab: 12 } },
  we: { n: 'Weapons Technology', d: '+10% attack per level.', c: [800, 200, 0], req: { lab: 4 } },
  sh: { n: 'Shielding Technology', d: '+10% shields per level.', c: [200, 600, 0], req: { lab: 6, en: 3 } },
  ar: { n: 'Armour Technology', d: '+10% hull per level.', c: [1000, 0, 0], req: { lab: 2 } },
};

export const UN: Record<string, UnitDef> = {
  sc: { n: 'Small Cargo', c: [2000, 2000, 0], s: 10, a: 5, cap: 5000, v: 5000, fu: 10, dr: 'cd', req: { sy: 2, cd: 2 } },
  lc: { n: 'Large Cargo', c: [6000, 6000, 0], s: 25, a: 5, cap: 25000, v: 7500, fu: 50, dr: 'cd', req: { sy: 4, cd: 6 } },
  lf: { n: 'Light Fighter', c: [3000, 1000, 0], s: 10, a: 50, cap: 50, v: 12500, fu: 20, dr: 'cd', req: { sy: 1, cd: 1 } },
  hf: { n: 'Heavy Fighter', c: [6000, 4000, 0], s: 25, a: 150, cap: 100, v: 10000, fu: 75, dr: 'id', req: { sy: 3, ar: 2, id: 2 } },
  cr: { n: 'Cruiser', c: [20000, 7000, 2000], s: 50, a: 400, cap: 800, v: 15000, fu: 300, dr: 'id', req: { sy: 5, id: 4, io: 2 } },
  bs: { n: 'Battleship', c: [45000, 15000, 0], s: 200, a: 1000, cap: 1500, v: 10000, fu: 500, dr: 'hd', req: { sy: 7, hd: 4 } },
  bc: { n: 'Battlecruiser', c: [30000, 40000, 15000], s: 400, a: 700, cap: 750, v: 10000, fu: 250, dr: 'hd', req: { sy: 8, hy: 5, hd: 5, la: 12 } },
  bo: { n: 'Bomber', c: [50000, 25000, 15000], s: 500, a: 1000, cap: 500, v: 4000, fu: 700, dr: 'id', req: { sy: 8, id: 6, pl: 5 } },
  de: { n: 'Destroyer', c: [60000, 50000, 15000], s: 500, a: 2000, cap: 2000, v: 5000, fu: 1000, dr: 'hd', req: { sy: 9, hd: 6, hy: 5 } },
  rip: { n: 'Deathstar', c: [5e6, 4e6, 1e6], s: 50000, a: 200000, cap: 1e6, v: 100, fu: 1, dr: 'hd', req: { sy: 12, hd: 7, hy: 6, gr: 1 } },
  col: { n: 'Colony Ship', c: [10000, 20000, 10000], s: 100, a: 50, cap: 7500, v: 2500, fu: 1000, dr: 'id', req: { sy: 4, id: 3 } },
  rec: { n: 'Recycler', c: [10000, 6000, 2000], s: 10, a: 1, cap: 20000, v: 2000, fu: 300, dr: 'cd', req: { sy: 4, cd: 6, sh: 2 } },
  pr: { n: 'Espionage Probe', c: [0, 1000, 0], s: 0, a: 0, cap: 0, v: 1e8, fu: 1, dr: 'cd', req: { sy: 3, cd: 3, es: 2 } },
  sat: { n: 'Solar Satellite', c: [0, 2000, 500], s: 1, a: 1, stay: 1, req: { sy: 1 } },
  rl: { n: 'Rocket Launcher', c: [2000, 0, 0], s: 20, a: 80, def: 1, req: { sy: 1 } },
  ll: { n: 'Light Laser', c: [1500, 500, 0], s: 25, a: 100, def: 1, req: { sy: 2, en: 1, la: 3 } },
  hl: { n: 'Heavy Laser', c: [6000, 2000, 0], s: 100, a: 250, def: 1, req: { sy: 4, en: 3, la: 6 } },
  gc: { n: 'Gauss Cannon', c: [20000, 15000, 2000], s: 200, a: 1100, def: 1, req: { sy: 6, en: 6, we: 3, sh: 1 } },
  ic: { n: 'Ion Cannon', c: [5000, 3000, 0], s: 500, a: 150, def: 1, req: { sy: 4, io: 4 } },
  pt: { n: 'Plasma Turret', c: [50000, 50000, 30000], s: 300, a: 3000, def: 1, req: { sy: 8, pl: 7 } },
  sd: { n: 'Small Shield Dome', c: [10000, 10000, 0], s: 2000, a: 1, def: 1, max: 1, req: { sy: 1, sh: 2 } },
  ld: { n: 'Large Shield Dome', c: [50000, 50000, 0], s: 10000, a: 1, def: 1, max: 1, req: { sy: 6, sh: 6 } },
  abm: { n: 'Anti-Ballistic Missile', c: [8000, 0, 2000], s: 1, a: 1, def: 1, miss: 1, d: 'Intercepts one incoming interplanetary missile. Uses 1 silo slot.', req: { si: 2 } },
  ipm: { n: 'Interplanetary Missile', c: [12500, 2500, 10000], s: 1, a: 12000, def: 1, miss: 2, d: 'Destroys defences on a planet in range: 12,000 damage plus 10% per Weapons level. Losses are not rebuilt. Uses 2 silo slots.', req: { si: 4, id: 1 } },
};

export const RF: Record<string, Record<string, number>> = {
  sc: { pr: 5, sat: 5 }, lc: { pr: 5, sat: 5 }, lf: { pr: 5, sat: 5 }, hf: { pr: 5, sat: 5, sc: 3 },
  cr: { pr: 5, sat: 5, lf: 6, rl: 10 }, bs: { pr: 5, sat: 5 }, col: { pr: 5, sat: 5 }, rec: { pr: 5, sat: 5 },
  bo: { pr: 5, sat: 5, rl: 20, ll: 20, hl: 10, ic: 10 },
  de: { pr: 5, sat: 5, ll: 10, bc: 2 },
  bc: { pr: 5, sat: 5, sc: 3, lc: 3, hf: 4, cr: 4, bs: 7 },
  rip: { pr: 1250, sat: 1250, sc: 250, lc: 250, lf: 200, hf: 100, cr: 33, bs: 30, col: 250, rec: 250, bo: 25, de: 5, bc: 15, rl: 200, ll: 200, hl: 100, gc: 50, ic: 100 },
};

export const SHIP_IDS = Object.keys(UN).filter(k => !UN[k].def && !UN[k].stay);
export const DEFENCE_ORDER = ['rl', 'll', 'hl', 'ic', 'gc', 'pt', 'sd', 'ld'];
export const RES_NAMES = ['Metal', 'Crystal', 'Deuterium'] as const;

export const MISSIONS = {
  attack: 'Attack', spy: 'Espionage', transport: 'Transport', deploy: 'Deployment',
  colonise: 'Colonisation', recycle: 'Harvest debris', expedition: 'Expedition', missile: 'Missile strike',
} as const;
export type Mission = keyof typeof MISSIONS;

// Planet tables by position 1..15 (index 0 = position 1).
export const POS_TEMP = [240, 190, 140, 90, 80, 70, 60, 50, 40, 30, 20, 10, -30, -70, -110];
export const POS_FIELDS_MIN = [95, 97, 98, 123, 148, 148, 141, 168, 161, 154, 146, 136, 109, 81, 65];
export const POS_FIELDS_AVG = [100, 103, 118, 164, 179, 194, 193, 210, 197, 188, 176, 154, 115, 86, 69];
export const POS_FIELDS_MAX = [108, 110, 140, 203, 222, 230, 240, 251, 238, 224, 204, 188, 121, 93, 74];
export const POS_BONUS_METAL: Record<number, number> = { 6: 0.17, 7: 0.23, 8: 0.35, 9: 0.23, 10: 0.17 };
export const POS_BONUS_CRYSTAL: Record<number, number> = { 1: 0.4, 2: 0.3, 3: 0.2 };
export const HOME_FIELDS = 163;
export const EXPEDITION_POSITION = 16;
