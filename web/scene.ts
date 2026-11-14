/* The colony picture: a landscape image for the planet's climate with a picture of each building, ship or defence
   placed on it once it exists. All artwork is plain image files in web/img (see web/img/README.md); nothing is drawn in code.
   With no landscape image the picture is left out and the tab shows only its list. */
export type SceneMode = 'resources' | 'facilities' | 'shipyard' | 'defence';
export const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const climateOf = (moon: boolean, temp: number) => (moon ? 'moon' : temp > 60 ? 'hot' : temp < 0 ? 'cold' : 'mild');

/** Image files by base name (file name without extension). */
export class Art {
  private by = new Map<string, string>();
  constructor(private dir = 'img/') {}
  set(files: string[]) { this.by.clear(); for (const f of files) { const m = /^([a-z0-9-]+)\.(png|webp|jpe?g|avif)$/i.exec(f); if (m) this.by.set(m[1].toLowerCase(), f); } }
  url(base: string) { const f = this.by.get(base); return f ? this.dir + f : null; }
}

/** Where each picture stands on the landscape: [centre x %, bottom y %, width %]. Lower on the picture is nearer and larger. */
type Slot = [number, number, number];
export const SLOTS: Record<SceneMode, Record<string, Slot>> = {
  resources: { cm: [33, 36, 13], sp: [52, 35, 15], fr: [70, 36, 13], mm: [14, 26, 18], ds: [87, 22, 16], ms: [28, 6, 14], cs: [47, 4, 14], dt: [66, 6, 14] },
  facilities: { sy: [42, 33, 20], lab: [67, 33, 15], ro: [17, 26, 17], si: [87, 24, 12], na: [31, 5, 15], tf: [60, 5, 15], lb: [50, 6, 22], ph: [78, 6, 15], jg: [12, 5, 17] },
  shipyard: {
    rip: [74, 56, 32], sat: [18, 72, 8],
    bs: [12, 32, 12], bc: [27, 33, 12], bo: [42, 34, 12], de: [57, 33, 13], col: [72, 32, 12], rec: [87, 31, 12],
    lf: [10, 6, 12], hf: [26, 5, 13], cr: [42, 4, 14], sc: [58, 5, 13], lc: [74, 6, 14], pr: [90, 8, 9],
  },
  defence: {
    gc: [14, 32, 12], pt: [32, 33, 13], sd: [50, 34, 16], ld: [69, 33, 18], ipm: [88, 31, 9],
    rl: [10, 6, 12], ll: [28, 5, 12], hl: [46, 4, 13], ic: [64, 5, 13], abm: [82, 6, 10],
  },
};

export interface SceneItem { id: string; name: string; n: number; building: boolean }
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** HTML for the picture, or '' when there is no landscape image for this climate. */
export function sceneH(o: { mode: SceneMode; moon: boolean; temp: number; planet: string; items: SceneItem[]; art: Art; units: boolean }) {
  const bg = o.art.url('bg-' + climateOf(o.moon, o.temp)); if (!bg) return '';
  const slots = SLOTS[o.mode];
  const sprites = o.items.map(it => {
    const s = slots[it.id], src = o.art.url(slug(it.name)); if (!s || !src || !(it.n > 0 || it.building)) return '';
    const chip = it.n > 0 ? (o.units ? '×' + it.n.toLocaleString('en-US') : 'Lv ' + it.n) : 'Building';
    return `<button type="button" class="spr${it.n > 0 ? '' : ' rising'}${s[1] > 50 ? ' sky' : ''}" data-act="jump" data-id="${it.id}" style="left:${s[0]}%;bottom:${s[1]}%;width:${s[2]}%;z-index:${100 - Math.round(s[1])}" title="${esc(it.name)}"><img src="${src}" alt="${esc(it.name)}" draggable="false"><span class="chip">${chip}</span></button>`;
  }).join('');
  return `<div class="scene" style="background-image:url('${bg}')" role="group" aria-label="${esc(o.planet)}">${sprites}</div>`;
}
