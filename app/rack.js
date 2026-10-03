/* ---------- rack.js — the rack elevation ----------
   A front view of each rack, top to bottom the way Synergy builds them:
   patch panels for the Cat6 home runs, network (gateway, LAN and AV
   switches), control and processing, sources (small boxes on shelves),
   receivers and amps low with a vent panel under each, the WattBox at the
   bottom. Heights come from the catalog (`rackUnits`); a box the catalog
   can't size is drawn as 1U and listed so someone measures it. A vertical
   power strip (`mount: "vertical"`) rides the rear rails and takes no space.
   Pure: advise() attaches it (advise().racks), the Rack Elevation page draws it. */

import { wireRuns } from "./pages.js";
import { companionRef, specFor } from "./network.js";
import { deviceKind } from "./kinds.js";
import { rackOption, fitRacks, cabinetNeeds, belowMinimum, estimateHeight, RACK_CLEARANCE } from "./racksizes.js";

export const DEFAULT_RACK_U = 42;
// Auto racks (Ryan 2026-10-02): past this height a rack becomes two side by side (job.job.autoRackMax)
export const AUTO_RACK_MAX = 42;
export const RACK_SIZES = [12, 16, 20, 24, 27, 32, 36, 38, 40, 42, 44, 45];
const SHELF_U = 2, PER_SHELF = 3, PATCH_PORTS = 24;

const TIER = { gateway: 0.5, networkSwitch: 1, avSwitch: 1, avbSwitch: 1,
  controlBox: 2, host: 2, videoMatrix: 2, danteBridge: 2, downmixer: 2, audioInputModule: 2, audioOutputModule: 2, splitter: 2,
  source: 3, avr: 4, amp: 4, power: 5 };

/* spacing (Ryan 2026-10-02, Synergy practice). Two strengths:
   - always: a receiver or amp (sub amps too) has 1U of vent above and below; anything else that runs
     warm — a matrix switcher, a Savant host, a shelf of sources (Apple TV, DirecTV, cable boxes), an MXNet
     encoder kit, a box source like a Kaleidescape — has 1U after it; a brush plate sits under the patch panels and between
     the router and the switches so the cables come out cleanly (it breathes too, so it stands in for a vent);
   - when there's room: 1U between the other boxes too — routers and switches are what stack when a rack
     has to be squeezed, so those spaces are the first given up.
   The room left after that goes to the space above each receiver / amp (2U, top down). One gap holds one
   spacer; the floor below the last box needs none. */
const HOT = new Set(["avr", "amp"]);
const WARM = new Set(["videoMatrix", "host", "source"]);
const SWITCHES = new Set(["networkSwitch", "avSwitch", "avbSwitch"]);
function spaceRack(items, size, tight = false) {
  const type = i => i.kind === "device" ? i.type : null;
  const warm = i => WARM.has(type(i)) || i.kind === "shelf";   // a shelf of boxes and an MXNet encoder kit run warm (Ryan 2026-10-02)
  const gaps = [];                                       // gaps[k] = the spacer above items[k] (or null)
  items.forEach((b, k) => {
    const a = k ? items[k - 1] : null;
    if (!a || a.kind === "patch" && b.kind === "patch") { gaps.push(null); return; }
    const ta = type(a), tb = type(b);
    // low heat (Savant AIM / AOM modules, Ryan 2026-10-02): nothing needed after it — they stack
    if (a.lowHeat && !HOT.has(tb)) { gaps.push(null); return; }
    // squeezed (a rack the space limits): only the vents round receivers / amps stay
    if (tight) { gaps.push(HOT.has(ta) || HOT.has(tb) ? { kind: "vent", tier: HOT.has(tb) ? b.tier : a.tier, u: 1, label: "Vent panel", need: true } : null); return; }
    if (a.kind === "patch" || (ta === "gateway" && SWITCHES.has(tb)) || (tb === "gateway" && SWITCHES.has(ta)))
      gaps.push({ kind: "brush", tier: b.tier, u: 1, label: "Brush plate", need: true });
    else if (HOT.has(ta) || HOT.has(tb) || warm(a))
      gaps.push({ kind: "vent", tier: HOT.has(tb) ? b.tier : a.tier, u: 1, label: "Vent panel", need: true, above: HOT.has(tb) });
    else gaps.push({ kind: "vent", tier: a.tier, u: 1, label: "Vent panel", need: false });
  });
  let spare = size - items.reduce((n, i) => n + i.u, 0) - gaps.filter(g => g?.need).length;
  for (const g of gaps) if (g && !g.need) { if (spare > 0) spare--; else gaps[gaps.indexOf(g)] = null; }   // nice-to-have spaces, top down, while they fit
  for (const g of gaps) if (g?.above && spare > 0) { g.u = 2; spare--; }                                   // then 2U over the receivers / amps
  const out = [];
  items.forEach((b, k) => { const g = gaps[k]; if (g) { delete g.need; delete g.above; out.push(g); } out.push(b); });
  items.splice(0, items.length, ...out);
}

