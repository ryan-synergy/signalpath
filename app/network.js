/* ---------- network.js — the switch port plan ----------
   Which box lands on which switch port, and on which network. Every edge
   touching a switch is a port (MXNet encoders/decoders ride their video edge
   to it, control boxes their network edge). A dedicated Dante switch also
   takes the Dante gear whose links are drawn box→box rather than to the
   switch — AXIS encoders at the TVs, Dante bridges, Dante amps — and when
   Dante-enabled MXNet endpoints exist, the two switches share a VLAN 99
   trunk. Pure: advise() attaches the plan (advise().network), the Network
   page prints it, the AI export lists it. */

import { adapterName, adapterTag, describeNode } from "./names.js";

export const SWITCH_TYPES = new Set(["avSwitch", "avbSwitch", "networkSwitch", "gateway"]);
// the house LAN stand-in when a job needs Ethernet ports but has no LAN switch yet
export const HOUSE_LAN = "__lan";
// gear with no Ethernet jack (a catalog entry can say otherwise with `lan: n`)
const NO_LAN_TYPES = new Set(["splitter", "downmixer", "power-strip"]);
const NO_LAN_NAME = /\b(turn ?table|record player|phono|cd player|tuner)\b/i;
export const NET_ROLE_NAME = { mxnet: "MXNet video", dante: "Dante audio", avb: "AVB audio", lan: "Network" };

// the catalog product behind an app-added adapter (exports and the port plan agree)
export function companionRef(comp, tenG) {
  if (!comp) return null;
  if (comp.type === "axis") return "avpro-acp-axis2";
  if (comp.type === "axis16") return "avpro-acp-axis16";
  if (comp.type === "enc") return tenG ? "avpro-mxnet-10g-tcvr" : comp.dante ? "avpro-mxnet-1g-dante-ev2" : "avpro-mxnet-1g-ev2";
  if (comp.type === "dec") return tenG ? "avpro-mxnet-10g-tcvr" : comp.dante ? "avpro-mxnet-1g-dante-dv2" : "avpro-mxnet-1g-dv2";
  return null;
}

// sizing profile for gear the job names but doesn't link: a catalog entry may carry
// `match` (a name pattern, e.g. "^apple ?tv") — used for watts, rack height and
// jacks only; the quote exports still read catalogRef alone
export function catalogFor(d, catalog) {
  if (!d) return null;
  const c = d.catalogRef ? catalog?.devices?.[d.catalogRef] : null;
  if (c) return c;
  const name = String(d.model || "").trim();
  if (!name) return null;
  for (const e of Object.values(catalog?.devices || {}))
    if (e.match && e.type === d.type && new RegExp(e.match, "i").test(name)) return e;
  return null;
}

// what the rack math reads for a box: its catalog/profile spec with the job's own
// filled-in values on top (RACK tab: a "?" someone typed in) — the job wins
export const SPEC_FIELDS = ["rackUnits", "powerTypicalW", "powerMaxW", "outlets"];
export function specFor(d, catalog) {
  const c = catalogFor(d, catalog);
  const own = Object.fromEntries(SPEC_FIELDS.filter(k => d?.[k] != null && d[k] !== "").map(k => [k, +d[k]]));
  return c || Object.keys(own).length ? { ...(c || {}), ...own } : null;
}

const portsOf = c => {
  const o = c?.outputs || {};
  return { copper: (o.gbe || 0) + (o.gbe25 || 0) + (o.gbe10 || 0), sfp: (o.sfp || 0) + (o.sfpPlus || 0) };
};

