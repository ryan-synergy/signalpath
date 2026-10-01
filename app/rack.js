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

export const DEFAULT_RACK_U = 42;
export const RACK_SIZES = [12, 16, 20, 24, 27, 32, 36, 38, 40, 42, 44, 45];
const SHELF_U = 2, PER_SHELF = 3, PATCH_PORTS = 24;

const TIER = { gateway: 1, networkSwitch: 1, avSwitch: 1, avbSwitch: 1,
  controlBox: 2, host: 2, videoMatrix: 2, danteBridge: 2, downmixer: 2, audioInputModule: 2, audioOutputModule: 2, splitter: 2,
  source: 3, avr: 4, amp: 4, power: 5 };

export function rackPlans(job, ix, catalog) {
  const out = [];
  const cat = ref => ref ? catalog?.devices?.[ref] : null;
  for (const [si, s] of ix.solutions.entries()) {
    const sol = s.sol;
    const tenG = Object.values(s.devices).some(d => cat(d.catalogRef)?.gen === "10g");
    // Cat6 home runs land on patch panels in the first rack
    let cat6 = 0;
    try { cat6 = wireRuns(job, ix, { solution: si }).filter(r => /^Cat6/.test(r.cable)).reduce((n, r) => n + r.count, 0); } catch { cat6 = 0; }
    (sol.racks || []).forEach((r, ri) => {
      // 1–60U: a typo'd 4200 would draw 4,200 rows and stall the page
      const size = Math.min(60, Math.max(1, Math.floor(+r.units || +job.job?.rackUnits || DEFAULT_RACK_U) || DEFAULT_RACK_U));
      const items = [], unknown = [], rear = [], small = [];
      if (ri === 0 && cat6) for (let k = 0; k < Math.ceil(cat6 / PATCH_PORTS); k++)
        items.push({ kind: "patch", tier: 0, u: 1, label: `Cat6 patch panel ${PATCH_PORTS}-port${Math.ceil(cat6 / PATCH_PORTS) > 1 ? ` (${k + 1})` : ""}` });
      for (const d of r.devices || []) {
        const c = specFor(d, catalog);
        const name = `${d.model || d.id}${d.danteSwitch ? " (Dante)" : ""}`;
        if (c?.mount === "vertical") { rear.push(name); continue; }
        const u = typeof c?.rackUnits === "number" ? c.rackUnits : null;
        const tier = TIER[d.type] ?? 2;
        if (u == null && (d.type === "source" || c?.desktop)) { small.push(name); continue; }
        // no height in the catalog, or one the catalog marks to confirm (Ryan 2026-10-01: Savant PAV
        // modules drawn 1U, flagged "need to confirm") — either way the elevation shows it and the advisor asks
        const confirm = u == null || !!c?.rackUnitsConfirm;
        if (confirm) unknown.push(name);
        items.push({ kind: "device", id: d.id, tier, u: u ?? 1, label: name, type: d.type, guess: confirm, half: !!c?.halfRack });
        if (d.type === "amp" || d.type === "avr") items.push({ kind: "vent", tier, u: 1, label: "Vent panel" });
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
        while (rest.length) {
          // the kit that houses what's left in the fewest rack units (4 endpoints: two 1U R2s beat a 6U R15)
          const cost = ([, c]) => Math.ceil(rest.length / c.rackKit.holds) * c.rackUnits;
          const [, k] = [...fit].sort((x, y) => cost(x) - cost(y) || y[1].rackKit.holds - x[1].rackKit.holds)[0];
          const take = rest.splice(0, k.rackKit.holds);
          items.push({ kind: "shelf", tier: 3, u: k.rackUnits, label: `${k.model} (${take.length}/${k.rackKit.holds}): ${take.join(", ")}`, members: take, kit: k.model });
        }
      }
      for (let k = 0; k < small.length; k += PER_SHELF)
        items.push({ kind: "shelf", tier: 3, u: SHELF_U, label: `Shelf: ${small.slice(k, k + PER_SHELF).join(", ")}`, members: small.slice(k, k + PER_SHELF) });
      // stable by tier; a trailing vent under the last amp is dropped (the WattBox or floor is below)
      items.sort((a, b) => a.tier - b.tier);
      const lastAmp = items.map(i => i.kind).lastIndexOf("vent");
      if (lastAmp >= 0 && !items.slice(lastAmp + 1).some(i => i.kind !== "vent")) items.splice(lastAmp, 1);
      // half-width boxes pair up side by side
      for (let i = 0; i < items.length; i++) {
        const a = items[i];
        if (!a.half || a.pairedWith) continue;
        const j = items.findIndex((b, k) => k > i && b.half && !b.pairedWith && b.u === a.u);
        if (j > 0) { a.pairedWith = items[j].label; items.splice(j, 1); a.label = `${a.label} | ${a.pairedWith}`; }
      }
      const used = items.reduce((n, i) => n + i.u, 0);
      // the rack hardware the elevation implies — part numbers come from the job
      // (RACK tab) or a kit's catalog entry; anything nobody has filled in is "?"
      const parts = job.job?.rackParts || {};
      const count = k => items.filter(i => i.kind === k && !i.kit).length;
      const hardware = [
        { key: "rack", item: `Equipment rack, ${size}U`, qty: 1, partNo: r.partNo || parts.rack || null },
        { key: "patch", item: "Cat6 patch panel, 24-port, 1U", qty: count("patch"), partNo: parts.patch || null },
        { key: "vent", item: "Vent panel, 1U", qty: count("vent"), partNo: parts.vent || null },
        { key: "shelf", item: "Rack shelf, 2U", qty: count("shelf"), partNo: parts.shelf || null },
      ];
      const kitQty = {};
      for (const i of items.filter(i => i.kit)) kitQty[i.kit] = (kitQty[i.kit] || 0) + 1;
      for (const [kit, qty] of Object.entries(kitQty)) hardware.push({ key: "kit", item: `MXNet rack kit, ${items.find(i => i.kit === kit).u}U`, qty, partNo: kit });
      out.push({ solution: sol.id, rack: r.id, name: r.name || "Equipment Rack", size, used, spare: size - used,
        over: Math.max(0, used - size), items, unknown, rear, cat6: ri === 0 ? cat6 : 0,
        hardware: hardware.filter(h => h.qty > 0) });
    });
  }
  return out;
}