// a stable handle for each box on the rack page: a device by its id, a shelf by its first box,
// a rack kit and a patch panel by their place among their kind
function keyItems(items) {
  const seen = {};
  for (const i of items) {
    if (i.kind === "device") i.key = i.id;
    else if (i.kind === "shelf" && !i.kit) i.key = i.memberIds?.length ? `shelf:${i.memberIds[0]}` : `shelf:${seen.shelf = (seen.shelf || 0) + 1}`;
    else if (i.kit) i.key = `kit:${i.kit}:${seen[i.kit] = (seen[i.kit] || 0) + 1}`;
    else if (i.kind === "patch") i.key = `patch:${seen.patch = (seen.patch || 0) + 1}`;
  }
}
// the build-order stack: gear dresses the top; receivers, amps and power sit on the floor
// (only when it all fits — an over-full rack just stacks in order)
function autoRows(items, size) {
  const used = items.reduce((n, i) => n + i.u, 0);
  const low = used > size ? [] : items.filter(i => i.tier >= 4);
  let row = 0;
  for (const it of items) {
    if (it === low[0]) row = size - low.reduce((n, i) => n + i.u, 0);
    it.row = row; row += it.u;
  }
}
/* the rack as arranged by hand: each box at its saved row (rows from the top); a box with no saved
   row (added since) takes the first free space — from the floor up for receivers / amps / power,
   from the top down for the rest. Then the spacers fill each gap the way spaceRack would (brush plate
   under the patch panels and the router, vents round hot and warm gear; a short gap is all vent),
   and a rule the arrangement breaks comes back as a warning instead of being forced. */