export function networkPlan(job, ix, catalog) {
  const plans = [];
  const zoneIx = new Map((job.house?.zones || []).map((z, i) => [z.id, i]));
  for (const s of ix.solutions) {
    const sol = s.sol, conns = sol.connections || [];
    const switches = Object.values(s.devices).filter(d => SWITCH_TYPES.has(d.type));
    const cat = ref => ref ? catalog?.devices?.[ref] : null;
    const tenG = Object.values(s.devices).some(d => cat(d.catalogRef)?.gen === "10g");
    const catOf = id => s.devices[id] ? catalogFor(s.devices[id], catalog) : s.locals[id] ? catalogFor(s.locals[id], catalog)
      : s.companions[id] ? cat(companionRef(s.companions[id], tenG)) : null;
    const flags = id => catOf(id)?.flags || [];
    const role = d => d.danteSwitch ? "dante" : d.type === "avbSwitch" || flags(d.id).includes("avb") ? "avb"
      : d.type === "avSwitch" || flags(d.id).includes("mxnet") ? "mxnet" : "lan";
    const lanPorts = (id, node) => {                     // how many Ethernet jacks this box brings to the LAN
      const c = catOf(id);
      if (c?.lan != null) return +c.lan || 0;
      return NO_LAN_TYPES.has(node?.type) || NO_LAN_NAME.test(node?.model || "") ? 0 : 1;
    };

    // switch id → Map(node id → { trunk })
    const members = new Map(switches.map(d => [d.id, new Map()]));
    const add = (sw, id, extra = {}) => { if (id !== sw && !members.get(sw).has(id)) members.get(sw).set(id, extra); };
    for (const c of conns) {
      if (c.dante) continue;                                // a Dante subscription is not a cable to the switch
      if (members.has(c.from)) add(c.from, c.to);
      if (members.has(c.to)) add(c.to, c.from);
    }
    const onSomeSwitch = id => [...members.values()].some(m => m.has(id));
    const danteSw = switches.find(d => d.danteSwitch);
    const mxnetDante = id => { const c = s.companions[id]; return !!c && c.dante && (c.type === "enc" || c.type === "dec"); };
    if (danteSw) {
      for (const c of conns.filter(k => k.dante)) for (const id of [c.from, c.to]) {
        if (mxnetDante(id) || onSomeSwitch(id) || members.has(id)) continue;   // DANTE-DV2/EV2 ride VLAN 99 on the MXNet switch
        if (s.devices[id] || s.companions[id] || s.locals[id]) add(danteSw.id, id);
      }
      for (const sw of switches) if (sw !== danteSw && role(sw) === "mxnet" && [...members.get(sw.id).keys()].some(mxnetDante)) {
        add(sw.id, danteSw.id, { trunk: true });
        add(danteSw.id, sw.id, { trunk: true });
      }
    }

    /* the house LAN: every TV and every networked box takes an Ethernet port.
       A box already on an AV switch is networked there — except control boxes,
       whose control port is its own jack on the house network. */
    const lanNeeds = [];
    for (const d of Object.values(s.devices)) {
      if (SWITCH_TYPES.has(d.type) || !lanPorts(d.id, d)) continue;
      if (d.type === "controlBox" ? [...members].some(([sw, m]) => role(s.devices[sw]) === "lan" && m.has(d.id)) : onSomeSwitch(d.id)) continue;
      lanNeeds.push(d.id);
    }
    for (const d of Object.values(s.locals)) if (lanPorts(d.id, d) && !onSomeSwitch(d.id)) lanNeeds.push(d.id);
    for (const z of job.house?.zones || []) {
      if ((z.scope || "included") !== "included") continue;
      for (const e of z.endpoints || []) if (e.type === "display" && !onSomeSwitch(e.id)) lanNeeds.push(e.id);
    }
    let lanSw = switches.find(d => role(d) === "lan" && d.type !== "gateway") || switches.find(d => role(d) === "lan");
    if (!lanSw && lanNeeds.length) {
      lanSw = { id: HOUSE_LAN, type: "networkSwitch", model: "House LAN switch (to add)", virtual: true };
      switches.push(lanSw); members.set(HOUSE_LAN, new Map());
    }
    for (const id of lanNeeds) add(lanSw.id, id, { lan: true });
    // each AV network reaches the house LAN over one uplink (stacked switches share it)
    if (lanSw) {
      const linked = new Set();
      for (const sw of switches) {
        if (sw === lanSw || !["mxnet", "avb"].includes(role(sw))) continue;
        const stack = [...members.get(sw.id).keys()].filter(id => s.devices[id] && role(s.devices[id]) === role(sw));
        if (members.get(lanSw.id).has(sw.id) || stack.some(id => linked.has(id))) { linked.add(sw.id); continue; }
        add(lanSw.id, sw.id); add(sw.id, lanSw.id); linked.add(sw.id);
      }
    }
    if (!switches.length) continue;

    for (const sw of switches) {
      const r = sw.virtual ? "lan" : role(sw), swCat = cat(sw.catalogRef), cap = portsOf(swCat);
      const known = cap.copper + cap.sfp > 0;
      const swPoe = (swCat?.flags || []).includes("poe") || !!swCat?.poeBudgetW;
      const info = [...members.get(sw.id)].map(([id, extra], order) => {
        const d = s.devices[id] || (id === HOUSE_LAN ? lanSw : null), comp = s.companions[id], loc = s.locals[id];
        const isSwitch = !!d && SWITCH_TYPES.has(d.type);
        let what, where = "Rack", label, rank = 1, zi = -1;
        if (d) {
          what = d.model || id; label = d.model || id;
          rank = isSwitch ? 9 : d.type === "controlBox" ? 0 : 1;
        } else if (comp) {
          const host = s.devices[comp.serves];
          const zid = host ? null : ix.endpointZone[comp.serves];
          const z = zid ? ix.zonesById[zid] : null;
          const model = catOf(id)?.model;
          what = model || adapterName(comp);
          where = host ? `Rack · ${host.model || comp.serves}` : z ? `${z.name} — TV location` : "(zone removed)";
          label = `${adapterTag(comp)} ${host ? host.model || comp.serves : z?.name || ""}`.trim();
          rank = host ? 1 : 2; zi = zid ? zoneIx.get(zid) ?? 999 : -1;
        } else if (loc) {
          const z = ix.zonesById[loc.zone];
          what = loc.model || id; where = z ? z.name : "(zone removed)"; label = `${loc.model || id} ${z?.name || ""}`.trim();
          rank = 2; zi = zoneIx.get(loc.zone) ?? 999;
        } else if (ix.endpointsById[id]) {
          const z = ix.zonesById[ix.endpointZone[id]];
          const e = ix.endpointsById[id];
          what = `${z?.name || ""} ${e.displayType === "projector" ? "projector" : "TV"}`.trim();
          where = z ? `${z.name} — TV location` : "(zone removed)"; label = what;
          rank = 3; zi = zoneIx.get(z?.id) ?? 999;
        } else {
          const n = describeNode(job, sol, id);
          what = n.short; where = n.kind === "missing" ? "(removed)" : n.short; label = n.short;
          rank = 2; zi = zoneIx.get(ix.endpointZone[id]) ?? 999;
        }
        const needsPoe = flags(id).includes("poe") && !isSwitch && d?.type !== "controlBox";
        let net = NET_ROLE_NAME[r].split(" ")[0];
        if (isSwitch) net = extra.trunk ? "Trunk · Dante VLAN 99" : r === "lan" || role(d) === "lan" ? "Uplink · house LAN" : "Uplink";
        else if (r === "mxnet" && mxnetDante(id)) net = "MXNet + Dante (VLAN 99)";
        else if (r === "dante" && d?.type === "controlBox") net = "Dante control";
        else if (r === "lan" && d?.type === "controlBox" && [...members].some(([sw, m]) => sw !== lanSw?.id && m.has(id))) net = "LAN (control port)";
        return { id, what, where, label, rank, zi, order, isSwitch, net,
                 power: needsPoe ? (swPoe ? "PoE" : "PoE — injector / PSU") : "" };
      }).sort((a, b) => a.rank - b.rank || a.zi - b.zi || a.order - b.order);

      // uplinks take the SFP cages first (SFP 1 up); everything else fills
      // copper from port 1, then any SFP cages left (with an RJ45 module)
      const copper = Array.from({ length: cap.copper }, (_, i) => String(i + 1));
      const sfp = Array.from({ length: cap.sfp }, (_, i) => `SFP ${i + 1}`);
      const ups = info.filter(n => n.isSwitch), devs = info.filter(n => !n.isSwitch);
      const upPorts = sfp.splice(0, Math.min(ups.length, sfp.length));
      while (upPorts.length < ups.length && copper.length) upPorts.push(copper.pop());
      const devPorts = [...copper, ...sfp.map(p => `${p} (RJ45 module)`)];
      const rows = [];
      const seq = i => sw.virtual ? "—" : String(i + 1);   // no catalog port count: number in order
      devs.forEach((n, i) => rows.push({ ...n, port: known ? devPorts[i] ?? null : seq(i) }));
      ups.forEach((n, i) => rows.push({ ...n, port: known ? upPorts[i] ?? devPorts[devs.length + i] ?? null : seq(devs.length + i) }));
      const total = cap.copper + cap.sfp;
      plans.push({
        solution: sol.id, switch: sw.id, model: sw.model || sw.id, role: r, known, virtual: !!sw.virtual,
        copper: cap.copper, sfp: cap.sfp, used: rows.length,
        spare: known ? Math.max(0, total - rows.length) : null,
        over: known ? Math.max(0, rows.length - total) : 0,
        poeBudgetW: swCat?.poeBudgetW ?? null,
        poeCount: rows.filter(n => n.power === "PoE").length,
        needsInjector: rows.filter(n => n.power.startsWith("PoE —")).length,
        rows,
      });
    }
  }
  return plans;
}

