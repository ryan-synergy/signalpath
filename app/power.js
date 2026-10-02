/* ---------- power.js — the rack outlet budget ----------
   Every box in the rack needs an outlet on the power conditioner (WattBox)
   unless its switch powers it over PoE. Counts come from the job graph and
   the port plan (network.js): a PoE device only skips an outlet when the
   switch it actually lands on supplies PoE. A catalog entry can say it takes
   more than one outlet (`outlets: 2` — dual power supplies, big amps).
   Pure: advise() attaches it (advise().power), the Network & Power page
   prints it, the takeoff and exports read the WattBox like any rack gear.
   One plan per rack: a pool house rack is its own building — its own WattBox,
   circuit and closet heat — so its loads never borrow the main rack's outlets.
   A box goes to the rack it sits in; a rack-side adapter to the rack of what it
   serves (an encoder) or what feeds it (a balun's TX, an eARC kit's RX). */

import { companionRef, specFor, balunRxOnly } from "./network.js";
import { describeNode } from "./names.js";

// spare outlets to leave: 20%, never fewer than 2 (the ISP modem and a router always show up)
export const spareTarget = need => Math.max(2, Math.ceil(need * 0.2));

// catalog watts: powerTypicalW (1/8 power / typical), powerMaxW (rated / max); either may be missing
// rules of thumb: past ~500 W an enclosed rack wants a fan; past ~1,500 W the closet needs real cooling
export const HEAT_FAN_W = 500, HEAT_ROOM_W = 1500;
const POE_CLASS0_W = 12.95;            // 802.3af ceiling at the device, for PoE gear with no published draw
const watts = c => ({ typicalW: c?.powerTypicalW ?? null, maxW: c?.powerMaxW ?? null });

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
    const rackOf = {};
    for (const r of sol.racks || []) for (const d of r.devices || []) rackOf[d.id] = r.id;
    // a PoE switch's published max includes its whole PoE budget; what it really
    // draws is its own electronics plus what the PoE gear on it pulls
    const catOfId = id => cat(s.devices[id]?.catalogRef ?? s.locals[id]?.catalogRef) || cat(companionRef(s.companions[id], tenG));
    const switchWatts = (d, c) => {
      const plan = netPlans.find(p => p.solution === sol.id && p.switch === d.id);
      if (!plan || c?.powerNoPoeW == null || d.powerTypicalW != null || d.powerMaxW != null) return watts(c);   // a typed-in figure wins
      const powered = plan.rows.filter(r => r.power === "PoE").map(r => catOfId(r.id));
      const typ = powered.reduce((n, pc) => n + (pc?.powerTypicalW ?? pc?.powerMaxW ?? POE_CLASS0_W), 0);
      const max = powered.reduce((n, pc) => n + (pc?.powerMaxW ?? pc?.powerTypicalW ?? POE_CLASS0_W), 0);
      return { typicalW: Math.round(c.powerNoPoeW + typ), maxW: Math.round(c.powerNoPoeW + max), poeLoad: powered.length };
    };
    for (const d of Object.values(s.devices)) {
      const c = specFor(d, catalog);
      if (d.type === "power") { units.push({ rack: rackOf[d.id], id: d.id, model: d.model || c?.model || d.id, outlets: c?.outlets ?? null, controlled: c?.controlledOutlets ?? null, amps: c?.amps ?? 15 }); continue; }
      if (poeRow(d.id)) { poe.push({ rack: rackOf[d.id], id: d.id, what: d.model || d.id }); continue; }
      const n = Math.min(48, Math.max(1, Math.floor(+c?.outlets || 1)));   // specFor vetted a typed-in count
      loads.push({ rack: rackOf[d.id], id: d.id, what: d.model || d.id, outlets: n, why: n > 1 ? `${n} power cords` : "", ...switchWatts(d, c) });
    }
    // adapters that live in the rack: MXNet encoders on the rack sources
    for (const comp of Object.values(s.companions)) {
      if (!s.devices[comp.serves]) continue;
      const host = s.devices[comp.serves];
      const what = `${cat(companionRef(comp, tenG))?.model || "Encoder"} (${host.model || host.id})`;
      if (poeRow(comp.id)) poe.push({ rack: rackOf[comp.serves], id: comp.id, what });
      else loads.push({ rack: rackOf[comp.serves], id: comp.id, what, outlets: 1, why: "power supply", ...watts(cat(companionRef(comp, tenG))) });
    }
    // HDBaseT baluns fed from the rack: the kit's one PSU powers both ends over the
    // cable (PoH), so it plugs in at the rack TX — on the WattBox, where it can be rebooted.
    // Only included rooms (a pre-wire room's balun isn't on this job's rack yet).
    for (const comp of Object.values(s.companions)) {
      if (comp.type !== "balun" || !ix.endpointsById[comp.serves] || balunRxOnly(comp, sol, catalog)) continue;   // an AXION powers its receivers
      const zone = ix.zonesById[ix.endpointZone[comp.serves]];
      if ((zone?.scope || "included") !== "included") continue;
      const feed = (sol.connections || []).find(k => k.to === comp.id && s.devices[k.from]);
      if (!feed) continue;
      const c = cat(companionRef(comp));
      loads.push({ rack: rackOf[feed.from], id: comp.id, what: `${c?.model || "HDBaseT balun"} PSU (${describeNode(job, sol, comp.serves).short})`,
        outlets: 1, why: "at the TX — powers both ends (PoH)", ...watts(c) });
    }
    // eARC extender kits: same idea from the other end — the PSU plugs in at the rack RX (PoC)
    for (const k of sol.connections || []) {
      if (!k.earcKit || k.signal !== "audioReturn" || !s.devices[k.to] || !ix.endpointsById[k.from]) continue;
      const zone = ix.zonesById[ix.endpointZone[k.from]];
      if ((zone?.scope || "included") !== "included" || (k.scope && k.scope !== "included")) continue;
      const c = cat("avpro-ac-aex-dearc-kit");
      loads.push({ rack: rackOf[k.to], id: `earckit-${k.from}`, what: `${c?.model || "eARC extender"} PSU (${describeNode(job, sol, k.from).short})`,
        outlets: 1, why: "at the RX — powers both ends (PoC)", ...watts(c) });
    }
    const main = sol.racks?.[0]?.id;
    for (const x of [...loads, ...poe, ...units]) x.rack ??= main;
    const multi = (sol.racks || []).length > 1;
    for (const r of sol.racks?.length ? sol.racks : [{ id: undefined }]) {
      const mine = x => x.rack === r.id;
      const plan = rackPower(loads.filter(mine), poe.filter(mine), units.filter(mine), models);
      if (plan) plans.push({ solution: sol.id, rack: r.id, rackName: r.name || "Equipment Rack", multi, ...plan });
    }
  }
  return plans;
}