function manualRows(items, size, layout) {
  const real = items.filter(i => i.key);
  for (const it of real) { delete it.side; }
  // a row holds one full-width box, or two half-width boxes side by side (Ryan 2026-10-02: a half-width
  // box dropped into the empty half of a row pairs up there)
  const taken = new Map();
  const fits = (it, row) => { if (row < 0) return null; let mate = null;
    for (let k = row; k < row + it.u; k++) { const t = taken.get(k); if (!t) continue;
      if (it.half && t !== "full" && t.half && !t.mate && t.u === it.u && t.row === row && (!mate || mate === t)) { mate = t; continue; }
      return null; }
    return { mate }; };
  const take = (it, row, mate) => { it.row = row;
    if (mate) { mate.mate = it; it.mate = mate; mate.side = "L"; it.side = "R"; return; }
    for (let k = row; k < row + it.u; k++) taken.set(k, it.half ? it : "full"); };
  const pinned = real.filter(i => Number.isInteger(layout[i.key])).sort((a, b) => layout[a.key] - layout[b.key]);
  for (const it of pinned) { const f = fits(it, layout[it.key]); if (f) take(it, layout[it.key], f.mate); else it.row = null; }
  for (const it of real.filter(i => i.row == null)) {
    let row = -1, mate = null;
    const tryRow = r => { const f = fits(it, r); if (f) { row = r; mate = f.mate; } };
    if (it.tier >= 4) { for (let r = size - it.u; r >= 0 && row < 0; r--) tryRow(r); }
    else for (let r = 0; r + it.u <= size && row < 0; r++) tryRow(r);
    if (row < 0) { row = size; while (!fits(it, row)) row++; mate = fits(it, row).mate; }   // no room: past the floor (shows over-full)
    take(it, row, mate);
  }
  for (const it of real) delete it.mate;
  // the spacers go between rows: the right half of a pair rides with its left
  const rowsOf = real.filter(i => i.side !== "R").sort((a, b) => a.row - b.row);
  const type = i => i.kind === "device" ? i.type : null;
  const warmish = i => WARM.has(type(i)) || i.kind === "shelf";
  const out = [], warnings = [], tucks = [];
  const spacer = (kind, row, u) => ({ kind, tier: 0, u, row, label: kind === "brush" ? "Brush plate" : "Vent panel" });
  rowsOf.forEach((b, k) => {
    const a = rowsOf[k - 1];
    if (a) {
      let r0 = a.row + a.u, gap = b.row - r0;
      const ta = type(a), tb = type(b);
      const brush = a.kind === "patch" && b.kind !== "patch" || (ta === "gateway" && SWITCHES.has(tb)) || (tb === "gateway" && SWITCHES.has(ta));
      const below = HOT.has(ta) || warmish(a), above = HOT.has(tb);
      if (gap <= 0) {
        // a low-heat box tucked into an amp's vent space is fine — said, not flagged (Ryan 2026-10-02)
        if (HOT.has(ta) && b.lowHeat) tucks.push(`${b.label} is tucked into the vent space under ${a.label} — low heat, fine`);
        else if (HOT.has(ta)) warnings.push(`${a.label}: no vent below it`);
        else if (warmish(a)) warnings.push(`${a.label}: no space after it — it runs warm`);
        if (above && a.lowHeat) tucks.push(`${a.label} is tucked into the vent space above ${b.label} — low heat, fine`);
        else if (above) warnings.push(`${b.label}: no vent above it`);
      } else {
        if (brush) { out.push(spacer("brush", r0, 1)); r0++; gap--; }
        if (gap > 0 && gap <= 4) { while (gap > 0) { const u = gap >= 2 ? 2 : 1; out.push(spacer("vent", r0, u)); r0 += u; gap -= u; } }
        else if (gap > 4) {   // a big open stretch: vent next to the gear that needs it, open space between
          if (below) { out.push(spacer("vent", r0, 1)); }
          if (above) { out.push(spacer("vent", b.row - 2, 2)); }
        }
      }
    }
    out.push(b);
  });
  out.push(...real.filter(i => i.side === "R"));
  items.splice(0, items.length, ...out.sort((x, y) => x.row - y.row || (x.side === "R") - (y.side === "R")));
  return { warnings, tucks };
}
// the rows a rack's items take: a half-width pair shares one
export const rowsUsed = items => items.reduce((n, i) => n + (i.side === "R" ? 0 : i.u), 0);
// what the gear needs with every spacer it would like (not the extra 2U over an amp) — Auto sizes to this
function fullNeed(items) {
  const copy = items.filter(i => i.side !== "R").map(i => ({ ...i }));
  spaceRack(copy, 999, false);
  return rowsUsed(copy) - copy.filter(i => i.kind === "vent" && i.u === 2).length;
}

/* gear depth against the rack's usable depth (Ryan 2026-10-02): a box deeper than the rails allow
   doesn't go in; one that leaves under CABLE_IN" behind it has no room for its plugs and cables.
   Depths are the makers' published chassis depths (catalog depthIn, sourced). Only with a picked
   rack — a plain "42U" has no depth to check against. */
export const CABLE_IN = 3;
function depthCheck(items, model) {
  if (!model) return null;
  const devs = items.filter(i => i.kind === "device" && typeof i.depthIn === "number").sort((a, b) => b.depthIn - a.depthIn);
  return { usable: model.usable, deepest: devs[0] ? { label: devs[0].label, d: devs[0].depthIn } : null,
    over: devs.filter(i => i.depthIn > model.usable).map(i => ({ label: i.label, d: i.depthIn })),
    tight: devs.filter(i => i.depthIn <= model.usable && i.depthIn + CABLE_IN > model.usable).map(i => ({ label: i.label, d: i.depthIn, left: +(model.usable - i.depthIn).toFixed(1) })) };
}

