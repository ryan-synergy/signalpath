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
import { companionRef } from "./network.js";

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
      const size = Math.max(1, Math.floor(+r.units || +job.job?.rackUnits || DEFAULT_RACK_U));
      const items = [], unknown = [], rear = [], small = [];
      if (ri === 0 && cat6) for (let k = 0; k < Math.ceil(cat6 / PATCH_PORTS); k++)
        items.push({ kind: "patch", tier: 0, u: 1, label: `Cat6 patch panel ${PATCH_PORTS}-port${Math.ceil(cat6 / PATCH_PORTS) > 1 ? ` (${k + 1})` : ""}` });
      for (const d of r.devices || []) {
        const c = cat(d.catalogRef);
        const name = `${d.model || d.id}${d.danteSwitch ? " (Dante)" : ""}`;
        if (c?.mount === "vertical") { rear.push(name); continue; }
        const u = typeof c?.rackUnits === "number" ? c.rackUnits : null;
        const tier = TIER[d.type] ?? 2;
        if (u == null && (d.type === "source" || c?.desktop)) { small.push(name); continue; }
        if (u == null) unknown.push(name);
        items.push({ kind: "device", id: d.id, tier, u: u ?? 1, label: name, type: d.type, guess: u == null, half: !!c?.halfRack });
        if (d.type === "amp" || d.type === "avr") items.push({ kind: "vent", tier, u: 1, label: "Vent panel" });
      }
      // rack-side adapters (MXNet encoders on the rack sources) sit on shelves too
      for (const comp of Object.values(s.companions)) {
        const host = (r.devices || []).find(d => d.id === comp.serves);
        if (!host) continue;
        small.push(`${cat(companionRef(comp, tenG))?.model || "Encoder"} (${host.model || host.id})`);
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
      out.push({ solution: sol.id, rack: r.id, name: r.name || "Equipment Rack", size, used, spare: size - used,
        over: Math.max(0, used - size), items, unknown, rear, cat6: ri === 0 ? cat6 : 0 });
    });
  }
  return out;
}