function rackPower(loads, poe, units, models) {
  if (!loads.length && !units.length) return null;
  const need = loads.reduce((n, l) => n + l.outlets, 0);
  const supply = units.length && units.every(u => u.outlets != null) ? units.reduce((n, u) => n + u.outlets, 0) : null;
  const spare = spareTarget(need);
  // the smallest single unit that covers need + spare, else the biggest (and say how many)
  const bySize = models.sort((a, b) => a[1].outlets - b[1].outlets);
  const fit = bySize.find(([, c]) => c.outlets >= need + spare);
  const big = bySize[bySize.length - 1];
  const pick = fit ? { ref: fit[0], model: fit[1].model, qty: 1, outlets: fit[1].outlets }
    : big ? { ref: big[0], model: big[1].model, qty: Math.ceil((need + spare) / big[1].outlets), outlets: big[1].outlets } : null;
  // circuit load: typical (1/8 power for amps — what music actually draws) and max,
  // against the conditioner's continuous rating (80% of the breaker; 15A unless a 20A unit)
  // one circuit per power conditioner (two WattBoxes = two circuits); 15A unless every unit is a 20A model
  const amps = units.length ? Math.min(...units.map(u => u.amps || 15)) : 15;
  const circuits = Math.max(1, units.length);
  const circuitW = Math.round(amps * 0.8 * 120) * circuits;
  const typicalW = Math.round(loads.reduce((n, l) => n + (l.typicalW ?? l.maxW ?? 0), 0));
  const maxW = Math.round(loads.reduce((n, l) => n + (l.maxW ?? l.typicalW ?? 0), 0));
  const noWatts = loads.filter(l => l.typicalW == null && l.maxW == null).map(l => l.what);
  // heat: what the rack draws at typical load stays in the rack as heat (1 W = 3.412 BTU/hr);
  // conservative for amps, whose speaker output leaves the room
  const heatW = typicalW, btu = Math.round(heatW * 3.412);
  const cooling = heatW > HEAT_ROOM_W ? "room" : heatW > HEAT_FAN_W ? "fan" : null;
  return { loads, poe, units, need, supply, spare, pick, circuitW, circuitA: amps, circuits, typicalW, maxW, noWatts, heatW, btu, cooling,
    short: supply != null && units.length ? Math.max(0, need - supply) : null,
    tight: supply != null && units.length && supply >= need && supply < need + spare };
}