export function rackPlans(job, ix, catalog) {
  const out = [];
  const cat = ref => ref ? catalog?.devices?.[ref] : null;
  for (const [si, s] of ix.solutions.entries()) {
    const sol = s.sol;
    const tenG = Object.values(s.devices).some(d => cat(d.catalogRef)?.gen === "10g");
    // Cat6 home runs land on patch panels in the rack they start from (a pool house rack
    // patches its own rooms; the run between two racks takes a port in each)
    let cat6runs = [];
    try { cat6runs = wireRuns(job, ix, { solution: si }).filter(r => /^Cat6/.test(r.cable)); } catch { cat6runs = []; }
    const main = sol.racks?.[0]?.id;
    (sol.racks || []).forEach((r, ri) => {
      // 1–60U: a typo'd 4200 would draw 4,200 rows and stall the page
      // three ways to size a rack (Ryan 2026-10-02): fit the space (the opening picks the tallest
      // Middle Atlantic / Strong rack that fits — or the one picked from those that fit), pick a rack
      // (a model, whatever the space), or by U (a plain count, no brand). Each mode keeps its own
      // inputs, so switching back and forth loses nothing.
      const space = r.space && (+r.space.h > 0 || +r.space.w > 0 || +r.space.d > 0) ? r.space : null;
      // (2026-10-02, second pass) three modes on the Rack tab: Locked to space ("space" — the tallest rack
      // that fits, pinned until unlocked; never grows), Auto ("auto" — sized to the gear, a standard height,
      // two side by side past AUTO_RACK_MAX) and Fixed U ("units"); "model" (a picked rack) stays readable
      const sizeMode = ["space", "auto", "model", "units"].includes(r.sizeMode) ? r.sizeMode : r.rackModel ? (space ? "space" : "model") : space ? "space" : "units";
      const casters = r.casters !== false;
      const fits = space ? fitRacks(space, undefined, casters) : null;
      const chosen = r.rackModel ? rackOption(r.rackModel) : null;
      // the deepest box (published depth) + room for cables: Fit the space prefers the tallest rack
      // that's also deep enough; only when none is, the tallest that fits at all
      const deepest = Math.max(0, ...(r.devices || []).map(d => specFor(d, catalog)?.depthIn).filter(v => typeof v === "number"));
      const deepEnough = o => !deepest || o.usable >= deepest + CABLE_IN;
      const fitPick = fits ? fits.find(deepEnough) || fits[0] || null : null;
      // locked: the rack picked for the space stays, even if something later says it no longer fits (that's a note)
      const model = sizeMode === "units" || sizeMode === "auto" ? null
        : sizeMode === "space" ? (r.locked && chosen ? chosen : chosen && fits?.some(o => o.part === chosen.part) ? chosen : fitPick) : chosen;
      let size = model ? model.u : Math.min(60, Math.max(1, Math.floor(+r.units || +job.job?.rackUnits || DEFAULT_RACK_U) || DEFAULT_RACK_U));
      const items = [], unknown = [], rear = [], small = [], cboxes = [], smallIds = [], cboxIds = [];
      const cat6 = cat6runs.filter(x => (x.racks?.length ? x.racks : [main]).includes(r.id)).reduce((n, x) => n + x.count, 0);
      if (cat6) for (let k = 0; k < Math.ceil(cat6 / PATCH_PORTS); k++)
        items.push({ kind: "patch", tier: 0, u: 1, label: `Cat6 patch panel ${PATCH_PORTS}-port${Math.ceil(cat6 / PATCH_PORTS) > 1 ? ` (${k + 1})` : ""}` });
      for (const d of r.devices || []) {
        const c = specFor(d, catalog);
        const name = `${d.model || d.id}${d.danteSwitch ? " (Dante)" : ""}`;
        if (c?.mount === "vertical") { rear.push(name); continue; }
        const u = typeof c?.rackUnits === "number" ? c.rackUnits : null;
        const tier = TIER[d.type] ?? 2;
        // an MXNet control box rides the platform's rack kit when there is one (placed below)
        if (u == null && d.type === "controlBox" && /CBOX/i.test(`${d.model || ""} ${c?.model || ""}`)) { cboxes.push(name); cboxIds.push(d.id); continue; }
        if (u == null && (d.type === "source" || c?.desktop)) { small.push(name); smallIds.push(d.id); continue; }
        // no height in the catalog, or one the catalog marks to confirm (Ryan 2026-10-01: Savant PAV
        // modules drawn 1U, flagged "need to confirm") — either way the elevation shows it and the advisor asks
        const confirm = u == null || !!c?.rackUnitsConfirm;
        if (confirm) unknown.push(name);
        items.push({ kind: "device", id: d.id, tier, u: u ?? 1, label: name, type: d.type, guess: confirm, half: !!c?.halfRack, lowHeat: !!c?.lowHeat, boxKind: deviceKind(d, c),
          ...(typeof c?.depthIn === "number" ? { depthIn: c.depthIn } : {}) });
      }
      // rack-side adapters (MXNet encoders/decoders on rack gear) go in AVPro's own rack
      // kits for their platform (catalog `rackKit: {gen, holds}`), picked for the fewest
      // rack units; with no kit in the catalog they ride shelves
      const byGen = {};
      for (const comp of Object.values(s.companions)) {
        const host = (r.devices || []).find(d => d.id === comp.serves);
        if (!host) continue;
        const ce = cat(companionRef(comp, tenG));
        const label = `${ce?.model || "Encoder"} (${host.model || host.id})`;
        const g = ce?.gen?.startsWith("1g") ? "1g" : ce?.gen || null;
        if (g) (byGen[g] ||= []).push({ label, model: ce?.model || "" }); else { small.push(label); smallIds.push(null); }
      }
      const kits = Object.entries(catalog?.devices || {}).filter(([, c]) => c.rackKit && typeof c.rackUnits === "number");
      for (const [g, members] of Object.entries(byGen)) {
        const fit = kits.filter(([, c]) => c.rackKit.gen === g).sort((x, y) => x[1].rackKit.holds - y[1].rackKit.holds);
        // an endpoint a kit won't take (AVPro: Dante encoders don't fit the 1G racks) rides a shelf
        const fits = m => fit.length && !fit.every(([, c]) => c.rackKit.excludes && m.model.toUpperCase().includes(c.rackKit.excludes));
        for (const m of members.filter(m => !fits(m))) { small.push(m.label); smallIds.push(null); }
        let rest = members.filter(fits).map(m => m.label);
        // a big MXNet system starts with the big kit (Ryan 2026-10-02: "start with an AC-MXNET-1G-R15") —
        // more than two R2s' worth of endpoints goes in the largest kit first (the control box rides in its own place)
        const biggest = [...fit].sort((x, y) => y[1].rackKit.holds - x[1].rackKit.holds)[0];
        if (biggest && rest.length > 4 && biggest[1].rackKit.holds > 4) {
          const k = biggest[1], take = rest.splice(0, k.rackKit.holds);
          items.push({ kind: "shelf", tier: 3, u: k.rackUnits, label: `${k.model} (${take.length}/${k.rackKit.holds}): ${take.join(", ")}`, members: take, kit: k.model, kitSpec: { holds: k.rackKit.holds, cbox: k.rackKit.cbox || null } });
        }
        while (rest.length) {
          // the kit that houses what's left in the fewest rack units (4 endpoints: two 1U R2s beat a 6U R15)
          const cost = ([, c]) => Math.ceil(rest.length / c.rackKit.holds) * c.rackUnits;
          const [, k] = [...fit].sort((x, y) => cost(x) - cost(y) || y[1].rackKit.holds - x[1].rackKit.holds)[0];
          const take = rest.splice(0, k.rackKit.holds);
          items.push({ kind: "shelf", tier: 3, u: k.rackUnits, label: `${k.model} (${take.length}/${k.rackKit.holds}): ${take.join(", ")}`, members: take, kit: k.model, kitSpec: { holds: k.rackKit.holds, cbox: k.rackKit.cbox || null } });
        }
      }
      // the control box goes in a kit already in the rack (AVPro: the R15 and 10G-HDRACK have a CBOX
      // place beyond their slots; the R2 takes it in a slot) — else it rides a shelf like before
      for (const [ci, cb] of cboxes.entries()) {
        const kitItems = items.filter(i => i.kitSpec);
        const extra = kitItems.find(i => i.kitSpec.cbox === "extra" && !i.cbox);
        const slot = kitItems.find(i => i.kitSpec.cbox === "slot" && i.members.length < i.kitSpec.holds);
        const home = extra || slot;
        if (!home) { small.push(cb); smallIds.push(cboxIds[ci]); continue; }
        home.members.push(cb); if (home === extra) home.cbox = cb;
        const n = home.members.length - (home.cbox ? 1 : 0);
        home.label = `${home.kit} (${n}/${home.kitSpec.holds}${home.cbox ? " + control box" : ""}): ${home.members.join(", ")}`;
      }
      for (let k = 0; k < small.length; k += PER_SHELF)
        items.push({ kind: "shelf", tier: 3, u: SHELF_U, label: `Shelf: ${small.slice(k, k + PER_SHELF).join(", ")}`, members: small.slice(k, k + PER_SHELF),
          memberIds: smallIds.slice(k, k + PER_SHELF).filter(Boolean) });
      items.sort((a, b) => a.tier - b.tier);   // stable by tier
      // half-width boxes pair up side by side — two items on one row (left / right), each still its own
      // box on the rack page, so one can be dragged away or into the empty half of another row
      for (let i = 0; i < items.length; i++) {
        const a = items[i];
        if (!a.half || a.side) continue;
        const b = items.find((x, k) => k > i && x.half && !x.side && x.u === a.u);
        if (b) { a.side = "L"; b.side = "R"; b.pairOf = a; }
      }
      keyItems(items);
      const need = fullNeed(items);
      // Auto: the smallest standard height that takes the gear with every spacer it would like
      const autoMax = Math.min(60, Math.max(8, Math.floor(+job.job?.autoRackMax) || AUTO_RACK_MAX));
      if (sizeMode === "auto") size = Math.min(autoMax, RACK_SIZES.find(n => n >= need) || need);
      // arranged by hand on the rack page (rack.layout = { key: row from the top }) — the gear goes
      // where it was put and the spacers fill in around it; otherwise the build-order stack
      const manual = r.layout && typeof r.layout === "object" && Object.keys(r.layout).length > 0;
      let tucks = [], spacing = [], autoTight = false;
      if (manual) ({ warnings: spacing, tucks } = manualRows(items, size, r.layout));
      else {
        // the right half of a pair rides with its left through the spacing and the stack
        const rights = items.filter(i => i.side === "R");
        const lay = tight => { const rows = items.filter(i => i.side !== "R").map(i => i); spaceRack(rows, size, tight); return rows; };
        let rows = lay(!!r.tight);
        // locked to the space: it never grows — squeeze first (only the vents round amps stay)
        if (sizeMode === "space" && !r.tight && rowsUsed(rows) > size) { rows = lay(true); autoTight = true; }
        autoRows(rows, size);
        for (const x of rights) { x.row = x.pairOf.row; delete x.pairOf; }
        items.splice(0, items.length, ...rows, ...rights);
        items.sort((x, y) => x.row - y.row || (x.side === "R") - (y.side === "R"));
      }
      for (const x of items) delete x.pairOf;
      const used = rowsUsed(items);
      const bottom = items.reduce((n, i) => Math.max(n, i.row + i.u), 0);
      // the rack hardware the elevation implies — part numbers come from the job
      // (RACK tab) or a kit's catalog entry; anything nobody has filled in is "?"
      const parts = job.job?.rackParts || {};
      const count = k => items.filter(i => i.kind === k && !i.kit).length;
      const hardware = [
        { key: "rack", item: `Equipment rack, ${size}U${model ? ` (${model.brand})` : ""}`, qty: 1, partNo: r.partNo || model?.part || parts.rack || null },
        { key: "patch", item: "Cat6 patch panel, 24-port, 1U", qty: count("patch"), partNo: parts.patch || null },
        { key: "vent", item: "Vent panel, 1U", qty: items.filter(i => i.kind === "vent" && i.u === 1).length, partNo: parts.vent || null },
        { key: "vent2", item: "Vent panel, 2U", qty: items.filter(i => i.kind === "vent" && i.u === 2).length, partNo: parts.vent2 || null },
        { key: "brush", item: "Brush plate, 1U", qty: count("brush"), partNo: parts.brush || null },
        { key: "shelf", item: "Rack shelf, 2U", qty: count("shelf"), partNo: parts.shelf || null },
      ];
      const kitQty = {};
      for (const i of items.filter(i => i.kit)) kitQty[i.kit] = (kitQty[i.kit] || 0) + 1;
      for (const [kit, qty] of Object.entries(kitQty)) hardware.push({ key: "kit", item: `MXNet rack kit, ${items.find(i => i.kit === kit).u}U`, qty, partNo: kit });
      out.push({ solution: sol.id, rack: r.id, name: r.name || "Equipment Rack", size, used, spare: size - used,
        over: Math.max(0, manual ? bottom - size : used - size), items, unknown, rear, cat6, manual, spacing,
        model, space, tight: !!r.tight || autoTight, autoTight, sizeMode, casters, locked: sizeMode === "space" && !!r.locked, need, autoMax, tucks,
        depth: depthCheck(items, model),
        cabinet: cabinetNeeds(model, undefined, casters), belowMin: space ? belowMinimum(space) : null,
        // the rack against the space it has to go in; the tallest that fits it. A size typed by hand
        // (Fixed U, no brand) is checked by how tall a rack that size stands (Ryan 2026-10-02: it wasn't)
        spaceFit: fits ? (model ? { ok: fits.some(o => o.part === model.part), best: fitPick, count: fits.length }
          : +space.h > 0 ? (() => { const e = estimateHeight(size, casters); return { ok: e.h + RACK_CLEARANCE.top <= +space.h, best: fitPick, count: fits.length, typed: true, est: e }; })()
          : null) : null,
        needDepth: deepest ? +(deepest + CABLE_IN).toFixed(1) : null,
        hardware: hardware.filter(h => h.qty > 0) });
    });
  }
  return out;
}

