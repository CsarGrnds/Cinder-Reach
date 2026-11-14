// Tech tree: pick any building, research item, ship or defence and see its full requirement chain,
// what is already met for the current planet, and what it unlocks next. Pure view code (no I/O),
// shared by the real client and the browser demo.

type Defs = Record<string, { n: string; req?: Record<string, number>; def?: 1; mo?: 1 }>;
export interface TreeCtx {
  BLD: Defs; TECH: Defs; UN: Defs;
  ART: Record<string, string>; UNIT_ART: Record<string, string>; TECH_ART: Record<string, string>;
  b: Record<string, number>; u: Record<string, number>; tech: Record<string, number>; moon: boolean;
}
export const treeUI = { cat: 'research', sel: 'as' };
export const TREE_CATS: [string, string][] = [['buildings', 'Buildings'], ['research', 'Research'], ['ships', 'Ships'], ['defence', 'Defence']];

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[ch]);

export function treeView(c: TreeCtx): string {
  const kind = (id: string) => (id in c.BLD ? 'b' : id in c.TECH ? 't' : 'u');
  const def = (id: string) => c.BLD[id] ?? c.TECH[id] ?? c.UN[id];
  const req = (id: string) => def(id)?.req ?? {};
  const have = (id: string) => (kind(id) === 'b' ? c.b[id] ?? 0 : kind(id) === 't' ? c.tech[id] ?? 0 : c.u[id] ?? 0);
  const missingDirect = (id: string) => Object.entries(req(id)).filter(([k, n]) => have(k) < n);
  const ready = (id: string) => missingDirect(id).length === 0;
  const catOf = (id: string) => (kind(id) === 'b' ? 'buildings' : kind(id) === 't' ? 'research' : c.UN[id].def ? 'defence' : 'ships');
  const tabOf = (id: string) => {
    const k = kind(id);
    if (k === 't') return 'research';
    if (k === 'u') return c.UN[id].def ? 'defence' : 'shipyard';
    return ['mm', 'cm', 'ds', 'sp', 'fr', 'ms', 'cs', 'dt'].includes(id) ? 'resources' : 'facilities';
  };
  const icon = (id: string) => {
    const k = kind(id);
    const inner = k === 'b' ? c.ART[id] : k === 't' ? c.TECH_ART[id] : c.UNIT_ART[id];
    const ground = (k === 'b' && id !== 'na') || (k === 'u' && c.UN[id].def && id !== 'sd' && id !== 'ld');
    return `<svg class="mini" viewBox="0 0 64 64" aria-hidden="true"><rect x="1" y="1" width="62" height="62" rx="6" fill="var(--void)" stroke="var(--line)"/>${ground ? '<path d="M8 50h48" fill="none" stroke="var(--line)" stroke-width="1.5"/>' : ''}<g fill="none" stroke="var(--ink)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${inner ?? ''}</g></svg>`;
  };
  const haveText = (id: string) => (kind(id) === 'u' ? `${have(id).toLocaleString('en-US')} built` : `level ${have(id)}`);
  const ids = (cat: string) =>
    cat === 'buildings' ? Object.keys(c.BLD) : cat === 'research' ? Object.keys(c.TECH)
      : Object.keys(c.UN).filter(k => (cat === 'defence') === !!c.UN[k].def);

  if (!def(treeUI.sel)) treeUI.sel = 'as';
  const sel = treeUI.sel;

  // Left: pick an item.
  const pills = (id: string) => {
    if (kind(id) !== 'u' && have(id) > 0) return `<span class="tpill have">Lv ${have(id)}</span>`;
    if (kind(id) === 'u' && have(id) > 0) return `<span class="tpill have">${have(id).toLocaleString('en-US')}</span>`;
    const miss = missingDirect(id).length;
    return miss ? `<span class="tpill no">${miss} missing</span>` : '<span class="tpill ok">Ready</span>';
  };
  const list = `<div class="chips" role="tablist">${TREE_CATS.map(([k, l]) => `<button class="sm" data-act="treeCat" data-id="${k}" aria-pressed="${treeUI.cat === k}">${l}</button>`).join('')}</div>
    <ul class="tlist">${ids(treeUI.cat).map(id => `<li><button class="titem ${id === sel ? 'sel' : ''}" data-act="treeSel" data-id="${id}">${icon(id)}<span class="tname">${esc(def(id).n)}${def(id).mo ? ' <span class="dim">moon</span>' : ''}</span>${pills(id)}</button></li>`).join('')}</ul>`;

  // Right: the full chain under the selected item.
  const node = (id: string, need: number, path: string[]): string => {
    const ok = have(id) >= need, kids = Object.entries(req(id));
    const loop = path.includes(id);
    return `<li><button class="tnode ${ok ? 'ok' : 'no'}" data-act="treeSel" data-id="${id}">${icon(id)}<span class="tname">${esc(def(id).n)}</span>
      <span class="tlv">needs ${need} · you have ${have(id)}</span><span class="tick" aria-label="${ok ? 'met' : 'missing'}">${ok ? '✓' : '✗'}</span></button>
      ${kids.length && !loop ? `<ul>${kids.map(([k, n]) => node(k, n, [...path, id])).join('')}</ul>` : ''}</li>`;
  };
  // Everything still missing anywhere in the chain, deduplicated with the highest level needed.
  const todo = new Map<string, number>();
  const walk = (id: string, seen: Set<string>) => {
    for (const [k, n] of Object.entries(req(id))) {
      if (have(k) < n) todo.set(k, Math.max(todo.get(k) ?? 0, n));
      if (!seen.has(k)) { seen.add(k); walk(k, seen); }
    }
  };
  walk(sel, new Set());
  const unlocks = [...Object.keys(c.BLD), ...Object.keys(c.TECH), ...Object.keys(c.UN)].filter(k => req(k)[sel] != null);
  const kids = Object.entries(req(sel));
  const head = `<div class="thead">${icon(sel)}<div><h3>${esc(def(sel).n)}</h3><p class="dim">${kind(sel) === 'u' ? haveText(sel) + ' here' : `You have level ${have(sel)}`} · ${ready(sel) ? '<span class="okc">ready to build</span>' : `<span class="badc">${missingDirect(sel).length} requirement${missingDirect(sel).length === 1 ? '' : 's'} missing</span>`}</p></div>
    <button class="go" data-act="tab" data-id="${tabOf(sel)}">Open in ${tabOf(sel)[0].toUpperCase() + tabOf(sel).slice(1)}</button></div>`;
  const tree = kids.length
    ? `<ul class="tree">${kids.map(([k, n]) => node(k, n, [sel])).join('')}</ul>`
    : '<p class="dim">No requirements. You can build this as soon as you can afford it.</p>';
  const todoList = todo.size
    ? `<h4>Still to do</h4><ol class="todo">${[...todo].sort((a, b) => depth(a[0]) - depth(b[0])).map(([k, n]) => `<li><button class="link" data-act="treeSel" data-id="${k}">${esc(def(k).n)}</button> to level ${n} <span class="dim">(now ${have(k)})</span></li>`).join('')}</ol>`
    : '';
  function depth(id: string): number { const r = Object.keys(req(id)); return r.length ? 1 + Math.max(...r.map(depth)) : 0; }
  const unl = unlocks.length
    ? `<h4>Unlocks</h4><div class="tunlocks">${unlocks.map(k => `<button class="tnode ${have(sel) >= req(k)[sel] ? 'ok' : 'no'}" data-act="treeSel" data-id="${k}">${icon(k)}<span class="tname">${esc(def(k).n)}</span><span class="tlv">at level ${req(k)[sel]}</span></button>`).join('')}</div>`
    : '';
  if (catOf(sel) !== treeUI.cat && !ids(treeUI.cat).includes(sel)) { /* keep the list where the player left it */ }
  return `<div class="cols tree-cols"><div class="panel"><h2>Tech tree</h2>${list}</div>
    <div class="panel">${head}<h4>Requirements</h4>${tree}${todoList}${unl}
    <p class="dim" style="margin-top:12px;font-size:13px">Building levels are for ${c.moon ? 'this moon' : 'this planet'}; research counts everywhere. Select any item to follow its chain.</p></div></div>`;
}