// the setup lines a tech keys into the switch (printed under each port table)
export function switchSetup(plan) {
  if (plan.role === "dante") return ["Energy-Efficient Ethernet (EEE) off on every port", "IGMP snooping on, with a querier", "QoS for Dante: clock CS7, audio EF", "Clock leader = an always-on rack amp, never a TV encoder"];
  if (plan.role === "mxnet" && plan.rows.some(r => r.net.includes("VLAN 99")))
    return ["Ports marked VLAN 99: trunk MXNet (VLAN 100) + Dante (VLAN 99)", "Carry VLAN 99 over the trunk to the Dante switch"];
  if (plan.role === "avb") return ["Avnu-certified AVB switch — AVB/MSRP enabled on every audio port"];
  return [];
}

// the smallest house-LAN switch in the catalog with room for `need` ports + 20% spare
export function suggestLanSwitch(catalog, need) {
  const want = need + Math.max(2, Math.ceil(need * 0.2));
  const opts = Object.entries(catalog?.devices || {})
    .filter(([, c]) => c.type === "networkSwitch" && !(c.flags || []).some(f => f === "mxnet" || f === "legacy" || f === "avb"))
    .map(([ref, c]) => ({ ref, model: `${c.brand ? c.brand + " " : ""}${c.model}`, ports: (c.outputs?.gbe || 0) + (c.outputs?.gbe25 || 0) + (c.outputs?.gbe10 || 0) }))
    .sort((a, b) => a.ports - b.ports);
  return opts.find(o => o.ports >= want) || opts[opts.length - 1] || null;
}