/* ---------- the rack page: drag a box to a row, in its rack or another (Ryan 2026-10-02) ----------
   `plans` = this solution's rack plans (advise().racks). The first move in a rack freezes the
   rest of that rack where it stands, so only what was dragged moves. Dropped onto a box the same
   height → the two swap; onto anything else → what was there makes room (it re-flows to the
   nearest free space). Into another rack → the device moves there for real (wiring, power and
   patch counts follow); a shelf takes its boxes along; an encoder kit follows its sources, and a
   patch panel follows the runs — those two only move within their rack. Returns a message. */
export function moveRackItem(sol, plans, { from, key, to, row }) {
  const rackOf = id => (sol.racks || []).find(r => r.id === id);
  const fromR = rackOf(from), toR = rackOf(to), fromP = plans.find(p => p.rack === from), toP = plans.find(p => p.rack === to);
  if (!fromR || !toR || !fromP || !toP) return { ok: false, msg: "That rack isn't on this solution" };
  const it = fromP.items.find(i => i.key === key);
  if (!it) return { ok: false, msg: "Nothing to move there" };
  row = Math.max(0, Math.round(row));
  const freeze = (r, p) => { if (!r.layout || !Object.keys(r.layout).length) { r.layout = {}; for (const i of p.items) if (i.key) r.layout[i.key] = i.row; } };
  freeze(fromR, fromP); freeze(toR, toP);
  if (from !== to) {
    const ids = it.kind === "device" ? [it.id] : it.kind === "shelf" && !it.kit ? it.memberIds || [] : null;
    if (!ids || !ids.length) return { ok: false, msg: it.kit ? "An encoder kit stays with its sources' rack" : "A patch panel follows the runs — it stays in its rack" };
    for (const id of ids) {
      const k = fromR.devices.findIndex(d => d.id === id);
      if (k >= 0) toR.devices.push(...fromR.devices.splice(k, 1));
    }
    delete fromR.layout[key];
  }
  // what's in the way at the drop
  const hits = toP.items.filter(i => i.key && i.key !== key && i.row < row + it.u && row < i.row + i.u);
  // a half-width box onto a row with one half-width box alone in it: they pair up, side by side
  const mate = it.half && hits.length === 1 && hits[0].half && !hits[0].side && hits[0].u === it.u ? hits[0] : null;
  if (mate) { toR.layout[key] = mate.row; return { ok: true, msg: `${it.label} paired beside ${mate.label}` }; }
  if (hits.length === 1 && hits[0].u === it.u && hits[0].row === row && from === to) toR.layout[hits[0].key] = it.row;   // swap
  else {   // make room: each box in the way goes to the nearest free space — just below the drop first, then above
    const taken = new Set();
    for (const i of toP.items) if (i.key && i.key !== key && !hits.includes(i)) for (let k = i.row; k < i.row + i.u; k++) taken.add(k);
    for (let k = row; k < row + it.u; k++) taken.add(k);
    const free = (r0, u) => r0 >= 0 && r0 + u <= toP.size && [...Array(u).keys()].every(k => !taken.has(r0 + k));
    for (const h of hits) {
      let at = null;
      for (let d = 0; d <= toP.size && at == null; d++) { if (free(row + it.u + d, h.u)) at = row + it.u + d; else if (free(row - h.u - d, h.u)) at = row - h.u - d; }
      if (at == null) { delete toR.layout[h.key]; continue; }
      toR.layout[h.key] = at; for (let k = at; k < at + h.u; k++) taken.add(k);
    }
  }
  toR.layout[key] = row;
  return { ok: true, msg: from === to ? `Moved ${it.label}` : `Moved ${it.label} to ${toR.name}` };
}
// back to the build-order stack
export function resetRackLayout(sol, rackId) { const r = (sol.racks || []).find(x => x.id === rackId); if (r) delete r.layout; }
