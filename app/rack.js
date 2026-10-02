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

export const DEFAULT_RACK_U = 42;
export const RACK_SIZES = [12, 16, 20, 24, 27, 32, 36, 38, 40, 42, 44, 45];
const SHELF_U = 2, PER_SHELF = 3, PATCH_PORTS = 24;

const TIER = { gateway: 0.5, networkSwitch: 1, avSwitch: 1, avbSwitch: 1,
  controlBox: 2, host: 2, videoMatrix: 2, danteBridge: 2, downmixer: 2, audioInputModule: 2, audioOutputModule: 2, splitter: 2,
  source: 3, avr: 4, amp: 4, power: 5 };

/* spacing (Ryan 2026-10-02, Synergy practice). Two strengths:
   - always: a receiver or amp (sub amps too) has 1U of vent above and below; anything else that runs
     warm — a matrix switcher, a Savant host, a shelf of sources (Apple TV, DirecTV, cable boxes), a box
     source like a Kaleidescape — has 1U after it; a brush plate sits under the patch panels and between
     the router and the switches so the cables come out cleanly (it breathes too, so it stands in for a vent);
   - when there's room: 1U between the other boxes too — routers and switches are what stack when a rack
     has to be squeezed, so those spaces are the first given up.
   The room left after that goes to the space above each receiver / amp (2U, top down). One gap holds one
   spacer; the floor below the last box needs none. */
const HOT = new Set(["avr", "amp"]);
const WARM = new Set(["videoMatrix", "host", "source"]);
const SWITCHES = new Set(["networkSwitch", "avSwitch", "avbSwitch"]);
function spaceRack(items, size) {
  const type = i => i.kind === "device" ? i.type : null;
  const warm = i => WARM.has(type(i)) || (i.kind === "shelf" && !i.kit);   // a shelf of boxes runs warm; an MXNet encoder kit is spaced only when there's room
  const gaps = [];                                       // gaps[k] = the spacer above items[k] (or null)
  items.forEach((b, k) => {
    const a = k ? items[k - 1] : null;
    if (!a || a.kind === "patch" && b.kind === "patch") { gaps.push(null); return; }
    const ta = type(a), tb = type(b);
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
      const size = Math.min(60, Math.max(1, Math.floor(+r.units || +job.job?.rackUnits || DEFAULT_RACK_U) || DEFAULT_RACK_U));
      const items = [], unknown = [], rear = [], small = [], cboxes = [];
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
        if (u == null && d.type === "controlBox" && /CBOX/i.test(`${d.model || ""} ${c?.model || ""}`)) { cboxes.push(name); continue; }
        if (u == null && (d.type === "source" || c?.desktop)) { small.push(name); continue; }
        // no height in the catalog, or one the catalog marks to confirm (Ryan 2026-10-01: Savant PAV
        // modules drawn 1U, flagged "need to confirm") — either way the elevation shows it and the advisor asks
        const confirm = u == null || !!c?.rackUnitsConfirm;
        if (confirm) unknown.push(name);
        items.push({ kind: "device", id: d.id, tier, u: u ?? 1, label: name, type: d.type, guess: confirm, half: !!c?.halfRack, boxKind: deviceKind(d, c) });
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
        if (g) (byGen[g] ||= []).push({ label, model: ce?.model || "" }); else small.push(label);
      }
      const kits = Object.entries(catalog?.devices || {}).filter(([, c]) => c.rackKit && typeof c.rackUnits === "number");
      for (const [g, members] of Object.entries(byGen)) {
        const fit = kits.filter(([, c]) => c.rackKit.gen === g).sort((x, y) => x[1].rackKit.holds - y[1].rackKit.holds);
        // an endpoint a kit won't take (AVPro: Dante encoders don't fit the 1G racks) rides a shelf
        const fits = m => fit.length && !fit.every(([, c]) => c.rackKit.excludes && m.model.toUpperCase().includes(c.rackKit.excludes));
        small.push(...members.filter(m => !fits(m)).map(m => m.label));
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
      for (const cb of cboxes) {
        const kitItems = items.filter(i => i.kitSpec);
        const extra = kitItems.find(i => i.kitSpec.cbox === "extra" && !i.cbox);
        const slot = kitItems.find(i => i.kitSpec.cbox === "slot" && i.members.length < i.kitSpec.holds);
        const home = extra || slot;
        if (!home) { small.push(cb); continue; }
        home.members.push(cb); if (home === extra) home.cbox = cb;
        const n = home.members.length - (home.cbox ? 1 : 0);
        home.label = `${home.kit} (${n}/${home.kitSpec.holds}${home.cbox ? " + control box" : ""}): ${home.members.join(", ")}`;
      }
      for (let k = 0; k < small.length; k += PER_SHELF)
        items.push({ kind: "shelf", tier: 3, u: SHELF_U, label: `Shelf: ${small.slice(k, k + PER_SHELF).join(", ")}`, members: small.slice(k, k + PER_SHELF) });
      items.sort((a, b) => a.tier - b.tier);   // stable by tier
      // half-width boxes pair up side by side
      for (let i = 0; i < items.length; i++) {
        const a = items[i];
        if (!a.half || a.pairedWith) continue;
        const j = items.findIndex((b, k) => k > i && b.half && !b.pairedWith && b.u === a.u);
        if (j > 0) { a.pairedWith = items[j].label; items.splice(j, 1); a.label = `${a.label} | ${a.pairedWith}`; }
      }
      spaceRack(items, size);
      const used = items.reduce((n, i) => n + i.u, 0);
      // the rack hardware the elevation implies — part numbers come from the job
      // (RACK tab) or a kit's catalog entry; anything nobody has filled in is "?"
      const parts = job.job?.rackParts || {};
      const count = k => items.filter(i => i.kind === k && !i.kit).length;
      const hardware = [
        { key: "rack", item: `Equipment rack, ${size}U`, qty: 1, partNo: r.partNo || parts.rack || null },
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
        over: Math.max(0, used - size), items, unknown, rear, cat6,
        hardware: hardware.filter(h => h.qty > 0) });
    });
  }
  return out;
}