export const TREE_CSS = `
.tree-cols{grid-template-columns:minmax(0,340px) minmax(0,1fr)}
@media (max-width:760px){.tree-cols{grid-template-columns:minmax(0,1fr)}}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.chips button[aria-pressed=true]{border-color:var(--amber);color:var(--amber)}
.tlist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px;max-height:70vh;overflow:auto}
.titem,.tnode{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:none;border:1px solid transparent;border-radius:6px;padding:4px 8px 4px 4px;color:var(--ink);font:14px var(--body)}
.titem:hover,.tnode:hover{border-color:var(--amber)}
.titem.sel{border-color:var(--amber);background:var(--hull-2)}
.tname{flex:1;min-width:0}
svg.mini{width:34px;height:34px;flex:none}
.tpill{font:12px var(--mono);border-radius:10px;padding:1px 8px;border:1px solid var(--line);white-space:nowrap}
.tpill.have{color:var(--amber)}.tpill.ok{color:var(--ok);border-color:var(--ok)}.tpill.no{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 60%,var(--line))}
.thead{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:6px}
.thead svg.mini{width:56px;height:56px}
.thead>div{flex:1;min-width:180px}
.panel h4{font:600 12px var(--display);letter-spacing:.1em;text-transform:uppercase;color:var(--dim);margin:16px 0 6px}
.tree,.tree ul{list-style:none;margin:0;padding:0}
.tree ul{padding-left:22px;margin-left:16px;border-left:1px dashed var(--line)}
.tnode{border-color:var(--line);margin:4px 0}
.tnode.ok{border-color:color-mix(in srgb,var(--ok) 45%,var(--line))}
.tnode.no{border-color:color-mix(in srgb,var(--bad) 55%,var(--line))}
.tlv{font:12px var(--mono);color:var(--dim);white-space:nowrap}
.tick{font-weight:700;width:1.2em;text-align:center}
.tnode.ok .tick{color:var(--ok)}.tnode.no .tick{color:var(--bad)}
.tunlocks{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:4px 10px}
.todo{margin:0;padding-left:22px;display:flex;flex-direction:column;gap:4px;font-size:14px}
button.link{background:none;border:0;padding:0;color:var(--amber);text-decoration:underline;font:inherit;cursor:pointer}
`;
