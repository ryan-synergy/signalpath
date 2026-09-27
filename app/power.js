/* ---------- power.js — the rack outlet budget ----------
   Every box in the rack needs an outlet on the power conditioner (WattBox)
   unless its switch powers it over PoE. Counts come from the job graph and
   the port plan (network.js): a PoE device only skips an outlet when the
   switch it actually lands on supplies PoE. A catalog entry can say it takes
   more than one outlet (`outlets: 2` — dual power supplies, big amps).
   Pure: advise() attaches it (advise().power), the Network & Power page
   prints it, the takeoff and exports read the WattBox like any rack gear. */

import { companionRef } from "./network.js";

// spare outlets to leave: 20%, never fewer than 2 (the ISP modem and a router always show up)
export const spareTarget = need => Math.max(2, Math.ceil(need * 0.2));

export function powerPlan(job, ix, catalog, netPlans = []) {
  const plans = [];
  const cat = ref => ref ? catalog?.devices?.[ref] : null;
  // the auto-pick sticks to the lineup Synergy specs by default (catalog flag wattboxPick)
  const all = Object.entries(catalog?.devices || {}).filter(([, c]) => c.type === "power" && c.outlets && !(c.flags || []).includes("legacy"));
  const models = all.some(([, c]) => (c.flags || []).includes("wattboxPick")) ? all.filter(([, c]) => c.flags.includes("wattboxPick")) : all;
  for (const s of ix.solutions) {
    const sol = s.sol;
    const tenG = Object.values(s.devices).some(d => cat(d.catalogRef)?.gen === "10g");
    const poeRow = id => netPlans.find(p => p.solution === sol.id && p.rows.some(r => r.id === id && r.power === "PoE"));
    const loads = [], poe = [], units = [];
    for (const d of Object.values(s.devices)) {
      const c = cat(d.catalogRef);
      if (d.type === "power") { units.push({ id: d.id, model: d.model || c?.model || d.id, outlets: c?.outlets ?? d.outlets ?? null, controlled: c?.controlledOutlets ?? null }); continue; }
      if (poeRow(d.id)) { poe.push({ id: d.id, what: d.model || d.id }); continue; }
      const n = Math.max(1, Math.floor(+(d.outlets ?? c?.outlets) || 1));
      loads.push({ id: d.id, what: d.model || d.id, outlets: n, why: n > 1 ? `${n} power cords` : "" });
    }
    // adapters that live in the rack: MXNet encoders on the rack sources
    for (const comp of Object.values(s.companions)) {
      if (!s.devices[comp.serves]) continue;
      const host = s.devices[comp.serves];
      const what = `${cat(companionRef(comp, tenG))?.model || "Encoder"} (${host.model || host.id})`;
      if (poeRow(comp.id)) poe.push({ id: comp.id, what });
      else loads.push({ id: comp.id, what, outlets: 1, why: "power supply" });
    }
    if (!loads.length && !units.length) continue;
    const need = loads.reduce((n, l) => n + l.outlets, 0);
    const supply = units.length && units.every(u => u.outlets != null) ? units.reduce((n, u) => n + u.outlets, 0) : null;
    const spare = spareTarget(need);
    // the smallest single unit that covers need + spare, else the biggest (and say how many)
    const bySize = models.sort((a, b) => a[1].outlets - b[1].outlets);
    const fit = bySize.find(([, c]) => c.outlets >= need + spare);
    const big = bySize[bySize.length - 1];
    const pick = fit ? { ref: fit[0], model: fit[1].model, qty: 1, outlets: fit[1].outlets }
      : big ? { ref: big[0], model: big[1].model, qty: Math.ceil((need + spare) / big[1].outlets), outlets: big[1].outlets } : null;
    plans.push({ solution: sol.id, loads, poe, units, need, supply, spare, pick,
      short: supply != null && units.length ? Math.max(0, need - supply) : null,
      tight: supply != null && units.length && supply >= need && supply < need + spare });
  }
  return plans;
}
