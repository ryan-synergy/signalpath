/* SignalPath Engine — headless core (Milestone 0)
   Layers: load → validate → advise → place → route → render(SVG)
   Pure functions, no DOM. Spec: ../DESIGN.md (FROZEN 2026-09-17). */

import { describeNode, drivesRooms, adapterName, adapterTag, isOutdoorZone, SIGNAL_SHORT, SCOPE_NAME } from "./names.js";
import { bulletFor, isAtmosRoom, knownRunM, RUN_LIMIT_M } from "./hookup.js";
import { networkPlan, suggestLanSwitch } from "./network.js";
import { powerPlan } from "./power.js";
import { rackPlans } from "./rack.js";
import { audioSetup } from "./audiochain.js";
import { assignPorts } from "./ports.js";
import { KIND_STYLE, deviceKind } from "./kinds.js";

export const SIGNAL_COLORS = {
  video: "#d22b1f",
  audio: "#2b6cb8",
  speaker: "#2b6cb8",
  network: "#2f9e44",
  audioReturn: "#e8842c",
  dante: "#2b6cb8",          // audio blue, dashed: it rides the Dante network, not a line-level run
  prewire: "#a7a7a7",
};

/* B&W-safe line styles: when color can't carry signal identity (office laser
   printers), dash patterns do — video solid, audio dashed, returns dash-dot,
   network dotted, prewire light + short dash */
export const SIGNAL_DASHES = {
  video: { stroke: "#111", dash: null },
  audio: { stroke: "#333", dash: "9 4" },
  speaker: { stroke: "#333", dash: "9 4" },
  audioReturn: { stroke: "#333", dash: "12 4 2.5 4" },
  network: { stroke: "#666", dash: "2 4" },
  dante: { stroke: "#333", dash: "3 3" },
  prewire: { stroke: "#9a9a9a", dash: "5 4" },
};

// color by kind: KIND_STYLE + deviceKind live in kinds.js (the rack page uses them too)
export { KIND_STYLE, deviceKind };
// the colored (or, in B&W, patterned) left edge of a box, inside its rounded corners
function kindEdge(kind, x, y, h, rx, bw) {
  const k = KIND_STYLE[kind];
  if (!k?.edge) return "";
  const w = 5, r = Math.min(rx, 3);
  const shape = `M${x + r} ${y}H${x + w}V${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  if (!bw) return `<path d="${shape}" fill="${k.edge}"/>`;
  const W = "#f0f0f0";
  let s = "";
  switch (k.pattern) {
    case "solid": return `<path d="${shape}" fill="${W}"/>`;
    case "double": return `<rect x="${x + 0.6}" y="${y + 1}" width="1.6" height="${h - 2}" fill="${W}"/><rect x="${x + 3.4}" y="${y + 1}" width="1.6" height="${h - 2}" fill="${W}"/>`;
    case "dash": for (let yy = y + 2; yy + 4 <= y + h - 1; yy += 7) s += `<rect x="${x + 0.6}" y="${yy}" width="4.4" height="4" fill="${W}"/>`; return s;
    case "long": for (let yy = y + 2; yy + 9 <= y + h - 1; yy += 13) s += `<rect x="${x + 0.6}" y="${yy}" width="4.4" height="9" fill="${W}"/>`; return s;
    case "dots": for (let yy = y + 3; yy + 1.3 <= y + h - 1; yy += 4.5) s += `<circle cx="${x + 2.8}" cy="${yy}" r="1.3" fill="${W}"/>`; return s;
    case "rungs": for (let yy = y + 2; yy + 1.4 <= y + h - 1; yy += 4) s += `<rect x="${x + 0.6}" y="${yy}" width="4.4" height="1.4" fill="${W}"/>`; return s;
    case "hatch": for (let yy = y + 5; yy <= y + h - 1; yy += 5) s += `<path d="M${x + 0.6} ${yy}l4.4 -4.4" stroke="${W}" stroke-width="1.2"/>`; return s;
  }
  return "";
}

/* status lights (Ryan 2026-10-01: the amp's lit channel windows, "across the board"):
   a row of small windows, one per jack — lit in the box's color when used, hollow when
   open, gray when reserved; past the cap the last window goes red and "+N" says how far
   over. A big box groups its windows (each one = 2+ jacks) and prints "used/cap". */
const LIGHT_OVER = "#e5484d";
const pipWidth = (cap, rows, maxPer, pitch, w) => { const per = Math.max(1, Math.ceil(cap / (maxPer * rows))); return Math.ceil(Math.ceil(cap / per) / rows) * pitch - (pitch - w); };
// what the lights say in words (hover on screen): "HDMI inputs: 2 of 7 used · 5 open"
const lightsTitle = (what, used, cap, res = 0) => `<title>${what}: ${used} of ${cap} used${res ? ` · ${res} reserved` : ""}${used > cap ? ` · ${used - cap} over` : ` · ${cap - used - res} open`}</title>`;
function pipField(cx, y, { used = 0, cap, res = 0 }, { lit = "#3b82c4", bw = false, rows = 1, maxPer = 12, w = 5, h = 6, pitch = 7, label = "", shape = "rect", what = "" } = {}) {
  if (!(cap > 0)) return "";
  const per = Math.max(1, Math.ceil(cap / (maxPer * rows)));
  const n = Math.ceil(cap / per), perRow = Math.ceil(n / rows);
  const litN = Math.min(n, Math.ceil(used / per)), resN = Math.min(n - litN, Math.ceil(res / per));
  const fw = pipWidth(cap, rows, maxPer, pitch, w), x0 = cx - fw / 2;
  const on = bw ? "#e6e6e6" : lit, over = used > cap;
  let s = "";
  for (let i = 0; i < n; i++) {
    const x = x0 + (i % perRow) * pitch, yy = y + Math.floor(i / perRow) * (h + 2);
    const st = i < litN ? (over && i === n - 1 ? "over" : "on") : i < litN + resN ? "res" : "open";
    const fill = st === "over" ? (bw ? "#fff" : LIGHT_OVER) : st === "on" ? on : st === "res" ? "#8c8c8c" : "none";
    const stroke = st === "open" ? ` stroke="#6e6e6e" stroke-width="0.8"` : "";
    s += shape === "jack" ? `<circle cx="${x + w / 2}" cy="${yy + h / 2}" r="${w / 2}" fill="${fill}"${stroke}/>`
       : `<rect x="${x}" y="${yy}" width="${w}" height="${h}" rx="${shape === "outlet" ? 1.2 : 0.6}" fill="${fill}"${stroke}/>`;
  }
  const tail = over ? `+${used - cap}` : per > 1 ? `${used}/${cap}` : "";
  if (tail) s += `<text x="${x0 + fw + 3}" y="${y + h - 0.5}" font-size="7" fill="${over && !bw ? LIGHT_OVER : "#aab"}">${tail}</text>`;
  if (label) s += `<text x="${x0 - 3}" y="${y + h - 0.5}" text-anchor="end" font-size="6.5" letter-spacing=".3" fill="#8a8f98">${label}</text>`;
  return what ? `<g class="lights">${lightsTitle(what, used, cap, res)}${s}</g>` : s;
}

/* what each rack box has in use against what it has (the lights above) — the advisor's own
   counts: switch ports from the port plan, outlets from the power plan (filled WattBox by
   WattBox in rack order), HDMI ins/outs on matrices and receivers, jacks on Savant modules */
export function boxUsage(job, ix, catalog, advice, solIndex = 0) {
  const s = ix.solutions[solIndex], out = {};
  if (!s) return out;
  const sol = s.sol, conns = sol.connections || [];
  const catOf = d => catalog?.devices?.[d.catalogRef] || job.job?.catalogSnapshot?.devices?.[d.catalogRef] || null;
  const runs = list => list.reduce((n, c) => n + trunkCount(c, s), 0);
  for (const d of Object.values(s.devices)) {
    const c = catOf(d) || {}, u = {};
    const inb = conns.filter(k => k.to === d.id && !k.dante), outb = conns.filter(k => k.from === d.id && !k.dante);
    const videoIn = inb.filter(k => k.signal === "video" || (k.signal === "audioReturn" && k.earcKit)).length;
    // a box with no product picked can carry typed-in counts (GEAR: "HDMI in" / "HDMI out")
    const typed = k => { const n = Math.floor(+d[k]); return n > 0 && n <= 64 ? n : null; };
    if (d.type === "videoMatrix" || d.type === "splitter") {
      const ci = c.inputs?.hdmi ?? typed("hdmiIn");
      if (ci) u.in = { used: videoIn, cap: ci };
      const co = c.outputs?.hdmi ?? d.io?.out ?? typed("hdmiOut");
      if (co) u.out = { used: outb.filter(k => k.signal === "video").length, cap: co };
    } else if (d.type === "avr") {
      if (c.inputs?.hdmi) u.in = { used: videoIn, cap: c.inputs.hdmi };
    } else if (d.type === "audioInputModule") {
      const cap = (c.inputs?.analog || 0) + (c.inputs?.coax || 0) + (c.inputs?.optical || 0) + (c.inputs?.digitalCombo || 0);
      if (cap) u.jacks = { used: runs(inb.filter(k => k.signal === "audio")) + inb.filter(k => k.signal === "audioReturn" && !k.earcKit).length, cap };
    } else if (d.type === "audioOutputModule") {
      if (c.outputs?.analog) u.jacks = { used: runs(outb.filter(k => k.signal === "audio")), cap: c.outputs.analog };
    }
    if (Object.keys(u).length) out[d.id] = u;
  }
  for (const p of advice?.network || []) {
    if (p.solution !== sol.id || !s.devices[p.switch] || !p.known) continue;
    (out[p.switch] ||= {}).ports = { used: p.used, cap: (p.copper || 0) + (p.sfp || 0) };
  }
  // one power plan per rack: the load splits across that rack's WattBoxes the way an
  // installer balances circuits (by size); a shortfall lands on the last one and lights red
  for (const pw of (advice?.power || []).filter(p => p.solution === sol.id)) {
    const units = (pw.units || []).filter(u => u.outlets > 0 && s.devices[u.id]);
    const need = pw.need || 0, supply = units.reduce((n, u) => n + u.outlets, 0);
    let left = need;
    units.forEach((u, i) => {
      const n = i === units.length - 1 ? left : Math.min(left, Math.round(Math.min(need, supply) * u.outlets / supply));
      (out[u.id] ||= {}).outlets = { used: n, cap: u.outlets };
      left -= n;
    });
  }
  return out;
}

export const REMOTE_LABELS = { savant: "SAVANT", appletv: "ATV", josh: "JOSH", factory: "OEM" };

// amp zones a speaker feed takes: a stereo pair is one; a surround set on a
// multi-zone amp spans its channels ("1-8" = 4 zones)
export const feedZones = f => { const n = expandChannels(f.channels).length; return n > 2 ? Math.ceil(n / 2) : 1; };

export const READABILITY_ZONE_CEILING = 24; // one 11x17 page, per spec §"Readability budget"

/* ---------- load & index ---------- */

export function loadJob(raw) {
  const job = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (job.generator !== "SignalPath") throw new Error("not a SignalPath file (generator)");
  if (job.schemaVersion !== 1) throw new Error("unsupported schemaVersion " + job.schemaVersion);
  normalizeJob(job);
  const ix = indexJob(job);
  return { job, ix };
}

/* Fill the gaps an older, partial or hand-edited job can have, so every page
   draws instead of throwing or printing "undefined": missing lists become
   empty, list holes drop out, an unnamed zone or rack gets a plain name.
   Only fills — never changes a value that's there. */
export function normalizeJob(job) {
  const list = (o, k) => { o[k] = Array.isArray(o[k]) ? o[k].filter(x => x && typeof x === "object") : []; return o[k]; };
  if (!job.job || typeof job.job !== "object") job.job = {};
  if (typeof job.job.name !== "string") job.job.name = job.job.name == null || typeof job.job.name === "object" ? "Untitled job" : String(job.job.name);
  if (job.job.client != null && typeof job.job.client !== "object") job.job.client = { name: String(job.job.client) };
  for (const k of ["name", "address"]) if (job.job.client && job.job.client[k] != null && typeof job.job.client[k] === "object") delete job.job.client[k];
  for (const k of ["stage", "trunkStyle", "danteStyle", "drawnBy"]) if (job.job[k] != null && typeof job.job[k] !== "string") delete job.job[k];
  // the Auto rack limit (Rack tab): whole U, 8–60
  if (job.job.autoRackMax != null) { const n = Math.floor(+job.job.autoRackMax); if (n >= 8 && n <= 60) job.job.autoRackMax = n; else delete job.job.autoRackMax; }
  // the title block prints each revision's rev / date / description / by — plain values only
  list(job.job, "revisions").forEach(r => { for (const k of Object.keys(r)) if (r[k] != null && typeof r[k] === "object") delete r[k]; });
  if (!job.house || typeof job.house !== "object") job.house = {};
  // plain-value fields that arrive as a list or object print "[object Object]" everywhere — drop them
  const SCALAR = ["name", "type", "size", "count", "satCount", "channels", "brand", "model", "config", "status", "scope", "displayType", "signal", "units", "partNo",
                  "rackUnits", "powerTypicalW", "powerMaxW", "outlets", "switchPorts", "hdmiIn", "hdmiOut"];
  // …and text fields that arrive as a number or true/false ("config": 12, "stage": 1) would throw at the first
  // .startsWith / .toLowerCase — they become text (hardening pass 2026-10-02: 3,000 mutated jobs)
  const TEXT = new Set(["name", "type", "brand", "model", "config", "status", "scope", "displayType", "signal", "channels", "partNo", "sourceType", "area", "zone", "catalogRef", "serves", "from", "to", "homeRack"]);
  const scalars = o => { for (const k of SCALAR) if (o[k] != null && typeof o[k] === "object") delete o[k];
    for (const k of TEXT) if (typeof o[k] === "number" || typeof o[k] === "boolean") o[k] = String(o[k]); };
  list(job.house, "areas").forEach((a, i) => { scalars(a); if (typeof a.name !== "string" || !a.name.trim()) a.name = `Area ${i + 1}`; });
  list(job.house, "zones").forEach((z, i) => {
    scalars(z);
    if (typeof z.name !== "string" || !z.name.trim()) z.name = `Zone ${i + 1}`;
    list(z, "endpoints").forEach(e => {
      scalars(e);
      // "confirm" is a list of what to check ("size"); one word or junk becomes a list or goes
      if (typeof e.confirm === "string") e.confirm = [e.confirm];
      if (e.confirm != null) { e.confirm = Array.isArray(e.confirm) ? e.confirm.filter(x => typeof x === "string") : []; if (!e.confirm.length) delete e.confirm; }
    });
  });
  list(job, "solutions");
  if (!job.solutions.length) job.solutions.push({ id: "sol-1", name: "Solution 1" });
  for (const sol of job.solutions) {
    if (typeof sol.name !== "string") sol.name = sol.name == null || typeof sol.name === "object" ? "" : String(sol.name);
    sol.platforms = Array.isArray(sol.platforms) ? sol.platforms.filter(x => typeof x === "string") : [];
    if (sol.audioNetwork != null && typeof sol.audioNetwork !== "string") delete sol.audioNetwork;
    for (const k of ["racks", "localDevices", "companions", "connections", "annotations"]) list(sol, k);
    // how a PoE box on a switch that can't power it gets power: { box id: "injector" | "psu" }
    if (sol.poePower != null) { if (typeof sol.poePower !== "object" || Array.isArray(sol.poePower)) delete sol.poePower;
      else for (const [k, v] of Object.entries(sol.poePower)) if (!["injector", "psu"].includes(v)) delete sol.poePower[k]; }
    sol.racks.forEach((r, i) => { scalars(r); if (typeof r.name !== "string" || !r.name.trim()) r.name = i ? `Rack ${i + 1}` : "Equipment Rack"; list(r, "devices").forEach(scalars);
      // the space it has to fit (inches) and the rack picked for it
      if (r.space != null) { if (typeof r.space !== "object" || Array.isArray(r.space)) delete r.space;
        else for (const k of Object.keys(r.space)) { const v = +r.space[k]; if (!["h", "w", "d"].includes(k) || !(v > 0 && v < 400)) delete r.space[k]; else r.space[k] = v; } }
      if (r.rackModel != null && typeof r.rackModel !== "string") delete r.rackModel;
      if (r.tight != null) r.tight = r.tight === true;
      if (r.sizeMode != null && !["space", "auto", "model", "units"].includes(r.sizeMode)) delete r.sizeMode;
      if (r.casters != null) r.casters = r.casters !== false;
      if (r.locked != null) r.locked = r.locked === true;
      if (r.autoOf != null && (typeof r.autoOf !== "string" || !sol.racks.some(x => x.id === r.autoOf && x !== r))) delete r.autoOf;
      if (r.beside != null && (typeof r.beside !== "string" || !sol.racks.some(x => x.id === r.beside && x !== r))) delete r.beside;
      // a rack arranged by hand on the rack page: { key: row from the top } — whole rows only
      if (r.layout != null) {
        if (typeof r.layout !== "object" || Array.isArray(r.layout)) delete r.layout;
        else for (const [k, v] of Object.entries(r.layout)) if (!Number.isInteger(v) || v < 0 || v > 120) delete r.layout[k];
      } });
    for (const k of ["localDevices", "companions", "connections"]) sol[k].forEach(scalars);
    sol.connections = sol.connections.filter(c => c.from != null && c.to != null);
  }
  return job;
}

export function indexJob(job) {
  const ix = { zonesById: {}, endpointsById: {}, endpointZone: {}, devicesById: {}, deviceRack: {}, solutions: [] };
  for (const z of job.house.zones) {
    ix.zonesById[z.id] = z;
    for (const e of z.endpoints || []) {
      ix.endpointsById[e.id] = e;
      ix.endpointZone[e.id] = z.id;
    }
  }
  for (const sol of job.solutions || []) {
    const s = { sol, devices: {}, companions: {}, locals: {} };
    for (const r of sol.racks || []) for (const d of r.devices || []) { s.devices[d.id] = d; ix.deviceRack[d.id] = r.id; }
    for (const d of sol.localDevices || []) s.locals[d.id] = d;
    for (const c of sol.companions || []) s.companions[c.id] = c;
    ix.solutions.push(s);
  }
  return ix;
}

const nodeInSolution = (s, ix, id) =>
  s.devices[id] || s.companions[id] || s.locals[id] || ix.endpointsById[id] || null;

/* ---------- per-solution endpoint overrides ----------
   A solution may reinterpret House zones/endpoints without forking them:
   sol.overrides = { zones: {zid: patch}, endpoints: {eid: patch} }.
   Patches are sparse field sets; ids and endpoint existence stay House-owned. */

export function effectiveHouse(house, sol) {
  const ov = sol?.overrides;
  if (!ov || (!Object.keys(ov.zones || {}).length && !Object.keys(ov.endpoints || {}).length)) return house;
  const patch = (obj, p) => {
    if (!p) return obj;
    const { id, endpoints, ...rest } = p;
    const out = { ...obj, ...rest };
    if (Array.isArray(out.confirm) && out.confirm.length) {   // an override answers its own confirm flag
      out.confirm = out.confirm.filter(f => !(f in rest));
      if (!out.confirm.length) delete out.confirm;
    }
    return out;
  };
  return {
    ...house,
    zones: house.zones.map(z => {
      const zp = (ov.zones || {})[z.id];
      const eps = (z.endpoints || []).map(e => patch(e, (ov.endpoints || {})[e.id]));
      if (!zp && eps.every((e, i) => e === z.endpoints[i])) return z;
      return { ...patch(z, zp), endpoints: eps };
    }),
  };
}

export function effectiveJob(job, solIndex = 0) {
  const h = effectiveHouse(job.house, (job.solutions || [])[solIndex]);
  return h === job.house ? job : { ...job, house: h };
}

/* ---------- trunk runs ----------
   A module→amp audio trunk is drawn once but IS one analog run per zone the
   amp feeds — that count is derived truth, not authored. An explicit
   conn.count still wins when larger (e.g. pre-wired spare runs). */
/* ---------- catalog auto-link ----------
   Fill missing catalogRefs by matching device models to catalog entries.
   Deliberately conservative: exact normalized matches (plus 8K/4K-suffix
   tolerance and known aliases) with matching type — never fuzzy prefixes,
   which would happily link an Axion 8 to an AC-MX-88. Existing refs are
   never touched, even stale ones (they carry the author's intent). */
export function autoLinkCatalog(job, catalog) {
  const devs = catalog?.devices;
  if (!devs) return 0;
  const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const keys = {};
  for (const [id, c] of Object.entries(devs)) {
    // aliases: the names an entry had before it took PlanQueue's (older jobs still say "MRX 540 8K").
    // A name alone links only when it's specific (has a model number): PlanQueue's short names —
    // "Amp", "Ultra", "APPLE TV 4K" — must not grab a generic "Amp" or "Apple TV" (brand + name still does)
    const specific = k => /\d/.test(k) && k.length >= 4;
    for (const m of [c.model, ...(c.aliases || [])]) {
      const full = norm((c.brand || "") + m), bare = norm(m), strip = k => k.replace(/(8k|4k)$/, "");
      for (const k of new Set([full, strip(full)])) if (k) (keys[k] ||= new Set()).add(id);
      for (const k of new Set([bare, strip(bare)])) if (specific(k)) (keys[k] ||= new Set()).add(id);
    }
  }
  const ALIAS = { savantinputmodule: "savant-avb-input-module", savantavbinputmodule: "savant-avb-input-module",
                  savantoutputmodule: "savant-avb-output-module", savantavboutputmodule: "savant-avb-output-module" };
  let n = 0;
  for (const sol of job.solutions || []) for (const r of sol.racks || []) for (const d of r.devices || []) {
    if (d.catalogRef) continue;
    const k = norm(d.model);
    const hit = keys[k];
    const id = (ALIAS[k] && devs[ALIAS[k]] && ALIAS[k]) || (hit?.size === 1 ? [...hit][0] : null);
    if (id && devs[id].type === d.type) { d.catalogRef = id; n++; }
  }
  return n;
}

/* ---------- catalog lockfile ----------
   A job freezes the catalog entries its gear uses the first time it saves them,
   so a quote advises the same way next month even if Settings change. Newer
   catalog data never slips in silently: catalogDrift() reports it, and
   refreshCatalogLock() pulls it in on the user's say-so. */
const usedRefs = job => {
  const refs = new Set();
  for (const sol of job.solutions || []) {
    for (const r of sol.racks || []) for (const d of r.devices || []) if (d.catalogRef) refs.add(d.catalogRef);
    for (const d of sol.localDevices || []) if (d.catalogRef) refs.add(d.catalogRef);
  }
  return refs;
};
export function lockCatalog(job, catalog) {
  const snap = job.job.catalogSnapshot || {};
  const prev = snap.devices || {};
  const devices = {};
  for (const ref of usedRefs(job)) {
    const entry = prev[ref] || catalog?.devices?.[ref];     // first lock wins; later saves never overwrite it
    if (entry) devices[ref] = entry;
  }
  job.job.catalogSnapshot = { asOf: snap.asOf || catalog?.asOf, ...(Object.keys(devices).length ? { devices } : {}) };
  return job.job.catalogSnapshot;
}
export function catalogDrift(job, catalog) {
  const prev = job.job?.catalogSnapshot?.devices || {};
  const drift = [];
  for (const ref of usedRefs(job)) {
    const live = catalog?.devices?.[ref];
    if (prev[ref] && live && JSON.stringify(prev[ref]) !== JSON.stringify(live)) drift.push({ ref, model: live.model || ref });
  }
  return drift;
}
export function refreshCatalogLock(job, catalog) {
  const devices = {};
  for (const ref of usedRefs(job)) if (catalog?.devices?.[ref]) devices[ref] = structuredClone(catalog.devices[ref]);
  job.job.catalogSnapshot = { asOf: catalog?.asOf || job.job.catalogSnapshot?.asOf, ...(Object.keys(devices).length ? { devices } : {}) };
  return job.job.catalogSnapshot;
}

export function trunkCount(conn, s) {
  const from = s.devices[conn.from], to = s.devices[conn.to];
  const authored = c => Math.max(0, Math.floor(+c.count) || 0);   // imported "4" / -3 must not skew budgets
  if (!(conn.signal === "audio" && from?.type === "audioOutputModule" && to?.type === "amp"))
    return authored(conn) || 1;
  const conns = s.sol.connections || [];
  const derived = conns.filter(c => c.from === conn.to && c.signal === "speaker").length;
  // several modules can share one amp: the amp's zone count is the TOTAL runs
  // across all its trunks, split between them — each trunk claiming every
  // zone double-counted the amp's inputs
  const trunks = conns.filter(c => c.to === conn.to && c.signal === "audio" && s.devices[c.from]?.type === "audioOutputModule");
  if (trunks.length <= 1) return Math.max(authored(conn), derived) || 1;
  if (authored(conn)) return authored(conn);
  const unset = trunks.filter(c => !authored(c));
  const remaining = Math.max(0, derived - trunks.reduce((n, c) => n + authored(c), 0));
  const i = unset.indexOf(conn);
  return Math.floor(remaining / unset.length) + (i < remaining % unset.length ? 1 : 0) || 1;
}

/* ---------- validate ---------- */

export function validate(job, ix = indexJob(job)) {
  const errors = [], warnings = [];
  // messages are for people (names from names.js); the raw id rides along
  // as `ref` for code and tests
  const E = (code, msg, ref) => errors.push({ code, msg, ...(ref != null ? { ref } : {}) });
  const W = (code, msg, ref) => warnings.push({ code, msg, ...(ref != null ? { ref } : {}) });
  const zName = zid => ix.zonesById[zid]?.name || zid;

  // unique ids across zones/endpoints
  const seen = new Set();
  const uniq = (id, kind) => { if (seen.has(id)) E("dup-id", `Two ${kind}s share the id "${id}" — each needs its own (re-import or rename)`, id); seen.add(id); };
  job.house.zones.forEach(z => { uniq(z.id, "zone"); (z.endpoints || []).forEach(e => uniq(e.id, "endpoint")); });

  // duplicate zone names -> soft warn (spec: allowed, warned)
  const names = {};
  job.house.zones.forEach(z => { names[z.name] = (names[z.name] || 0) + 1; });
  Object.entries(names).filter(([, n]) => n > 1)
    .forEach(([n]) => W("dup-zone-name", `${names[n]} rooms are named "${n}" — give each its own name`));

  // areas / homeRack refs
  const areaIds = new Set((job.house.areas || []).map(a => a.id));
  job.house.zones.forEach(z => { if (z.area && !areaIds.has(z.area)) E("bad-area", `${z.name} is assigned to an area that no longer exists`, z.id); });

  // confirm flags roll-up (info-level warning: Needs Confirmation box)
  job.house.zones.forEach(z => (z.endpoints || []).forEach(e => {
    if (e.confirm?.length) W("confirm", `${z.name}: confirm ${e.confirm.join(", ")} on the ${e.type === "display" ? (e.displayType === "projector" ? "projector" : "TV") : e.type}`, e.id);
  }));

  for (const s of ix.solutions) {
    const sol = s.sol;
    // per-solution findings carry the solution id: the editor validates the
    // ACTIVE solution's effective house, so a sibling's scope checks would read
    // the wrong overrides — the UI shows only the active solution's entries
    const E = (code, msg, ref) => errors.push({ code, msg, solution: sol.id, ...(ref != null ? { ref } : {}) });
    const W = (code, msg, ref) => warnings.push({ code, msg, solution: sol.id, ...(ref != null ? { ref } : {}) });
    const nm = id => describeNode(job, sol, id).short;
    // overrides must point at real House objects (stale after a zone/endpoint delete)
    for (const zid of Object.keys(sol.overrides?.zones || {}))
      if (!ix.zonesById[zid]) W("stale-override", `${sol.name || sol.id}: has a change saved for a zone that no longer exists`, zid);
    for (const eid of Object.keys(sol.overrides?.endpoints || {}))
      if (!ix.endpointsById[eid]) W("stale-override", `${sol.name || sol.id}: has a change saved for a TV or speaker set that no longer exists`, eid);
    // device ids are per-solution namespaces: unique within the solution and vs the House,
    // but sibling solutions may reuse ids (duplicate-as-new clones the gear set).
    // Walk the RAW arrays — the index maps already collapsed duplicates.
    const seenSol = new Set(seen);
    const solIds = [...(sol.racks || []).flatMap(r => (r.devices || []).map(d => d.id)),
      ...(sol.companions || []).map(c => c.id), ...(sol.localDevices || []).map(d => d.id)];
    solIds.forEach(id => { if (seenSol.has(id)) E("dup-id", `Two pieces of gear share the id "${id}" — each needs its own`, id); seenSol.add(id); });
    // a note with no `near` is a general sheet note (legend only, legitimately
    // unanchored); one that NAMES a zone that's gone lost its keynote marker
    for (const a of sol.annotations || [])
      if (a?.near != null && !ix.zonesById[a.near]) W("bad-annotation", `Note "${String(a.text || "").slice(0, 40)}" points at a zone that no longer exists`, a.near);

    // companions serve real things
    for (const c of sol.companions || []) {
      if (!nodeInSolution(s, ix, c.serves)) E("bad-serves", `${adapterName(c)} is attached to gear that no longer exists`, c.id);
    }
    // local devices reference real zones
    for (const d of sol.localDevices || []) {
      if (!ix.zonesById[d.zone]) E("bad-zone-ref", `${d.model || d.id} is placed in a zone that no longer exists`, d.id);
    }

    // connection endpoints exist
    for (const c of sol.connections || []) {
      if (!nodeInSolution(s, ix, c.from)) E("bad-conn", `A connection to ${nm(c.to)} starts at gear that no longer exists`, c.from);
      if (!nodeInSolution(s, ix, c.to)) E("bad-conn", `A connection from ${nm(c.from)} goes to gear that no longer exists`, c.to);
      if (!SIGNAL_COLORS[c.signal]) E("bad-signal", `${nm(c.from)} → ${nm(c.to)}: ${c.signal ? `unknown signal "${c.signal}"` : "no signal type set"}`, `${c.from}→${c.to}`);
      // a custom-route hint that names vanished devices is stale, not fatal
      if (c.routeHint?.between && !(Array.isArray(c.routeHint.between) && c.routeHint.between.every(id => s.devices[id])))
        W("route-hint-stale", `${nm(c.from)} → ${nm(c.to)}: its hand-drawn path went past gear that's gone — drawn automatically again`, `${c.from}→${c.to}`);
    }

    // orphan endpoints: every endpoint must be fed (be `to` of >=1 edge) —
    // except a display sharing its zone with an at-display local source: the
    // puck inside the card IS the feed, no wire needed (guest-room Apple TV)
    const fed = new Set((sol.connections || []).map(c => c.to));
    const localFedZones = new Set(Object.values(s.locals)
      .filter(d => d.type === "source" && d.location === "at-display").map(d => d.zone));
    // a future room needs nothing yet; a pre-wire room is rough-in — fine with no gear on the job yet
    // (the "Prewire only" kit), a warning once there is gear its cables could home-run to
    const rackGear = Object.keys(s.devices).length > 0;
    for (const eid of Object.keys(ix.endpointsById)) {
      if (fed.has(eid)) continue;
      if (ix.endpointsById[eid].type === "display" && localFedZones.has(ix.endpointZone[eid])) continue;
      if (ix.endpointsById[eid].ownApps) continue;          // "apps": the TV plays its own apps, left off the rack on purpose
      const scope = ix.zonesById[ix.endpointZone[eid]]?.scope || "included";
      if (scope === "future" || (scope === "prewire" && !rackGear)) continue;
      if (scope === "prewire") { W("orphan-endpoint", `${nm(eid)} (pre-wire) isn't wired to the rack yet — its cable has no home run`, eid); continue; }
      E("orphan-endpoint", `${nm(eid)} has nothing feeding it — add a connection`, eid);
    }
    // a TV whose only feed is its decoder / balun, and nothing feeds that (its switch or receiver was deleted,
    // or the wire into it re-pointed): as dark as an unwired TV — say so (2026-10-03 hammer: every room stayed green)
    const compIns = id => (sol.connections || []).some(c => c.to === id && c.signal !== "network");
    for (const eid of Object.keys(ix.endpointsById)) {
      if (ix.endpointsById[eid].type !== "display" || !fed.has(eid)) continue;
      const feeds = (sol.connections || []).filter(c => c.to === eid && c.signal === "video");
      if (!feeds.length) continue;
      const dead = feeds.every(c => { const k = (sol.companions || []).find(x => x.id === c.from); return k && !compIns(k.id); });
      const scope = ix.zonesById[ix.endpointZone[eid]]?.scope || "included";
      if (dead && scope !== "future") E("orphan-endpoint", `${nm(eid)} has nothing feeding it — its ${adapterName((sol.companions || []).find(x => x.id === feeds[0].from))} isn't connected to anything`, eid);
    }
    // sources should feed something
    // (a network link counts from either end: a music server on the AVB / Dante network IS connected)
    const used = new Set((sol.connections || []).flatMap(c => c.signal === "network" ? [c.from, c.to] : [c.from]));
    for (const d of Object.values(s.devices)) {
      if (d.type === "source" && !used.has(d.id)) W("unused-source", `${d.model || d.id} isn't connected to anything`, d.id);
    }
    // an amp, receiver or matrix that drives speakers/TVs with nothing plugged
    // into it plays silence (Cat6 control links don't count; Dante does)
    const fedIn = new Set((sol.connections || []).filter(c => c.signal !== "network").map(c => c.to));
    for (const d of Object.values(s.devices)) {
      if (!["amp", "avr", "videoMatrix", "splitter"].includes(d.type) || fedIn.has(d.id)) continue;
      if (/sonos/i.test(`${d.catalogRef || ""} ${d.model || ""}`)) continue;   // a Sonos Amp streams its own music over the network
      const drives = (sol.connections || []).filter(c => c.from === d.id && c.signal !== "network");
      if (drives.length) W("no-input", `${d.model || d.id} has nothing plugged in — ${drives.length === 1 ? nm(drives[0].to) : `its ${drives.length} rooms`} will have no sound. Connect a source${d.type === "amp" ? " or an audio feed" : ""}`, d.id);
    }

    // amp channel collisions + zone capacity
    const byAmp = {};
    for (const c of sol.connections || []) {
      if (c.signal === "speaker" && s.devices[c.from]) (byAmp[c.from] ||= []).push(c);
    }
    for (const [ampId, feeds] of Object.entries(byAmp)) {
      const amp = s.devices[ampId];
      const taken = {};
      for (const f of feeds) {
        for (const ch of expandChannels(f.channels)) {
          if (taken[ch]) E("ch-collision", `${nm(ampId)} output ${ch} is assigned twice — ${nm(taken[ch])} and ${nm(f.to)}`, ampId);
          taken[ch] = f.to;
        }
      }
      const zonesUsed = feeds.reduce((n, f) => n + feedZones(f), 0);
      if (amp?.zones && zonesUsed > amp.zones) {
        // name the rooms that don't fit: on outputs past the last pair, else the last ones added (2026-10-03 hammer)
        const past = feeds.filter(f => expandChannels(f.channels).some(ch => ch > amp.zones * 2));
        const over = (past.length ? past : feeds.slice(-(zonesUsed - amp.zones))).map(f => nm(f.to).replace(/ speakers$/, ""));
        E("amp-over", `${nm(ampId)} has ${amp.zones} zones but ${zonesUsed} are needed — move ${over.join(", ")} to another amp`, ampId);
      }
    }

    // a local return encoder with no backhaul is a silently dead return in the field
    for (const c of sol.connections || []) {
      if (c.signal === "audioReturn" && s.locals[c.to] &&
          !(sol.connections || []).some(o => o.from === c.to && s.devices[o.to]))
        W("return-no-backhaul", `${nm(c.to)}: the TV's sound has no way back to the rack`, c.to);
    }

    // scope coherence: prewire/future zone endpoints should have matching-scope feeds
    for (const c of sol.connections || []) {
      const zid = ix.endpointZone[c.to];
      if (!zid) continue;
      const zScope = sol.overrides?.zones?.[zid]?.scope || ix.zonesById[zid].scope || "included";
      const cScope = c.scope || "included";
      if (zScope !== "included" && cScope === "included")
        W("scope-mismatch", `${zName(zid)} is ${SCOPE_NAME[zScope] || zScope}, but the wire to ${nm(c.to)} is still Included`, c.to);
      else if (zScope === "included" && cScope !== "included" && !(c.count > 1))   // (a counted spare run may be pre-wire on purpose)
        W("scope-mismatch", `${zName(zid)} is Included, but the wire to ${nm(c.to)} is still ${SCOPE_NAME[cScope] || cScope} — it won't be installed`, c.to);
    }
  }

  // readability budget
  const zoneCount = job.house.zones.length;
  if (zoneCount > READABILITY_ZONE_CEILING)
    W("readability", `${zoneCount} rooms on one sheet (about ${READABILITY_ZONE_CEILING} fit well) — the drawing will print small. View → A sheet per rack can split it`);

  return { errors, warnings, ok: errors.length === 0 };
}

export function expandChannels(spec) {
  if (spec == null) return [];
  const out = [];
  for (const part of String(spec).split(",")) {
    const m = part.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
    if (!m) continue;
    const a = +m[1], b = m[2] ? +m[2] : a;
    if (b - a > 256) continue;                 // a typo'd "1-10000000" must not build a ten-million list
    for (let i = a; i <= b; i++) out.push(i);
  }
  return out;
}

/* ---------- place ----------
   Pure geometry: job → tile coordinates. Zero routing here — wires are the
   route layer's job; place() only reserves the corridors they will need.
   Global convention (spec §4, binding): racks stack in a LEFT column; video
   zones ride the TOP band; audio-only zones fill right/bottom-right.
   Coordinates are "drawing space" — same nominal units as the mocks
   (sheet 1632×1056). render() scales the drawing to fit the content field. */

export const SHEET = {
  width: 1632, height: 1056,
  outerFrame: { x: 10, y: 10, w: 1612, h: 1036 },
  content: { x: 16, y: 16, w: 1444, h: 1024 },
  titleBlock: { x: 1460, y: 16, w: 162, h: 1024 },
};

const PL = {
  marginX: 50, topY: 60, areaHeaderY: 46,
  cardTitleH: 36, cardPad: 25, cardGapX: 20, rowGapY: 24, cardBottomPad: 24,
  cardMinW: 130, cardMinH: 140, groupGapX: 30, captionH: 18,
  videoRowGapY: 88, // wrapped video rows: chip strip (38) + feed lanes below each card
  areaGapX: 80, secondaryClusterMaxW: 700,
  colA: 80, colB: 260, colC: 470,                 // rack device columns (absolute, aligned across racks)
  smallTile: { w: 100, h: 22, pitch: 70 },
  chassisTile: { w: 150, h: 64, pitch: 84 },
  ampTile: { w: 170, h: 84, pitch: 104 },
  rackPadTop: 50, rackPadBottom: 30, rackGapY: 30,
  chip: { w: 54, h: 18 },
  lanePitch: 14, corridorQuantum: 56, topCorridorMin: 120, rightCorridorMin: 90,
  legendRowW: 140, legendH: 56, legendEqH: 24, legendEqW: 122,
  growMax: 1.6,                                   // how far a small job's drawing may grow to fill the sheet
};

// column grid cell for a band: the 75th-percentile card width (wider cards span cells)
const gridCell = ws => { const a = [...ws].sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) * 0.75)] : 0; };

const SPK = 32, SPK_PITCH = 34; // speaker icon diameter / center pitch

function speakerGroupSize(ep, gs = 1) {
  const sz = r => ({ ...r, w: Math.round(r.w * gs), h: Math.round(r.h * gs) });   // glyph scale (TVs + speakers 25% bigger, 2026-10-01)
  const cfg = ep.config || "stereo";
  const cap = s => (ep.status === "ofe" ? "OFE " : "") + s;
  if (cfg === "mono") return sz({ w: SPK, h: SPK, caption: cap("1 Speaker") });
  if (cfg === "2.1" || cfg === "stereo-2.1") return sz({ w: SPK_PITCH * 3 - 2, h: SPK, caption: cap("2.1 Speakers") });
  if (cfg === "surround-5.1") return sz({ w: SPK_PITCH * 3 - 2, h: 70, caption: cap("5.1 Surround") });
  if (cfg === "surround-7.1" || cfg === "surround-7.1.4") return sz({ w: SPK_PITCH * 4 - 2, h: 70, caption: cap(cfg.slice(9) + " Surround") });
  if (cfg.startsWith("soundbar")) return sz({ w: 90, h: SPK, caption: cap(cfg === "soundbar-sub" ? "Soundbar + Sub" : "Soundbar") });
  if (cfg === "landscape") {
    const sats = satCount(ep), subs = ep.buriedSub ? 1 : 0;
    return sz({ w: sats * 26 + subs * 34, h: SPK, caption: cap(`Landscape ${sats}${subs ? "+" + subs : ""}`) });
  }
  const n = spkCount(ep);
  return sz({ w: SPK_PITCH * n - 2, h: SPK, caption: cap(`${n} Speakers`) });
}
// a typed "-1" or "1.5" in the Count field must not become Array(-1)
const spkCount = ep => Math.min(24, Math.max(1, Math.floor(+ep?.count) || 2));
const satCount = ep => Math.min(24, Math.max(1, Math.floor(+ep?.satCount) || 4));

function displaySize(ep, gs = 1) {
  // the card draws a sane size whatever was typed or imported: a "6500" typo
  // once drew a 10,000-unit card and the router ran the tab out of memory
  const typed = +ep.size, inches = Number.isFinite(typed) && typed > 0 ? typed : 55;
  const drawn = Math.min(220, Math.max(24, inches));
  const w = Math.round(drawn * 1.6 * gs), h = Math.round(w * 0.567);
  const brand = [ep.status === "ofe" ? "OFE" : "New", ep.brand].filter(Boolean).join(" ");
  return { w, h, caption: ep.displayType === "projector" ? "Projector" : "TV", brand, sizeText: `${inches}"` };
}

/* Card geometry: groups run left→right [speakers, display]; a local
   "at-display" source sits under the display footprint (the touch-the-TV
   exception renders from this slot). Card sizes to contents (compactness rule). */
function zoneCard(zone, localsInZone, hasNote = false, gs = 1) {
  const groups = [];
  for (const ep of zone.endpoints || []) {
    if (ep.type === "speakers") groups.push({ epId: ep.id, kind: "speakers", ...speakerGroupSize(ep, gs) });
  }
  for (const ep of zone.endpoints || []) {
    if (ep.type === "display") groups.push({ epId: ep.id, kind: "display", ...displaySize(ep, gs) });
  }
  // audio-only cards (speaker pair, no display, no pucks) size to content —
  // the TV-card minimums left them mostly air (user redline). They grow back
  // the moment a display or local device moves in.
  const compact = !groups.some(g => g.kind === "display") && !localsInZone.length;
  const pad = compact ? 14 : PL.cardPad;
  const titleH = compact ? 28 : PL.cardTitleH;
  // at-display locals seat under ONE host group: the first display, else the
  // speaker group (a Sonos amp in a TV-less room), else a bare slot — every
  // local gets exactly one puck, or its wires have nowhere to start
  let host = groups.find(g => g.kind === "display") || groups[groups.length - 1];
  if (localsInZone.length && !host) groups.push(host = { epId: null, kind: "host", w: PL.smallTile.w, h: 0, caption: "" });
  let x = pad, contentBottom = 0;
  for (const g of groups) {
    g.x = x; g.y = titleH;
    g.cx = x + g.w / 2;
    let bottom = g.y + g.h;
    if (g === host && localsInZone.length) {
      // at-display devices stack under the display, staggered right like a fanned
      // deck (a room can hold a local source AND a return encoder)
      g.locals = localsInZone.map((ld, k) => ({
        x: g.cx - PL.smallTile.w / 2 + k * 26, y: bottom + 12 + k * (PL.smallTile.h + 8),
        ...PL.smallTile, deviceId: ld.id, label: ld.model,
      }));
      g.local = g.locals[0]; // back-compat alias
      const last = g.locals[g.locals.length - 1];
      bottom = last.y + last.h + PL.captionH;
    }
    g.captionY = bottom + PL.captionH;
    contentBottom = Math.max(contentBottom, g.captionY);
    x += g.w + PL.groupGapX;
  }
  let contentRight = x - PL.groupGapX;
  for (const g of groups) for (const l of g.locals || []) contentRight = Math.max(contentRight, l.x + l.w);
  // a compact card still fits its own name (13px title, ~7px/char)
  const nameW = compact ? Math.ceil(String(zone.name || "").length * 7) + 2 * pad : 0;
  // corner remote pill (right) and keynote marker (left) need clear air beside
  // the centered title — widen symmetrically so the title stays centered
  const minW = compact ? Math.max(72, nameW + (zone.remote ? 40 : 0) + (hasNote ? 28 : 0)) : PL.cardMinW;
  const minH = compact ? titleH + 24 : PL.cardMinH;   // an endpoint-less zone still reads as a card
  const w = Math.max(minW, contentRight + pad);
  const h = Math.max(minH, contentBottom + (compact ? 12 : PL.cardBottomPad));
  // widen: center content when min width won
  const innerW = contentRight - pad;
  if (w > innerW + 2 * pad - 1) {
    const shift = (w - innerW) / 2 - pad;
    for (const g of groups) { g.x += shift; g.cx += shift; for (const l of g.locals || []) l.x += shift; }
  }
  return { w, h, groups, compact };
}

function deviceTileSpec(d, inCount = 0, rackOuts = 0) {
  // avbSwitch rides col A (mock-sheet draws Savant AVB with the sources) so its
  // module feeds enter col B left edges cleanly
  if (d.type === "source" || d.type === "avbSwitch" || d.type === "power") {
    // a small box seats two exits on its 22px edge; a third (a cable box feeding
    // a receiver, a far TV and an amp) needs a taller tile or the exits land
    // closer than the router's lane clearance and one wire has no legal path.
    // Only when some exit stays IN the rack: feeds out to zones share trunks
    // (a one-source job fanning to nine TVs stays 22px — a tall source there
    // crowds the column gap the TV returns climb through). Capped at four.
    const h = inCount >= 3 && rackOuts >= 1 ? (Math.min(inCount, 4) - 1) * RT.portPitch + 16 : PL.smallTile.h;
    return { col: "A", ...PL.smallTile, h, kind: "small", pitch: PL.smallTile.pitch + h - PL.smallTile.h };
  }
  const base = d.type === "amp" ? { col: "C", ...PL.ampTile, kind: "amp" } : { col: "B", ...PL.chassisTile, kind: "chassis" };
  // uniform chassis height — except a hub whose left edge must seat all its
  // input ports at legible pitch (an SW12 draws big; it IS the hub);
  // +28 leaves one spare port slot for the router's retry tier
  const h = Math.max(base.h, inCount * 12 + 28);
  return { ...base, h, pitch: h + 20 };
}

const quant = (need, min) => Math.max(min, Math.ceil(need / PL.corridorQuantum) * PL.corridorQuantum);

/* Page-width search (Ryan 2026-09-30: "make placement use the page width").
   The layout rules stay (surround + TV rooms along the top, TV-only rooms in
   the mid band, speaker rooms bottom-right, rack at the left); what varies is
   how the right-of-rack bands share the space: stacked (the classic sheet),
   side by side (mid band left, speaker rooms right — both bottom-aligned with
   the rack), and speaker rows allowed to run to the page edge. The layout that
   prints biggest (highest fitScale) wins, but only by a clear margin (3%), so
   a job that already fills the width keeps its tuned classic layout. */
/* TVs and speakers draw 25% bigger (Ryan 2026-10-01) unless that costs the drawing: when the
   bigger room cards shrink the whole sheet by more than 3%, step down (1.12, then today's 1.0) —
   a condo gets big icons for free, a 30-room estate keeps its rack and captions legible.
   opts.glyphScale pins it. The Off (classic) drawing keeps today's sizes: its per-wire gutter routing
   is fragile to any change in card sizes (200 random jobs: 11 best-effort wires at 1×, 11 at 1.12×,
   14 at 1.25×, 15 with the size picked per job — different jobs fail each time), while Bundle and
   Ribbon route as well or better at 25% (2 → 1, 5 → 4; estate 14 → 12 crossings). */
export const GLYPH_SCALES = [1.25, 1.12, 1];
export function place(job, ix = indexJob(job), opts = {}) {
  if (opts.glyphScale != null) return placeAt(job, ix, opts, opts.glyphScale);
  if (!trunkMode(job, opts)) return placeAt(job, ix, opts, 1);
  const tries = GLYPH_SCALES.map(gs => [gs, null]);
  const at = i => tries[i][1] ||= placeAt(job, ix, opts, tries[i][0]);
  const floor = () => at(tries.length - 1).fitScale;
  for (let i = 0; i < tries.length - 1; i++) {
    if (at(i).fitScale >= PL.growMax - 1e-9 || at(i).fitScale >= floor() * 0.97) return at(i);   // grown to the cap = free
  }
  return at(tries.length - 1);
}
function placeAt(job, ix, opts, gs) {
  const base = placeOnce(job, ix, opts, { gs });
  if (opts.classicLayout) return base;
  let best = base;
  // a wider virtual page (wrap) lets the top row run long when the drawing will
  // be scaled down anyway — two short rows of TV rooms waste the page's width
  // (measured on 60 random jobs, 2026-09-30: side by side ALONE lengthened
  // wires — 1.202× the Manhattan minimum vs 1.168 — while these print 8.3%
  // bigger on average AND route better: 1.162×, 7 long detours vs 10, 2
  // best-effort wires vs 5)
  const variants = [...[1.35, 1.7, 2.1].map(wrap => ({ wrap })),
    ...[1.15, 1.35, 1.7, 2.1].map(wrap => ({ wrap, sideBySide: true, audioWide: true }))];
  for (const v of opts.layoutVariants || variants) {
    const p = placeOnce(job, ix, opts, { ...v, gs });
    if (p.fitScale > best.fitScale * 1.03) best = p;
  }
  return best;
}

/* ---------- trunk mode (one trunk per signal type) ----------
   On by default since 2026-09-30 (Ryan): a job draws as "bundle" unless it says
   job.job.trunkStyle = "ribbon" or "off". opts.trunks overrides ("bundle" |
   "ribbon" | false / "off" for the classic drawing). */
export const trunkMode = (job, opts = {}) => {
  const t = opts.trunks !== undefined ? opts.trunks : (job.job?.trunkStyle ?? "bundle");
  return t === "bundle" || t === "ribbon" ? t : null;
};
// Dante as labels (job.job.danteStyle = "labels"; opts.danteLabels overrides): a Dante
// subscription rides the network — the Cat6 is already drawn — so instead of a dashed
// line, the receiving box lists its sources and each source names where it goes
export const danteLabelMode = (job, opts = {}) => opts.danteLabels !== undefined ? !!opts.danteLabels : job.job?.danteStyle === "labels";
// the box that feeds a room: its speakers' amp / receiver first (the speaker
// trunk is the one that fans out room by room), then the TV's video source —
// each as [rack order, output order]
function feedKeyFn(sol, s) {
  const order = {};
  (sol.racks || []).flatMap(r => r.devices || []).forEach((d, i) => { order[d.id] = i; });
  const conns = sol.connections || [];
  const firstCh = c => { const m = String(c?.channels || "").match(/\d+/); return m ? +m[0] : 0; };
  const outIdx = (from, to) => conns.filter(c => c.from === from).findIndex(c => c === to);
  return z => {
    const eps = z.endpoints || [];
    const spk = eps.find(e => e.type === "speakers"), tv = eps.find(e => e.type === "display");
    const sc = spk && conns.find(c => c.to === spk.id && c.signal === "speaker" && order[c.from] != null);
    let vc = tv && conns.find(c => c.to === tv.id && c.signal === "video");
    if (vc && s.companions[vc.from]) vc = conns.find(c => c.to === vc.from && c.signal === "video") || vc;
    if (vc && order[vc.from] == null) vc = null;
    return [sc ? order[sc.from] : 1e6, sc ? firstCh(sc) || outIdx(sc.from, sc) : 0,
            vc ? order[vc.from] : 1e6, vc ? outIdx(vc.from, vc) : 0];
  };
}
const cmpKey = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
// reorder within each rank group only — the band rules (surround first …) stay intact
function stableGroups(list, rank, reorder) {
  const groups = new Map();
  for (const z of list) (groups.get(rank(z)) || groups.set(rank(z), []).get(rank(z))).push(z);
  return [...groups.keys()].sort((a, b) => a - b).flatMap(k => reorder(groups.get(k)));
}

function placeOnce(job, ix, opts, variant) {
  const s = ix.solutions[opts.solution ?? 0];
  const wrapRight = SHEET.content.x + SHEET.content.w * (variant.wrap || 1) - PL.marginX;   // where rows wrap (layout units)
  if (!s) throw new Error("no solution to place");
  const sol = s.sol;
  // view filter (e.g. hideSignals: ["network"]): hidden wires get no corridor
  // capacity, no ports, no legend row — validation still sees the full system
  const hiddenSignals = new Set(opts.hideSignals || []);
  const dLabels = danteLabelMode(job, opts);
  const visConns = (sol.connections || []).filter(c => !hiddenSignals.has(c.signal) && !(dLabels && c.dante));
  const out = { sheet: SHEET, racks: [], zones: [], chips: [], corridors: [], areaHeaders: [], legend: null, warnings: [], glyphScale: variant.gs || 1 };

  /* -- classify zones, preserve input order (layout stability) -- */
  // grouping: by type (default) — within the TV band, surround+TV rooms, then TV
  // + 2-channel/soundbar, then TV only (speaker-only zones are their own band) —
  // optionally with outdoor zones as their own cluster; or plain added order
  const grouping = job.job?.zoneGrouping || "type";
  let areas = job.house.areas || [];
  const outdoorSplit = grouping === "type-outdoor" && job.house.zones.some(isOutdoorZone) && job.house.zones.some(z => !isOutdoorZone(z));
  if (outdoorSplit) areas = [...(areas.length ? areas : [{ id: "__indoor", name: "Indoor" }]), { id: "__outdoor", name: "Outdoor" }];
  const areaOf = z => outdoorSplit && isOutdoorZone(z) ? "__outdoor" : z.area;
  const multiArea = areas.length > 1;
  const primaryAreaId = areas.length ? (sol.racks?.[0]?.area || areas[0].id) : null;
  const clusters = []; // [{areaId, name, video:[], audio:[]}] — cluster 0 = primary
  const clusterFor = z => {
    // an area id that isn't declared falls back to the primary (validate flags it)
    const aid = multiArea ? (areas.some(a => a.id === areaOf(z)) ? areaOf(z) : primaryAreaId) : null;
    let c = clusters.find(c => c.areaId === aid);
    if (!c) {
      c = { areaId: aid, name: areas.find(a => a.id === aid)?.name || null, video: [], audio: [] };
      clusters.push(c);
    }
    return c;
  };
  // the primary cluster is the RACK's area and always exists — even with no
  // zones of its own (rack in a mech room), or clusters[0] becomes whichever
  // area sorts first and inherits the wrong header
  clusters.push({ areaId: multiArea ? primaryAreaId : null, name: multiArea ? areas.find(a => a.id === primaryAreaId)?.name || null : null, video: [], audio: [] });
  for (const z of job.house.zones) {
    const c = clusterFor(z);
    (z.endpoints || []).some(e => e.type === "display") ? c.video.push(z) : c.audio.push(z);
  }
  const tvRank = z => { const spk = (z.endpoints || []).find(e => e.type === "speakers")?.config || "";
    return /^surround/.test(spk) ? 0 : spk ? 1 : 2; };
  if (grouping !== "order") {
    const spkRank = z => /^surround/.test((z.endpoints || []).find(e => e.type === "speakers")?.config || "") ? 0 : 1;
    const stable = (list, rank) => list.map((z, i) => [z, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]);
    for (const c of clusters) { c.video = stable(c.video, tvRank); c.audio = stable(c.audio, spkRank); }
    // trunk mode: within each band, rooms fed by the same box sit together, in that
    // box's output order (amp zones 1-2, 3-4…), boxes in rack order — so a trunk
    // peels off room by room instead of doubling back (Ryan 2026-09-30)
    if (trunkMode(job, opts)) {
      const key = feedKeyFn(sol, s);
      const byFeed = list => list.map((z, i) => [z, i, key(z)]).sort((a, b) => cmpKey(a[2], b[2]) || a[1] - b[1]).map(x => x[0]);
      for (const c of clusters) {
        c.video = stableGroups(c.video, tvRank, byFeed);
        c.audio = stableGroups(c.audio, spkRank, byFeed);
      }
    }
  }
  // primary cluster first, others in area order
  clusters.sort((a, b) => {
    const rank = c => (c.areaId === primaryAreaId || c.areaId === null) ? -1 : areas.findIndex(x => x.id === c.areaId);   // every cluster id is a declared area now
    return rank(a) - rank(b);
  });

  /* -- pass 1: measure zone cards; count inbound feeds per zone (each wrapped
     row's strip must seat its chips AND its feed lanes — demand-sized) -- */
  const cardOf = {}, zoneInbound = {};
  for (const c of visConns) {
    const zid = ix.endpointZone[c.to] || (s.companions[c.to] && ix.endpointZone[s.companions[c.to].serves]);
    if (!zid || s.locals[c.from]) continue;
    if (ix.endpointsById[c.from] && ix.endpointZone[c.from] === zid) continue; // in-room link needs no strip lane
    if (s.companions[c.from] && ix.endpointsById[s.companions[c.from].serves]) continue; // chip stub
    zoneInbound[zid] = (zoneInbound[zid] || 0) + 1;
  }
  const rowGapFor = rowZones => Math.max(PL.videoRowGapY,
    38 + 12 * (rowZones.reduce((n, z) => n + (zoneInbound[z.id] || 0), 0) + 1));
  const notedZones = new Set((sol.annotations || []).map(a => a?.near));
  for (const z of job.house.zones) {
    const locals = Object.values(s.locals).filter(d => d.zone === z.id && d.location === "at-display");
    cardOf[z.id] = zoneCard(z, locals, notedZones.has(z.id), variant.gs || 1);
  }

  /* -- primary top band: video zones of cluster 0, rows wrapping at content right --
     By type (default), TV-only rooms (no speakers of their own) leave the top band
     for the MID band: right of the rack, between the TV rows above and the
     speaker-only rooms at the bottom right — the space that used to sit empty.
     Only when the job has a rack and the top band keeps TV rooms with speakers. */
  const primary = clusters[0];
  const midZones = grouping !== "order" && (sol.racks || []).some(r => (r.devices || []).length) && primary.video.some(z => tvRank(z) < 2)
    ? primary.video.filter(z => tvRank(z) === 2) : [];
  if (midZones.length) primary.video = primary.video.filter(z => !midZones.includes(z));
  {
    let x = PL.marginX, y = PL.topY, rowH = 0, rowZones = [];
    for (const z of primary.video) {
      const c = cardOf[z.id];
      if (x + c.w > wrapRight && x > PL.marginX) {
        y += rowH + rowGapFor(rowZones); x = PL.marginX; rowH = 0; rowZones = [];
      }
      placeZone(out, z, c, x, y, "top");
      rowZones.push(z);
      x += c.w + PL.cardGapX; rowH = Math.max(rowH, c.h);
    }
    var topBandBottom = primary.video.length ? y + rowH : PL.topY - PL.rowGapY;
    var topBandRight = primary.video.length ? Math.max(...out.zones.map(z => z.x + z.w)) : PL.marginX;
  }

  /* -- demand-sized column gaps: the intra-rack corridors are first-class
     too — vertical lane capacity between columns is reserved from actual
     wire counts, never hoped for -- */
  const devColOf = {};
  for (const r of sol.racks || []) for (const d of r.devices || []) devColOf[d.id] = deviceTileSpec(d).col;
  let bcDemand = 2, abDemand = 3;
  const inCount = {};
  for (const c of visConns) {
    const fCol = devColOf[c.from], tCol = devColOf[c.to];
    if (devColOf[c.to] != null) inCount[c.to] = (inCount[c.to] || 0) + 1;
    if (fCol != null) inCount["out:" + c.from] = (inCount["out:" + c.from] || 0) + 1;
    if (fCol != null && tCol != null) inCount["rack:" + c.from] = (inCount["rack:" + c.from] || 0) + 1;
    const toZoneSide = ix.endpointsById[c.to] || (s.companions[c.to] && !devColOf[s.companions[c.to]?.serves]);
    if (fCol === "B" && (toZoneSide || s.companions[c.to])) bcDemand++;
    if (fCol === "B" && tCol === "B") { bcDemand++; abDemand++; }
    if (fCol === "B" && tCol === "C") bcDemand++;
    if ((ix.endpointsById[c.from] || s.locals[c.from]) && devColOf[c.to] != null) abDemand++; // returns + local backhauls descend the AB gap (in-room links don't)
    if (s.companions[c.from] && devColOf[s.companions[c.from].serves] === "A") abDemand++; // ENC-chip outputs
    if (fCol === "A" && toZoneSide) abDemand++;   // direct colA→zone feeds rise in the AB gap
  }
  // encoder chips sit IN the A|B gap; one with two outputs (an AVDM: video + audio) needs its
  // risers beside it as well, so the gap grows by a chip's width (only then — no other sheet moves)
  const twoOutChips = (sol.companions || []).filter(k => devColOf[k.serves] === "A" && visConns.filter(c => c.from === k.id).length > 1).length;
  const gapAB = Math.max(80, abDemand * 12 + 24) + (twoOutChips ? PL.chip.w + 12 : 0);
  const gapBC = Math.max(60, bcDemand * 12 + 24);
  const colBx = PL.colA + PL.smallTile.w + gapAB;
  const colCx = colBx + PL.chassisTile.w + gapBC;

  /* -- corridors sized BEFORE dependent placement (corridors are first-class) -- */
  const epZoneOf = id => ix.endpointZone[id] || (s.companions[id] && ix.endpointZone[s.companions[id].serves]) || s.locals[id]?.zone;
  const crossings = { top: 0, right: 0 };
  const clusterInbound = {}; // areaId -> feeds entering that cluster (sizes its gutter)
  for (const c of visConns) {
    const zid = epZoneOf(c.to) || epZoneOf(c.from);
    if (!zid) continue;
    if (s.locals[c.from] && ix.endpointsById[c.to]) continue; // local link lives inside the card
    if (s.locals[c.to] && ix.endpointZone[c.from] === s.locals[c.to].zone) continue; // display → local encoder stub
    if (ix.endpointsById[c.from] && ix.endpointZone[c.from] === ix.endpointZone[c.to]) continue; // display → in-room soundbar
    // a chip parked at the card (balun/DEC serving an endpoint) feeds it via a
    // short stub — the corridor crossing was already counted on the feed INTO the chip
    if (s.companions[c.from] && ix.endpointsById[s.companions[c.from].serves]) continue;
    const cl = clusters.find(cl => cl.video.some(z => z.id === zid) || cl.audio.some(z => z.id === zid));
    const isVideoZone = cl?.video.some(z => z.id === zid);   // mid-band TVs aren't in video: they count as right/east
    if (cl === primary && isVideoZone) crossings.top++;
    else crossings.right++;
    if (cl && cl !== primary) clusterInbound[cl.areaId] = (clusterInbound[cl.areaId] || 0) + 1;
  }
  // one lane per feed, in every style: trunk drawings use far less of it, but the spare lanes are
  // what the rip-up pass untangles with — sizing by trunks (2026-10-01, 200 random jobs) printed
  // 1–2.6% bigger for 1–2% more crossings, so the room stays
  const topCorridorH = quant(crossings.top * PL.lanePitch + 40, PL.topCorridorMin);
  // the right corridor's VERTICAL lanes serve col-C risers bound for the top
  // band (east-bound feeds only cross it horizontally)
  let colCRisers = 2;
  for (const c of visConns) {
    const tzid = epZoneOf(c.to);
    if (devColOf[c.from] === "C" && tzid && primary.video.some(z => z.id === tzid)) colCRisers++;
  }
  const rightCorridorW = quant(colCRisers * PL.lanePitch + 36, PL.rightCorridorMin);

  /* -- racks: left column, stacked, device columns vertically aligned -- */
  let rackY = topBandBottom + topCorridorH;
  let rackRight = PL.marginX;
  for (const r of sol.racks || []) {
    const cols = { A: rackY + PL.rackPadTop, B: rackY + PL.rackPadTop };
    const placed = [], cTiles = [], aBottom = [];
    let maxTileBottom = rackY + PL.rackPadTop;
    // trunk mode: a box whose audio feeds the amps (a Savant output module, a Dante bridge) sinks to the
    // bottom of its column, beside the bottom-anchored amps — receivers added later otherwise stack
    // between them and the patch has to loop round or cut across all their wiring (dogfood 2026-10-01).
    // Sources stay at the top; only the schematic's column moves, the Rack page keeps the job's order.
    let rdevs = r.devices || [];
    if (trunkMode(job, opts)) {
      const typeOf = id => rdevs.find(x => x.id === id)?.type;
      const feedsAmp = d => d.type !== "source" && d.type !== "amp" && visConns.some(c => c.from === d.id && c.signal === "audio" && typeOf(c.to) === "amp");
      rdevs = [...rdevs.filter(d => !feedsAmp(d)), ...rdevs.filter(feedsAmp)];
    }
    for (const d of rdevs) {
      const t = deviceTileSpec(d, Math.max(inCount[d.id] || 0, inCount["out:" + d.id] || 0), inCount["rack:" + d.id] || 0);
      // amps (col C) anchor to the rack BOTTOM (mock rule: distribution exits
      // high toward the top band, speaker audio exits low toward the audio band)
      if (t.col === "C") { cTiles.push({ d, t }); continue; }
      // AVB / switching gear anchors bottom-LEFT (user rule: sources dress the
      // top of the rack, network infrastructure lives low) — same two-phase
      // treatment the amps get
      if (t.col === "A" && (d.type === "avbSwitch" || d.type === "power")) { aBottom.push({ d, t }); continue; }
      const x = t.col === "A" ? PL.colA : colBx;
      placed.push({ id: d.id, model: d.model, kind: t.kind, col: t.col, x, y: cols[t.col], w: t.w, h: t.h, type: d.type });
      maxTileBottom = Math.max(maxTileBottom, cols[t.col] + t.h + (t.kind === "small" ? PL.captionH : 0));
      cols[t.col] += t.pitch;
    }
    // trunk mode: the amps stack in the order of the rooms they feed (Ryan 2026-10-01). The speaker
    // trunk climbs past their jacks top to bottom and fans out to the rooms left to right, so with the
    // two orders matching no lane has to cross another; the band rules (surround rooms first) stay put.
    // Only the schematic's column moves — the Rack page elevation keeps the job's order.
    if (trunkMode(job, opts) && cTiles.length > 1) {
      const rooms = [...clusters.flatMap(c => [...c.video, ...c.audio])];
      const midSet = new Set(midZones.map(z => z.id));
      const ordered = [...rooms.filter(z => !midSet.has(z.id) && clusters[0].video.includes(z)), ...midZones, ...rooms.filter(z => !clusters[0].video.includes(z) && !midSet.has(z.id))];
      const roomAt = new Map(ordered.map((z, i) => [z.id, i]));
      const firstRoom = id => Math.min(Infinity, ...visConns.filter(c => c.from === id && c.signal === "speaker" && ix.endpointZone[c.to]).map(c => roomAt.get(ix.endpointZone[c.to]) ?? Infinity));
      const at = new Map(cTiles.map((x, i) => [x.d.id, i]));
      cTiles.sort((a, b) => (firstRoom(a.d.id) - firstRoom(b.d.id)) || (at.get(a.d.id) - at.get(b.d.id)));
    }
    const usedC = cTiles.length > 0;
    const cTotal = cTiles.reduce((n, { t }) => n + t.h, 0) + 20 * Math.max(0, cTiles.length - 1);
    const aTotal = aBottom.reduce((n, { t }) => n + t.h + PL.captionH, 0) + 12 * Math.max(0, aBottom.length - 1);
    const w = (usedC ? colCx + PL.ampTile.w : colBx + PL.chassisTile.w) + PL.rackPadBottom - PL.marginX;
    const h = Math.max(maxTileBottom - rackY + PL.rackPadBottom,
                       usedC ? PL.rackPadTop + cTotal + PL.rackPadBottom + 40 : 0,
                       aBottom.length ? (cols.A - rackY) + aTotal + PL.rackPadBottom + 8 : 0);
    let cy = rackY + h - PL.rackPadBottom - cTotal;
    for (const { d, t } of cTiles) {
      placed.push({ id: d.id, model: d.model, kind: t.kind, col: "C", x: colCx, y: cy, w: t.w, h: t.h, type: d.type });
      cy += t.h + 20;
    }
    let ay = rackY + h - PL.rackPadBottom - aTotal;
    for (const { d, t } of aBottom) {
      placed.push({ id: d.id, model: d.model, kind: t.kind, col: "A", x: PL.colA, y: ay, w: t.w, h: t.h, type: d.type });
      ay += t.h + PL.captionH + 12;
    }
    out.racks.push({ id: r.id, name: r.name, x: PL.marginX, y: rackY, w, h, devices: placed });
    rackRight = Math.max(rackRight, PL.marginX + w);
    rackY += h + PL.rackGapY;
  }
  const rackBottom = rackY - PL.rackGapY;

  /* -- primary audio band: bottom-right of the page, bottom-aligned with the
     rack (mock rule: speaker runs leave the bottom-anchored amps and flow
     straight right — never through the top half). Rows wrap on their own
     width budget and the block grows UPWARD as zone count rises. */
  {
    const bandX = rackRight + rightCorridorW;
    const pageRight = wrapRight;
    let bandMaxW = Math.max(680, Math.ceil(Math.sqrt(primary.audio.length)) * 170);
    if (variant.audioWide) bandMaxW = Math.max(bandMaxW, pageRight - bandX);   // speaker rows may run to the page edge
    // column grid: compact cards vary in width, but rows must advance on a
    // shared cell pitch or the inter-column gutters (return/dive escape
    // channels) get pierced by a lower row's card
    // the cell is sized for the ordinary card (75th percentile), and a wide one
    // (a landscape array) spans whole cells — so one big card no longer spreads
    // every column apart, and the gutters still line up row to row
    const cellW = gridCell(primary.audio.map(z => cardOf[z.id].w));
    const spanOf = c => Math.max(1, Math.ceil((c.w + PL.cardGapX) / (cellW + PL.cardGapX)));
    const dry = [];                                   // dry layout first, then bottom-align the block
    let x = bandX, y = 0, rowH = 0, bandH = 0;
    for (const z of primary.audio) {
      const c = cardOf[z.id], span = spanOf(c) * (cellW + PL.cardGapX) - PL.cardGapX;
      if (x + span > bandX + bandMaxW && x > bandX) { y += rowH + PL.rowGapY; x = bandX; rowH = 0; }
      dry.push({ z, c, x, y });
      x += span + PL.cardGapX; rowH = Math.max(rowH, c.h); bandH = Math.max(bandH, y + c.h);
    }
    const bandTopMin = topBandBottom + topCorridorH + (out.racks.length ? 100 : 0);
    let y0 = Math.max(bandTopMin, (out.racks.length ? rackBottom : bandTopMin + bandH) - bandH);
    let audioShift = 0;                                // side by side: the speaker rooms move right of the mid band
    // mid band (TV-only rooms): its own column grid from the same left edge,
    // sitting on top of the audio band with room for each card's chip strip
    // and feed lanes (rowGapFor) — the audio band moves down only if they don't fit
    if (midZones.length) {
      const midMaxW = Math.max(bandMaxW, wrapRight - bandX);
      const midCell = gridCell(midZones.map(z => cardOf[z.id].w));
      const midSpan = c => Math.max(1, Math.ceil((c.w + PL.cardGapX) / (midCell + PL.cardGapX))) * (midCell + PL.cardGapX) - PL.cardGapX;
      const mdry = [], rows = [[]];
      let mx = bandX, my = 0, mRowH = 0, midH = 0;
      for (const z of midZones) {
        const c = cardOf[z.id];
        if (mx + midSpan(c) > bandX + midMaxW && mx > bandX) { my += mRowH + rowGapFor(rows[rows.length - 1]); mx = bandX; mRowH = 0; rows.push([]); }
        mdry.push({ z, c, x: mx, y: my }); rows[rows.length - 1].push(z);
        mx += midSpan(c) + PL.cardGapX; mRowH = Math.max(mRowH, c.h); midH = Math.max(midH, my + c.h);
      }
      const gapBelow = rowGapFor(rows[rows.length - 1]);
      if (variant.sideBySide && dry.length) {
        // mid band on its own, bottom-aligned with the rack (as if there were no
        // speaker rooms); the speaker rooms sit to its right on a feed gutter
        const midW = Math.max(...mdry.map(p => p.x + p.c.w)) - bandX;
        const midBottom = out.racks.length ? rackBottom : bandTopMin + midH;
        const midTop = Math.max(bandTopMin, midBottom - midH);
        for (const p of mdry) placeZone(out, p.z, p.c, p.x, midTop + p.y, "mid");
        audioShift = midW + Math.max(PL.areaGapX, gapBelow);
        if (variant.audioWide) {                       // re-wrap the speaker rows on the width that's left
          const room = pageRight - (bandX + audioShift);
          let x = bandX, y = 0, rowH = 0; bandH = 0;
          for (const p of dry) {
            const span = spanOf(p.c) * (cellW + PL.cardGapX) - PL.cardGapX;
            if (x + span > bandX + Math.max(room, cellW) && x > bandX) { y += rowH + PL.rowGapY; x = bandX; rowH = 0; }
            p.x = x; p.y = y; x += span + PL.cardGapX; rowH = Math.max(rowH, p.c.h); bandH = Math.max(bandH, y + p.c.h);
          }
          y0 = Math.max(bandTopMin, (out.racks.length ? rackBottom : bandTopMin + bandH) - bandH);
        }
      } else {
        const midBottom = (dry.length ? y0 : (out.racks.length ? rackBottom : bandTopMin + midH));
        let midTop = midBottom - (dry.length ? gapBelow : 0) - midH;
        if (midTop < bandTopMin) { y0 += bandTopMin - midTop; midTop = bandTopMin; }
        for (const p of mdry) placeZone(out, p.z, p.c, p.x, midTop + p.y, "mid");
      }
    }
    for (const p of dry) placeZone(out, p.z, p.c, p.x + audioShift, y0 + p.y, "audio");
  }

  /* -- secondary clusters: full stacks to the right (video row, audio rows below) -- */
  out.clusters = [{ areaId: primaryAreaId, x0: PL.marginX, x1: Math.max(topBandRight, ...out.zones.map(z => z.x + z.w), rackRight) }];
  let clusterX = out.clusters[0].x1;
  for (const cl of clusters.slice(1)) {
    // gutter before each cluster sized for the feeds that must rise through it
    clusterX += Math.max(PL.areaGapX, (clusterInbound[cl.areaId] || 0) * 12 + 32);
    const startX = clusterX;
    // same column-grid rule as the audio band: fixed cell pitch keeps the
    // vertical escape gutters clear through every row of the cluster
    const cellW = Math.max(0, ...[...cl.video, ...cl.audio].map(z => cardOf[z.id].w));
    let x = startX, y = PL.topY, rowH = 0, right = startX, rowZones = [];
    for (const z of cl.video) {
      const c = cardOf[z.id];
      if (x + cellW > startX + PL.secondaryClusterMaxW && x > startX) { y += rowH + rowGapFor(rowZones); x = startX; rowH = 0; rowZones = []; }
      placeZone(out, z, c, x, y, "cluster");
      rowZones.push(z);
      x += cellW + PL.cardGapX; rowH = Math.max(rowH, c.h); right = Math.max(right, x - PL.cardGapX - (cellW - c.w));
    }
    y += (cl.video.length ? rowH + Math.max(70, rowGapFor(rowZones) - 12) : 0); x = startX; rowH = 0; rowZones = [];
    for (const z of cl.audio) {
      const c = cardOf[z.id];
      if (x + cellW > startX + PL.secondaryClusterMaxW && x > startX) { y += rowH + rowGapFor(rowZones); x = startX; rowH = 0; rowZones = []; }
      placeZone(out, z, c, x, y, "cluster");
      rowZones.push(z);
      x += cellW + PL.cardGapX; rowH = Math.max(rowH, c.h); right = Math.max(right, x - PL.cardGapX - (cellW - c.w));
    }
    out.areaHeaders.push({ areaId: cl.areaId, name: (cl.name || "").toUpperCase(), cx: (startX + right) / 2, y: PL.areaHeaderY });
    out.clusters.push({ areaId: cl.areaId, x0: startX, x1: right });
    clusterX = right;
  }
  if (multiArea && primary.video.length + primary.audio.length) {
    const pri = out.zones.filter(z => z.band !== "cluster");
    const right = Math.max(rackRight, ...pri.map(z => z.x + z.w));
    out.areaHeaders.unshift({
      areaId: primaryAreaId,
      name: (areas.find(a => a.id === primaryAreaId)?.name || "").toUpperCase(),
      cx: (PL.marginX + right) / 2, y: PL.areaHeaderY,
    });
  }

  /* -- companion chips (obstacles for the router) --
     Rack-serving chips try slots in order (beside → staggered down → below the
     device) until one is collision-free vs devices and earlier chips. */
  const allDevices = out.racks.flatMap(r => r.devices);
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const chipFits = r => !allDevices.some(d => hit(r, d)) && !out.chips.some(c => hit(r, c));
  for (const comp of sol.companions || []) {
    const chip = { id: comp.id, type: comp.type, ...(comp.dante ? { dante: true } : {}), ...PL.chip };
    const servedEp = ix.endpointsById[comp.serves];
    if (servedEp) {
      // balun/DEC under the display it serves, aligned with the endpoint (boundary principle)
      const pz = out.zones.find(z => z.id === ix.endpointZone[comp.serves]);
      const slot = pz?.groups.find(g => g.epId === comp.serves);
      if (pz && slot) {
        chip.x = pz.x + slot.cx - PL.chip.w / 2; chip.y = pz.y + pz.h + 20;
        // a second companion on the same endpoint steps sideways, never stacks
        for (let k = 1; k < 6 && !chipFits(chip); k++) chip.x = pz.x + slot.cx - PL.chip.w / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (PL.chip.w + 8);
      }
    } else {
      // serves a rack device: ENC to the right of its source, DEC to the left of its target
      const dev = allDevices.find(d => d.id === comp.serves);
      if (dev) {
        const cy = dev.y + dev.h / 2 - PL.chip.h / 2;
        const bx = comp.type === "enc" ? dev.x + dev.w + 24 : dev.x - PL.chip.w - 24;
        const candidates = [
          { x: bx, y: cy },                                        // beside, centered
          { x: bx, y: cy + 26 }, { x: bx, y: cy + 52 },            // beside, staggered down
          { x: dev.x + dev.w / 2 - PL.chip.w / 2, y: dev.y + dev.h + 8 }, // tucked below
          { x: bx, y: cy - 26 },                                   // beside, staggered up
        ];
        // an amp's audio decoder (MXNet audio de-embed) steps down beside its amp first: level with
        // it, it plugs the gap the neighbouring receiver's speaker runs use to reach the rooms
        if (comp.variant === "audio-deembed") candidates.unshift(candidates.splice(2, 1)[0]);
        const pick = candidates.find(p => chipFits({ ...p, w: PL.chip.w, h: PL.chip.h }));
        if (pick) { chip.x = pick.x; chip.y = pick.y; }
        else { chip.x = bx; chip.y = cy; out.warnings.push({ code: "chip-crowded", ref: comp.id, msg: `${describeNode(job, s.sol, comp.id).short} had no clear spot — it may overlap on the drawing` }); }
      }
    }
    if (chip.x == null) {
      chip.x = PL.marginX; chip.y = rackBottom + 40;
      for (let k = 1; k < 40 && !chipFits(chip); k++) chip.x = PL.marginX + k * (PL.chip.w + 8);
      out.warnings.push({ code: "chip-unanchored", ref: comp.id, msg: `${describeNode(job, s.sol, comp.id).short} isn't attached to anything on the drawing` });
    }
    out.chips.push(chip);
  }

  /* -- corridor boxes (reserved routing space) -- */
  out.corridors.push({
    id: "top", orientation: "h", lanes: crossings.top, pitch: PL.lanePitch,
    x: PL.marginX, y: topBandBottom, w: Math.max(topBandRight, rackRight) - PL.marginX, h: topCorridorH,
  });
  out.corridors.push({
    id: "right", orientation: "v", lanes: colCRisers, pitch: PL.lanePitch,
    x: rackRight, y: topBandBottom + topCorridorH, w: rightCorridorW, h: Math.max(rackBottom - (topBandBottom + topCorridorH), 0),
  });

  /* -- dynamic legend: only signal types present on the sheet -- */
  const present = [...new Set(visConns.map(c => (c.scope || "included") !== "included" ? "prewire" : c.dante ? "dante" : c.signal === "speaker" ? "audio" : c.signal))];
  if (dLabels && (sol.connections || []).some(c => c.dante && !hiddenSignals.has(c.signal))) present.push("danteTag");
  const order = ["video", "audio", "dante", "danteTag", "audioReturn", "network", "prewire"];
  const rows = order.filter(k => present.includes(k));
  // zone annotations ride the legend as numbered keynotes (CAD style): the
  // full sentence lives here, the zone card wears only the circled number
  const notes = (sol.annotations || []).filter(a => a && typeof a === "object")
    .map((a, i) => ({ n: i + 1, text: String(a.text ?? ""), near: a.near }));
  const noteW = notes.length ? Math.max(...notes.map(n => n.text.length)) * 5.4 + 58 : 0;
  // equipment key (color by kind): one swatch per kind of box actually in the racks
  const kindsHere = opts.kindColor === false ? [] : (() => {
    const snap = job.job?.catalogSnapshot?.devices || {};
    const have = new Set(out.racks.flatMap(r => r.devices).map(d => { const dev = s.devices[d.id] || {}; return deviceKind(dev, snap[dev.catalogRef]); }));
    return Object.keys(KIND_STYLE).filter(k => have.has(k));
  })();
  const eqH = kindsHere.length ? PL.legendEqH : 0;
  const lw = Math.max(90, 24 + rows.length * PL.legendRowW, noteW, kindsHere.length ? 24 + kindsHere.length * PL.legendEqW : 0);   // "LEGEND" must fit even with no signal rows yet
  const lh = PL.legendH + eqH + (notes.length ? notes.length * 15 + 10 : 0);
  out.legend = { rows, kinds: kindsHere, eqH, notes, w: lw, h: lh, x: SHEET.content.x + SHEET.content.w - lw - 60, y: SHEET.content.y + SHEET.content.h - lh - 6 };

  /* -- bounds + fit scale (one-page rule: drawing scales, never splits) -- */
  const rects = [...out.zones, ...out.racks, ...out.chips];
  const maxX = Math.max(...rects.map(r => r.x + r.w), PL.marginX);
  const maxY = Math.max(...rects.map(r => r.y + r.h), PL.topY);
  out.bounds = { x: 0, y: 0, w: maxX + PL.marginX, h: maxY + 40 };
  // the drawing fills the page: a big job shrinks to fit, a small one GROWS
  // (Ryan 2026-09-30: "the scaling grows with the job" — a four-room condo
  // shouldn't sit small in a corner of an 11×17), capped so a one-room job
  // doesn't turn cartoonish; leftover width is split evenly left and right
  out.fitScale = Math.min(PL.growMax, SHEET.content.w / out.bounds.w, (SHEET.content.h - out.legend.h - 20) / out.bounds.h);
  out.fitOffset = { x: Math.max(0, Math.round((SHEET.content.w - out.bounds.w * out.fitScale) / 2)), y: 0 };
  if (out.fitScale < 0.75) out.warnings.push({ code: "scale", msg: `The drawing fits at ${Math.round(out.fitScale * 100)}% — captions may print small` });

  return out;
}

function placeZone(out, zone, card, x, y, band) {
  out.zones.push({
    id: zone.id, name: zone.name, scope: zone.scope || "included", band, remote: zone.remote,
    x, y, w: card.w, h: card.h, compact: card.compact || false,
    groups: card.groups.map(g => ({ ...g })),
  });
}

/* ---------- route ----------
   The §4 rule set as a structured channel router. Placement is canonical
   (racks left, zones top/right), so every connection falls into a known class;
   each class builds candidate orthogonal paths, validated against an obstacle
   set (devices, chips, cards — wires never pierce them) and a lane registry
   (no co-linear overlaps; 12px pitch). Nesting comes from port ordering
   (farthest destination → top exit port), hops from a crossing post-pass. */

const RT = { lane: 12, pad: 2, clear: 9, portPitch: 12, portInset: 8, hopR: 6, hopMerge: 20 };

export function route(job, ix, placement, opts = {}) {
  const r = routeOnce(job, ix, placement, opts);
  // the trunk repair frees a stuck wire by moving a neighbour — but the wires the classic passes
  // route afterwards can't be foreseen; if one of them vanished, route again without the repair
  // and keep the better sheet (fewer vanished wires, then fewer fallbacks)
  if (r.repaired && !opts.noRepair && r.warnings.some(w => w.code === "unrouted")) {
    const r2 = routeOnce(job, ix, placement, { ...opts, noRepair: true });
    const bad = x => x.warnings.filter(w => w.code === "unrouted").length * 1000 + x.wires.filter(w => /fallback/.test(w.cls)).length;
    if (bad(r2) < bad(r)) return r2;
  }
  return r;
}
function routeOnce(job, ix, placement, opts = {}) {
  const s = ix.solutions[opts.solution ?? 0];
  const sol = s.sol;
  const P = placement;
  const hiddenSignals = new Set(opts.hideSignals || []);
  const out = { wires: [], groups: [], warnings: [] };
  // a wire to an endpoint the placer drew no slot for (a speaker/display type
  // this version doesn't know — a newer or hand-edited file) is reported, not
  // routed: one such wire used to throw and blank the whole sheet
  const placedEp = new Set(P.zones.flatMap(z => (z.groups || []).map(g => g.epId)));
  const epOf = id => ix.endpointsById[id] ? id : ix.endpointsById[s.companions[id]?.serves] ? s.companions[id].serves : null;
  const drawable = c => [c.from, c.to].every(id => { const ep = epOf(id); return !ep || placedEp.has(ep); });
  const dLabels = danteLabelMode(job, opts);
  if (dLabels) out.danteTags = (sol.connections || []).filter(c => c.dante && !hiddenSignals.has(c.signal)).map(c => ({ from: c.from, to: c.to }));
  const visConns = (sol.connections || []).filter(c => {
    if (hiddenSignals.has(c.signal) || (dLabels && c.dante)) return false;
    if (drawable(c)) return true;
    out.warnings.push({ code: "unrouted", msg: `no route class for ${c.from}→${c.to}` });
    return false;
  });
  const rackDevById = {};
  for (const rk of P.racks) for (const dd of rk.devices) rackDevById[dd.id] = dd;
  const dbg = (o, entry) => {
    if (!opts.debug) return;
    (out.debug ||= {});
    const k = `${o.c.from}→${o.c.to}`;
    ((out.debug[k] ||= [])).length < 80 && out.debug[k].push(entry);
  };

  /* --- lookup tables --- */
  const devById = {}; for (const r of P.racks) for (const d of r.devices) devById[d.id] = d;
  const chipById = {}; for (const c of P.chips) chipById[c.id] = c;
  const zoneByEp = epId => P.zones.find(z => z.id === ix.endpointZone[epId]);
  const slotOf = epId => { const pz = zoneByEp(epId); const g = pz.groups.find(g => g.epId === epId); return { pz, g, cx: pz.x + g.cx }; };
  const localSlotOf = id => {
    const ld = s.locals[id]; if (!ld) return null;
    const pz = P.zones.find(z => z.id === ld.zone); if (!pz) return null;
    for (const g of pz.groups) for (const l of g.locals || (g.local ? [g.local] : []))
      if (l.deviceId === id) return { pz, l, cx: pz.x + l.x + l.w / 2 };
    return null;
  };
  const rackRight = P.racks.length ? Math.max(...P.racks.map(r => r.x + r.w)) : 0;
  const rackTop = P.racks.length ? Math.min(...P.racks.map(r => r.y)) : 0;
  const rackBottom = P.racks.length ? Math.max(...P.racks.map(r => r.y + r.h)) : 0;
  const corRight = P.corridors.find(c => c.id === "right");
  // column gap channels from the ACTUAL placement (gaps are demand-sized)
  const allDevs = P.racks.flatMap(r => r.devices);
  const colX = col => { const xs = allDevs.filter(d => d.col === col).map(d => d.x); return xs.length ? Math.min(...xs) : null; };
  const colBx = colX("B") ?? PL.colA + PL.smallTile.w + 80;
  const colCx = colX("C") ?? colBx + PL.chassisTile.w + 60;
  const gapABx = [PL.colA + PL.smallTile.w + 6, colBx - 6];
  const gapBCx = [colBx + PL.chassisTile.w + 6, colCx - 6];
  const westMarginX = [18, PL.marginX - 6];                        // last-resort channel left of everything
  const riserRange = [rackRight + 6, rackRight + (corRight?.w || 90) - 6];
  // gutter west of a cluster (the area gap) — riser channel for cluster-bound feeds
  const gutterFor = tx => {
    const cl = (P.clusters || []).find(c => tx >= c.x0 && tx <= c.x1 + 40);
    if (!cl) return [Math.max(rackRight + 10, tx - 200), tx - 12];
    const i = (P.clusters || []).indexOf(cl);
    if (i === 0) return [Math.max(rackRight + 10, tx - 200), tx - 12];
    const prev = P.clusters[i - 1].x1;
    return [prev + 8, cl.x0 - 8];
  };

  /* --- obstacles (wires terminate ON edges; interiors shrink by pad) --- */
  const obstacles = [
    ...P.racks.flatMap(r => r.devices.map(d => ({ id: d.id, x: d.x, y: d.y, w: d.w, h: d.h }))),
    // a small tile's caption (its model, up to 18 px wider than the tile each side) — a wire through it cuts the
    // text. Trunk drawings only: the classic router has less room to move and lost routes to it (2 → 5 fallbacks)
    ...(trunkMode(job, opts) ? P.racks.flatMap(r => r.devices.filter(d => d.kind === "small").map(d => ({ id: d.id + ":caption", x: d.x - 18, y: d.y + d.h + 3, w: d.w + 36, h: 15 }))) : []),
    ...P.chips.map(c => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h })),
    ...P.zones.map(z => ({ id: z.id, x: z.x, y: z.y, w: z.w, h: z.h })),
  ];
  const segBlocked = (x1, y1, x2, y2, skip) => {
    const sx = Math.min(x1, x2), ex = Math.max(x1, x2), sy = Math.min(y1, y2), ey = Math.max(y1, y2);
    for (const o of obstacles) {
      if (skip && skip.has(o.id)) continue;
      if (sx < o.x + o.w - RT.pad && ex > o.x + RT.pad && sy < o.y + o.h - RT.pad && ey > o.y + RT.pad) return o.id;
    }
    return null;
  };
  const pathBlocked = (pts, skip) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const b = segBlocked(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], skip);
      if (b) return b;
    }
    return null;
  };

  /* --- lane registry: no co-linear overlaps between nets --- */
  const usedH = [], usedV = []; // {c, a1, a2, net}
  const conflicts = (used, c, a1, a2, net) => {
    const lo = Math.min(a1, a2), hi = Math.max(a1, a2);
    return used.some(u => u.net !== net && Math.abs(u.c - c) < RT.clear && Math.min(u.a2, hi) - Math.max(u.a1, lo) > -2);
  };
  const alloc = (used, desired, a1, a2, net, dir, blockedFn, range) => {
    const maxK = range ? Math.max(14, Math.ceil((range[1] - range[0]) / RT.lane) + 1) : 14;
    for (let k = 0; k <= maxK; k++) {
      for (const sgn of dir === 0 ? (k ? [1, -1] : [1]) : [dir]) {
        const c = desired + sgn * k * RT.lane;
        if (range && (c < range[0] || c > range[1])) continue;
        if (!conflicts(used, c, a1, a2, net) && !(blockedFn && blockedFn(c))) return c;
        if (dir !== 0) break;
      }
      if (dir !== 0 && (desired + dir * k * RT.lane < (range?.[0] ?? -1e9) || desired + dir * k * RT.lane > (range?.[1] ?? 1e9))) break;
    }
    return null;
  };
  const registerPath = (pts, net) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      if (y1 === y2) usedH.push({ c: y1, a1: Math.min(x1, x2), a2: Math.max(x1, x2), net });
      else usedV.push({ c: x1, a1: Math.min(y1, y2), a2: Math.max(y1, y2), net });
    }
  };
  // the net whose lane a path runs along (first one found), or null
  const blockingNet = (pts, net) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1], h = y1 === y2, used = h ? usedH : usedV, c = h ? y1 : x1, a1 = h ? Math.min(x1, x2) : Math.min(y1, y2), a2 = h ? Math.max(x1, x2) : Math.max(y1, y2);
      const u = used.find(u => u.net !== net && Math.abs(u.c - c) < RT.clear && Math.min(u.a2, a2) - Math.max(u.a1, a1) > -2);
      if (u) return u.net;
    }
    return null;
  };
  // debug: which stretch of a path is taken, and by which net
  const takenBy = (pts, net) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1], h = y1 === y2, used = h ? usedH : usedV, c = h ? y1 : x1, a1 = h ? Math.min(x1, x2) : Math.min(y1, y2), a2 = h ? Math.max(x1, x2) : Math.max(y1, y2);
      const u = used.find(u => u.net !== net && Math.abs(u.c - c) < RT.clear && Math.min(u.a2, a2) - Math.max(u.a1, a1) > -2);
      if (u) return `${h ? "h" : "v"}@${c} [${a1},${a2}] vs net ${u.net} ${out.wires.find(w => w.net === u.net)?.id || "(reserved)"} @${u.c}`;
    }
    return "";
  };
  const pathRegisterable = (pts, net) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      if (y1 === y2 ? conflicts(usedH, y1, x1, x2, net) : conflicts(usedV, x1, y1, y2, net)) return false;
    }
    return true;
  };

  /* --- port managers --- */
  const leftPorts = {}, rightPorts = {}, portPlan = {}; // reserved exits per wire
  // small tiles get a slimmer inset so two ports still clear the co-linear pitch
  const portSpan = dev => {
    const inset = Math.min(RT.portInset, Math.max(4, Math.floor(dev.h / 4)));
    return [dev.y + inset, dev.y + dev.h - inset];
  };
  const takePort = (store, dev, desired) => {
    const list = store[dev.id] ||= [];
    const [min, max] = portSpan(dev);
    let y = Math.max(min, Math.min(max, desired));
    let tries = 0;
    while (list.some(u => Math.abs(u - y) < 10) && tries++ < 20) {
      y += RT.lane; if (y > max) y = min;
    }
    list.push(y);
    return y;
  };
  const takeLeftPort = (dev, desired) => takePort(leftPorts, dev, desired);
  const takeRightPort = (dev, desired) => takePort(rightPorts, dev, desired);
  // non-mutating variant: candidates that may lose the cost comparison peek,
  // and only the winner claims (a considered-but-rejected west wrap once ate
  // both lanes of a 22px tile and walled off a later backhaul)
  const release = (store, id, y) => { const l = store[id]; const i = l ? l.indexOf(y) : -1; if (i >= 0) l.splice(i, 1); };
  const peekPort = (store, dev, desired) => {
    const list = store[dev.id] || [];
    const [min, max] = portSpan(dev);
    let y = Math.max(min, Math.min(max, desired)), tries = 0;
    while (list.some(u => Math.abs(u - y) < 10) && tries++ < 20) { y += RT.lane; if (y > max) y = min; }
    return y;
  };

  /* --- shared lane scanner: a lane is only taken when the whole path built on
     it clears obstacles and the registry (joint validation) --- */
  const scanLane = (desired, dir, range, xa, xb, net, ok) => {
    if (range[1] < range[0]) return null;
    const maxK = Math.max(14, Math.ceil((range[1] - range[0]) / RT.lane) + 1);
    for (let k = 0; k <= maxK; k++) {
      for (const sgn of dir === 0 ? (k ? [1, -1] : [1]) : [dir]) {
        const y = desired + sgn * k * RT.lane;
        if (y < range[0] || y > range[1]) { if (dir !== 0) break; else continue; }
        if (!conflicts(usedH, y, xa, xb, net) && ok(y)) return y;
        if (dir !== 0) break;
      }
    }
    return null;
  };

  const wireId = c => `${c.from}→${c.to}`;
  let nWire = 0;

  /* sibling nesting is INVIOLABLE (rule precedence §4): a candidate that would
     cross an already-committed wire of the same fan-out is rejected outright */
  const ptsSegs = pts => {
    const segs = [];
    for (let i = 1; i < pts.length; i++) segs.push({ x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1], vert: pts[i - 1][0] === pts[i][0] });
    return segs;
  };
  // SimCity tier: how much traffic already runs beside a candidate's segments
  // (±2.5 lane pitches, overlapping span) — a tiebreaker under the hop cost,
  // steering equal-hop candidates toward emptier corridors
  const pathCongestion = cand => {
    let n = 0;
    for (const s of ptsSegs(cand)) {
      const segs = s.vert ? usedV : usedH;
      const c = s.vert ? s.x1 : s.y1;
      const a1 = s.vert ? Math.min(s.y1, s.y2) : Math.min(s.x1, s.x2);
      const a2 = s.vert ? Math.max(s.y1, s.y2) : Math.max(s.x1, s.x2);
      for (const o of segs) if (Math.abs(o.c - c) <= 30 && Math.min(o.a2, a2) - Math.max(o.a1, a1) > 0) n++;
    }
    return n;
  };
  // score a candidate by how many existing wires it would cross (hops it costs)
  // route choice between shapes: hops dominate, then drawn length
  const routeCost = c => countCrossings(c) * 100 + c.slice(1).reduce((n, q, i) => n + Math.abs(q[0] - c[i][0]) + Math.abs(q[1] - c[i][1]), 0) / 10;
  // each committed wire's segments and bounding box, built once (rebuilt if a later pass swaps its points)
  const segCache = new WeakMap();
  const wireSegs = w => {
    let c = segCache.get(w);
    if (!c || c.pts !== w.pts) {
      const xs = w.pts.map(q => q[0]), ys = w.pts.map(q => q[1]);
      c = { pts: w.pts, segs: ptsSegs(w.pts), x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      segCache.set(w, c);
    }
    return c;
  };
  const countCrossings = cand => {
    let n = 0;
    const mine = ptsSegs(cand);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of cand) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
    for (const w of out.wires) {
      const c = wireSegs(w);
      if (c.x1 < x0 || c.x0 > x1 || c.y1 < y0 || c.y0 > y1) continue;
      for (const t of c.segs) for (const s of mine) {
      if (s.vert === t.vert) continue;
      const v = s.vert ? s : t, h = s.vert ? t : s;
      const hx1 = Math.min(h.x1, h.x2), hx2 = Math.max(h.x1, h.x2);
      const vy1 = Math.min(v.y1, v.y2), vy2 = Math.max(v.y1, v.y2);
      if (v.x1 > hx1 + 1 && v.x1 < hx2 - 1 && h.y1 > vy1 + 1 && h.y1 < vy2 - 1) n++;
      }
    }
    return n;
  };

  const crossesSiblings = (cand, groupNets) => {
    if (!groupNets.length) return false;
    const mine = ptsSegs(cand);
    for (const w of out.wires) {
      if (!groupNets.includes(w.net)) continue;
      for (const t of ptsSegs(w.pts)) for (const s of mine) {
        if (s.vert === t.vert) continue;
        const v = s.vert ? s : t, h = s.vert ? t : s;
        const hx1 = Math.min(h.x1, h.x2), hx2 = Math.max(h.x1, h.x2);
        const vy1 = Math.min(v.y1, v.y2), vy2 = Math.max(v.y1, v.y2);
        if (v.x1 > hx1 + 1 && v.x1 < hx2 - 1 && h.y1 > vy1 + 1 && h.y1 < vy2 - 1)
          return { sib: w.id, at: [v.x1, h.y1], seg: [s.x1, s.y1, s.x2, s.y2] };
      }
    }
    return false;
  };
  // tidy a path before it is drawn: repeated points, straight-through vertices,
  // retraced spikes, and a hairline jog (<4px) next to either end — that one is
  // removed by sliding the end point along its port edge (≤3px; a 1px kink where
  // two ports sit a pixel apart used to draw as a visible notch)
  const tidy = pts => {
    let p = pts.filter((q, i) => i === 0 || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1]).map(q => [q[0], q[1]]);
    const dropStraight = () => { for (let i = 1; i < p.length - 1; i++) {
      const [a, b, c] = [p[i - 1], p[i], p[i + 1]];
      if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) { p.splice(i, 1); i--; } } };
    dropStraight();
    if (p.length >= 4) {
      const n = p.length, [a, b] = [p[n - 3], p[n - 2]];          // jog before the last leg
      const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
      if (d > 0 && d < 4) { if (a[1] === b[1]) { p[n - 2][0] = a[0]; p[n - 1][0] = a[0]; } else { p[n - 2][1] = a[1]; p[n - 1][1] = a[1]; } }
    }
    if (p.length >= 4) {
      const [b, c] = [p[1], p[2]];                                 // jog after the first leg
      const d = Math.abs(b[0] - c[0]) + Math.abs(b[1] - c[1]);
      if (d > 0 && d < 4) { if (b[1] === c[1]) { p[0][0] = c[0]; p[1][0] = c[0]; } else { p[0][1] = c[1]; p[1][1] = c[1]; } }
    }
    p = p.filter((q, i) => i === 0 || q[0] !== p[i - 1][0] || q[1] !== p[i - 1][1]);
    dropStraight();
    return p;
  };
  // a hairline jog in the MIDDLE of a path (a riser that steps sideways <6px
  // on its way up) is straightened by sliding one neighbouring run onto the
  // other's line — only when the moved run crosses no body and overlaps no
  // other wire's lane; otherwise the wire keeps its jog (it was legal)
  const dejog = (pts, net) => {
    let p = pts;
    for (let guard = 0; guard < 6; guard++) {
      let changed = false;
      for (let i = 1; i + 2 < p.length && !changed; i++) {
        const a = p[i], b = p[i + 1], d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
        if (d === 0 || d >= 6) continue;
        const k = a[1] === b[1] ? 0 : 1;               // the coordinate the jog steps along
        const tries = [];
        if (i - 1 >= 1) tries.push([i - 1, i, b[k]]);                  // slide the run before the jog
        if (i + 2 <= p.length - 2) tries.push([i + 1, i + 2, a[k]]);   // …or the run after it
        for (const [u, v, val] of tries) {
          const q = p.map(r => [r[0], r[1]]); q[u][k] = val; q[v][k] = val;
          const ok = [[u - 1, u], [u, v], [v, v + 1]].filter(([x, y]) => x >= 0 && y < q.length).every(([x, y]) => {
            const [s1, s2] = [q[x], q[y]];
            if (s1[0] === s2[0] && s1[1] === s2[1]) return true;
            if (segBlocked(s1[0], s1[1], s2[0], s2[1], null)) return false;
            return s1[1] === s2[1] ? !conflicts(usedH, s1[1], s1[0], s2[0], net) : !conflicts(usedV, s1[0], s1[1], s2[1], net);
          });
          if (ok) { p = tidy(q); changed = true; break; }
        }
      }
      if (!changed) break;
    }
    return p;
  };
  const commit = (conn, cls, pts, extra = {}) => {
    const clean = cls.endsWith("-fallback") ? tidy(pts) : dejog(tidy(pts), nWire);
    const w = { id: wireId(conn), net: nWire++, cls, signal: conn.signal, scope: conn.scope || "included", from: conn.from, to: conn.to, pts: clean, hops: [], ...(conn.dante ? { dante: true } : {}), ...extra };
    // a fallback is known-bad geometry: draw it, but never let it poison the
    // registry and starve later (valid) wires
    if (!cls.endsWith("-fallback")) registerPath(clean, w.net);
    out.wires.push(w);
    return w;
  };

  /* --- terminal helpers --- */
  const feedsToEp = {}; // epId -> count of boundary feeds (for return straddle offsets)
  for (const c of visConns) {
    const comp = s.companions[c.to];
    const ep = ix.endpointsById[c.to] || (comp && ix.endpointsById[comp.serves]);
    if (ep && !s.locals[c.from]) feedsToEp[ep.id] = (feedsToEp[ep.id] || 0) + 1;
  }

  // resolve a zone-bound target: land on the card border (or the chip parked
  // under it) at the x aligned with the endpoint — the boundary principle
  const zoneTarget = conn => {
    const comp = s.companions[conn.to];
    if (comp && ix.endpointsById[comp.serves]) {
      const chip = chipById[conn.to];
      const { pz } = slotOf(comp.serves);
      return { tx: chip.x + chip.w / 2, landY: chip.y + chip.h, cardTop: pz.y, cardBot: pz.y + pz.h, pz, chipId: chip.id };
    }
    const { pz, cx } = slotOf(conn.to);
    const tx = conn.signal === "audioReturn" ? cx + RT.lane : cx;
    return { tx, landY: null, cardTop: pz.y, cardBot: pz.y + pz.h, pz };
  };

  /* ============ pass 1: fixed-geometry stubs (no allocation) ============ */
  const done = new Set();
  visConns.forEach((conn, i) => {
    const comp = s.companions[conn.from];
    if (comp && ix.endpointsById[comp.serves] && ix.endpointsById[conn.to]) {
      // chip parked at the card → its endpoint: short stub dying into the border
      const chip = chipById[conn.from];
      const { pz } = slotOf(conn.to);
      commit(conn, "stub", [[chip.x + chip.w / 2, chip.y], [chip.x + chip.w / 2, pz.y + pz.h]]);
      done.add(i);
    } else if (ix.endpointsById[conn.from] && s.companions[conn.to]?.serves === conn.from && chipById[conn.to]) {
      // the TV into its own chip (eARC into an AXIS): the same stub, pointing down
      const chip = chipById[conn.to];
      const { pz } = slotOf(conn.from);
      commit(conn, "stub", [[chip.x + chip.w / 2, pz.y + pz.h], [chip.x + chip.w / 2, chip.y]]);
      done.add(i);
    } else if (s.locals[conn.from] && ix.endpointsById[conn.to]) {
      // in-room source touches its display: the local-source exception
      const { pz, g } = slotOf(conn.to);
      const lt = pz.groups.flatMap(gr => gr.locals || (gr.local ? [gr.local] : [])).find(l => l.deviceId === conn.from);
      if (lt) commit(conn, "local", [[pz.x + lt.x + lt.w / 2, pz.y + lt.y], [pz.x + g.cx, pz.y + g.y + g.h]], { insideCard: pz.id });
      else out.warnings.push({ code: "no-local-slot", ref: conn.from, msg: `${describeNode(job, sol, conn.from).short} has no spot in its zone card` });
      done.add(i);
    } else if (ix.endpointsById[conn.from] && ix.endpointsById[conn.to] &&
               ix.endpointZone[conn.from] === ix.endpointZone[conn.to]) {
      // display feeds an in-room speaker (soundbar via eARC): connector inside
      // the card — down from the display, across, up into the speaker group
      const a = slotOf(conn.from), t = slotOf(conn.to);
      const pz = a.pz;
      const yb = pz.y + Math.max(a.g.y + a.g.h, t.g.y + t.g.h) + 8;
      commit(conn, "local", [[pz.x + a.g.cx - 14, pz.y + a.g.y + a.g.h], [pz.x + a.g.cx - 14, yb],
        [pz.x + t.g.cx, yb], [pz.x + t.g.cx, pz.y + t.g.y + t.g.h]], { insideCard: pz.id });
      done.add(i);
    } else if (ix.endpointsById[conn.from] && s.locals[conn.to]) {
      // display → local return encoder: the return is handled AT the TV;
      // a short stub beside the local-source stub, inside the card
      const { pz, g } = slotOf(conn.from);
      const lt = localSlotOf(conn.to);
      if (lt && lt.pz === pz) {
        const x1 = pz.x + g.cx + 14;
        commit(conn, "local", [[x1, pz.y + g.y + g.h], [x1, lt.pz.y + lt.l.y]], { insideCard: pz.id });
      } else out.warnings.push({ code: "no-local-slot", ref: conn.to, msg: `${describeNode(job, sol, conn.to).short} has no spot beside ${describeNode(job, sol, conn.from).short}` });
      done.add(i);
    }
  });

  /* ============ pass 2: right-edge fan-out plans (nesting rule) ============ */
  // classify a zone-bound conn's approach region
  const regionOf = t => {
    if (t.pz.band === "top") return "top";
    if (t.pz.band === "audio" || t.pz.band === "mid") return "audio";   // both sit east of the rack
    return "cluster";
  };
  const plans = []; // per source device: ordered wires + port ys
  for (const r of P.racks) for (const d of r.devices) {
    const outs = visConns.map((c, i) => ({ c, i })).filter(({ c, i }) => c.from === d.id && !done.has(i));
    if (!outs.length) continue;
    const zone = [], other = [];
    for (const o of outs) {
      const comp = s.companions[o.c.to];
      const isZone = ix.endpointsById[o.c.to] || (comp && ix.endpointsById[comp.serves]);
      (isZone ? zone : other).push(o);
    }
    for (const o of zone) { o.t = zoneTarget(o.c); o.region = regionOf(o.t); o.down = d.y + d.h / 2 < o.t.cardTop; }
    // nesting: farthest destination → top port for downward drops; the mirror
    // (nearest first) when the wire rises UP onto a card bottom border
    // nesting across stacked rows: ports go shallow-row-first (top), and riser
    // allocation direction makes deep rows take the risers nearer the rack /
    // gutter edge, so no riser ever pierces a shallower row's lane.
    const west = zone.filter(o => o.region === "top")
      .sort((a, b) => (b.t.cardTop - a.t.cardTop) || (a.t.tx - b.t.tx)); // deep ROW first → west riser
    const eastDown = zone.filter(o => o.region !== "top" && o.down).sort((a, b) => b.t.tx - a.t.tx);
    const eastUp = zone.filter(o => o.region !== "top" && !o.down)
      .sort((a, b) => (a.t.cardTop - b.t.cardTop) || (a.t.tx - b.t.tx)); // shallow ROW first → west riser
    const east = [...eastDown, ...eastUp];
    // if a col-C device sits in this device's row band, east stubs must exit
    // around it — give the east group the top ports in that case
    const cObstacle = (r.devices || []).some(d2 => d2.col === "C" && d2.x > d.x &&
      d2.y < d.y + d.h && d2.y + d2.h > d.y);
    const ordered = cObstacle && east.length ? [...east, ...west, ...other] : [...west, ...east, ...other];
    const [min, max] = portSpan(d);
    const mid = (min + max) / 2, n = ordered.length;
    const pitch = n > 1 ? Math.min(RT.portPitch, Math.max(10, (max - min) / (n - 1))) : RT.portPitch;
    ordered.forEach((o, k) => {
      o.portY = Math.max(min, Math.min(max, mid + (k - (n - 1) / 2) * pitch));
      (rightPorts[d.id] ||= []).push(o.portY);
      portPlan[wireId(o.c)] = o.portY;   // pass-4 classes reuse their reserved exit
    });
    plans.push({ dev: d, ordered, west, east, other,
      eastBandMinX: east.length ? Math.min(...east.map(o => o.t.pz.x)) : null });
  }

  /* --- input side: arrivals on a device's LEFT edge land in the order their
     sources stack (user redline 2026-09-28: ATV 1, ATV 2, cable box into an
     MXNet switch — first-come ports let the cable box take ATV 2's spot and
     forced a hop). Each target's feeds from the west are sorted by source
     height and given ports top-down, as close to straight across as spacing
     allows. Risers are ordered too: of the wires that rise onto their port, the
     lowest source rides nearest the target; of those that drop, the highest
     does — the two ways a pair can nest without crossing. --- */
  const leftPlan = {}, riserPlan = {};
  {
    const byTarget = {};
    visConns.forEach((c, i) => {
      if (done.has(i)) return;
      const compTo = s.companions[c.to];
      if (ix.endpointsById[c.to] || (compTo && ix.endpointsById[compTo.serves])) return;
      const b = devById[c.to]; if (!b) return;
      const a = devById[c.from], chip = chipById[c.from];
      let sy, sxR;
      if (a && b.x >= a.x + a.w) { sy = portPlan[wireId(c)] ?? a.y + a.h / 2; sxR = a.x + a.w; }
      else if (chip && !ix.endpointsById[s.companions[c.from]?.serves] && chip.x + chip.w <= b.x) { sy = chip.y + chip.h / 2; sxR = chip.x + chip.w; }
      else return;
      (byTarget[b.id] ||= []).push({ id: wireId(c), sy, sxR });
    });
    for (const [bid, list] of Object.entries(byTarget)) {
      const [min, max] = portSpan(devById[bid]);
      list.sort((p, q) => p.sy - q.sy || p.sxR - q.sxR);
      const n = list.length;
      const pitch = n > 1 ? Math.min(RT.lane, Math.max(10, (max - min) / (n - 1))) : RT.lane;
      const ys = list.map(p => Math.max(min, Math.min(max, p.sy)));
      for (let k = 1; k < n; k++) ys[k] = Math.max(ys[k], ys[k - 1] + pitch);
      if (ys[n - 1] > max) { ys[n - 1] = max; for (let k = n - 2; k >= 0; k--) ys[k] = Math.min(ys[k], ys[k + 1] - pitch); }
      if (ys[0] < min) for (let k = 0; k < n; k++) ys[k] = min + k * pitch;
      list.forEach((p, k) => { leftPlan[p.id] = ys[k]; p.ty = ys[k]; p.col = Math.round(devById[bid].x); });
    }
    // risers share the channel west of a column across ALL its devices (the AVB
    // switch feeding both Savant modules), so rank them per column by landing:
    // rising wires lowest-landing nearest the column, dropping ones highest-landing
    const byCol = {};
    for (const l of Object.values(byTarget)) for (const p of l) (byCol[p.col] ||= []).push(p);
    for (const [col, l] of Object.entries(byCol)) {
      const up = l.filter(p => p.ty < p.sy - 0.5).sort((p, q) => q.ty - p.ty);
      const dn = l.filter(p => p.ty > p.sy + 0.5).sort((p, q) => p.ty - q.ty);
      up.forEach((p, r) => { riserPlan[p.id] = { key: col + "u", r, n: up.length }; });
      dn.forEach((p, r) => { riserPlan[p.id] = { key: col + "d", r, n: dn.length }; });
    }
  }
  // rank 0 rides easternmost. A riser is centred in its channel like any other
  // (pushing them all against the target crowded busy gaps), and may only take
  // an x that keeps it in rank order with the ones already placed — the lane
  // allocator's slide past a taken x must never flip two of them
  const riserTaken = {};
  const riserRangeFor = (id, range) => {
    const rp = riserPlan[id]; if (!rp) return range;
    // bounded by the nearest placed rank each side, less a lane for every rank
    // between still to come (a riser routed early leaves room for them)
    const taken = riserTaken[rp.key] || new Map();
    let e = -1, w = rp.n;
    for (const r of taken.keys()) { if (r < rp.r && r > e) e = r; if (r > rp.r && r < w) w = r; }
    const hi = (e >= 0 ? taken.get(e) - RT.lane : range[1]) - RT.lane * (rp.r - e - 1);
    const lo = (w < rp.n ? taken.get(w) + RT.lane : range[0]) + RT.lane * (w - rp.r - 1);
    return [Math.max(range[0], lo), Math.min(range[1], hi)];
  };
  const riserWant = (id, range) => {
    const rp = riserPlan[id], c = (range[0] + range[1]) / 2;
    return rp ? Math.max(range[0], Math.min(range[1], c + ((rp.n - 1) / 2 - rp.r) * RT.lane)) : c;
  };
  const riserClaim = (id, w) => {
    const rp = riserPlan[id];
    const p = w?.pts, n = p?.length;   // the riser is the last vertical before the landing leg
    if (rp && n >= 4 && p[n - 3][0] === p[n - 2][0]) (riserTaken[rp.key] ||= new Map()).set(rp.r, p[n - 3][0]);
  };

  // trunk mode: the rack's network and Dante patches ride their trunks too (pass 4T)
  const TRUNK = trunkMode(job, opts);
  const SWITCHY = new Set(["avSwitch", "networkSwitch", "avbSwitch", "gateway"]);
  const rackOfDev = id => P.racks.find(r => r.devices.some(d => d.id === id));
  // …and so do its video and line-level audio patches — an analog line that carries several
  // runs (module → amp ×N) too: the trunk drawing counts its runs, not its one wire
  const rackPatchFam = conn => TRUNK && devById[conn.from] && devById[conn.to] && rackOfDev(conn.from) === rackOfDev(conn.to)
    ? (conn.dante ? "dante" : conn.signal === "network" ? "network" : conn.signal === "video" ? "video"
      : conn.signal === "audio" ? "audio" : null) : null;

  // …and a link between two racks rides an inter-rack trunk, one per signal type (routed after the
  // rooms' trunks, so it can pick the corridor the finished sheet crosses least)
  const linkFam = conn => TRUNK && devById[conn.from] && devById[conn.to] && rackOfDev(conn.from) !== rackOfDev(conn.to)
    ? (conn.dante ? "dante" : conn.signal === "network" ? "network" : conn.signal === "video" ? "video"
      : conn.signal === "audio" ? "audio" : null) : null;

  /* ============ pass 3: rigid non-zone wires FIRST (short structural runs
     claim their channels; zone feeds are flexible and relaxable) ============ */
  visConns.forEach((conn, i) => {
    if (done.has(i)) return;
    const compTo = s.companions[conn.to];
    if (ix.endpointsById[conn.to] || (compTo && ix.endpointsById[compTo.serves])) return; // zone-bound: pass 4
    const fromDev = devById[conn.from], toDev = devById[conn.to];
    const fromChip = chipById[conn.from], toChip = chipById[conn.to];

    if (fromDev && toDev) { if (rackPatchFam(conn) || linkFam(conn)) return; routeRackToRack(conn, fromDev, toDev); done.add(i); return; }
    if (fromDev && toChip) { routeDevToChip(conn, fromDev, toChip); done.add(i); return; }
    // a chip parked under a TV sending to the rack (Dante: AXIS/DANTE-DV2 → amp) leaves the zone like a return (pass 4c)
    if (fromChip && toDev && ix.endpointsById[s.companions[conn.from]?.serves]) return;
    if (fromChip && toDev) { routeChipToDev(conn, fromChip, toDev); done.add(i); return; }
    if ((ix.endpointsById[conn.from] || s.locals[conn.from]) && toDev) return; // returns + local backhauls route LAST (pass 4c)
    out.warnings.push({ code: "unrouted", msg: `no route class for ${wireId(conn)}` });
  });

  /* ============ pass 4T: TRUNKS (trunk mode only) ============
     One trunk per signal type (Ryan 2026-09-30). Every room-bound feed of a
     family — video, speakers, Dante, audio returns — rides ONE shared net:
       rack end:  its own jack → an on-ramp → the family's riser in the rack
                  corridor (right of the sources for feeds out, left of the
                  targets for feeds in: every input lands on its input edge)
       spine:     the riser up to a bus in the strip under each row of rooms,
                  buses stacked busiest-nearest-the-rooms; upper rows reached
                  through a gap between the cards below (or the west gutter)
       room end:  straight up/down off the bus into its room, or — for rooms
                  beside/below the rack — the cheapest legal breakout off the
                  riser or bus (a room next to its amp fans out right there)
     Shared runs are one conductor (one net), so the registry and the hop pass
     treat a trunk as a single line — legal by construction, like the harness.
     A feed the trunk can't carry legally is left to passes 4a–4c. */
  if (TRUNK && P.racks.length) {
    // several racks: each builds its own trunks from its own boxes (a family per rack)
    const colRight = col => { const t = allDevs.filter(d => d.col === col); return t.length ? Math.max(...t.map(d => d.x + d.w)) : null; };
    const eastRange = [(colRight("C") ?? colRight("B") ?? rackRight) + 8, rackRight + (corRight?.w || 90) - 6];
    const gapRightOf = col => col === "A" ? gapABx : col === "B" ? (colX("C") != null ? gapBCx : eastRange) : eastRange;
    const gapLeftOf = col => col === "C" ? gapBCx : col === "B" ? gapABx : [westMarginX[0], PL.colA - 6];
    const famOf = c => c.dante ? "dante" : c.signal;
    const segLen = pts => pts.slice(1).reduce((n, q, i) => n + Math.abs(q[0] - pts[i][0]) + Math.abs(q[1] - pts[i][1]), 0);
    const cleanPts = pts => pts.filter((q, k) => k === 0 || q[0] !== pts[k - 1][0] || q[1] !== pts[k - 1][1]);

    /* -- the members: room-bound feeds out (from the plans) and room→rack feeds in -- */
    const members = [];
    for (const plan of plans) for (const o of [...plan.west, ...plan.east]) {
      if (done.has(o.i)) continue;
      members.push({ dir: "out", c: o.c, i: o.i, dev: plan.dev, port: o.portY, t: o.t, fam: famOf(o.c) });
    }
    visConns.forEach((c, i) => {
      if (done.has(i) || !devById[c.to]) return;
      const zc = s.companions[c.from];
      const origin = ix.endpointsById[c.from] ? c.from : zc && ix.endpointsById[zc.serves] ? zc.serves : null;
      if (!origin) return;
      const { pz, cx } = slotOf(origin);
      const chip = zc ? chipById[c.from] : null;
      const compChip = !zc ? (sol.companions || []).find(k => k.serves === origin && chipById[k.id]) : null;
      // leave the room beside the video landing: off its own chip, or just right of the TV's feed
      const sx = chip ? chip.x + chip.w / 2 + 14 : cx + (compChip ? chipById[compChip.id].w / 2 + 8 : RT.lane);
      const sy = chip ? chip.y + chip.h : pz.y + pz.h;
      members.push({ dir: "in", c, i, dev: devById[c.to], t: { tx: sx, landY: chip ? sy : null, cardTop: pz.y, cardBot: pz.y + pz.h, pz, chipId: chip?.id }, fam: famOf(c) });
    });

    // rack patches: Dante into an amp joins the Dante trunk; network rides its own,
    // the switch always the source (out its right edge, into the box's left edge)
    visConns.forEach((c, i) => {
      if (done.has(i)) return;
      const fam = rackPatchFam(c); if (!fam) return;
      let a = devById[c.from], b = devById[c.to];
      const typ = d => s.devices[d.id]?.type;
      if (fam === "network" && SWITCHY.has(typ(b)) && !SWITCHY.has(typ(a))) [a, b] = [b, a];
      members.push({ dir: fam === "dante" ? "in" : fam === "network" ? "net" : "patch", rack: true, c, i, src: a, dev: b, fam });
    });

    /* -- rows of the top band, bottom row first; each row's strip under its cards -- */
    const topZones = P.zones.filter(z => z.band === "top");
    const rowYs = [...new Set(topZones.map(z => z.y))].sort((a, b) => b - a);
    const rows = rowYs.map(y => {
      const zs = topZones.filter(z => z.y === y);
      const chipsHere = P.chips.filter(ch => zs.some(z => ch.x < z.x + z.w && ch.x + ch.w > z.x && ch.y >= z.y + z.h - 1 && ch.y < z.y + z.h + 60));
      const bot = Math.max(...zs.map(z => z.y + z.h), ...chipsHere.map(ch => ch.y + ch.h));
      return { y, zs, bot, x0: Math.min(...zs.map(z => z.x)), x1: Math.max(...zs.map(z => z.x + z.w)) };
    });
    const rowOf = pz => rows.find(r => r.zs.includes(pz));
    // secondary areas (other floors, outdoor) sit to the right as their own clusters:
    // each cluster row gets a bus too, reached up a gutter just west of the cluster
    const clusterOf = pz => (P.clusters || []).findIndex((cl, k) => k > 0 && pz.x >= cl.x0 - 1 && pz.x <= cl.x1 + 1);
    const crows = [];
    for (const z of P.zones.filter(z => z.band === "cluster")) {
      const k = clusterOf(z); if (k < 1) continue;
      let r = crows.find(r => r.k === k && r.y === z.y);
      if (!r) crows.push(r = { k, y: z.y, zs: [] });
      r.zs.push(z);
    }
    for (const r of crows) {
      const chipsHere = P.chips.filter(ch => r.zs.some(z => ch.x < z.x + z.w && ch.x + ch.w > z.x && ch.y >= z.y + z.h - 1 && ch.y < z.y + z.h + 60));
      r.bot = Math.max(...r.zs.map(z => z.y + z.h), ...chipsHere.map(ch => ch.y + ch.h));
      r.x0 = Math.min(...r.zs.map(z => z.x)); r.x1 = Math.max(...r.zs.map(z => z.x + z.w));
      const prev = P.clusters[r.k - 1];
      r.gutter = [prev.x1 + 8, P.clusters[r.k].x0 - 8];
    }
    const crowOf = pz => crows.find(r => r.zs.includes(pz));
    // how far down a row's strip reaches over [x0, x1]: the first body below it
    const stripFloor = (row, x0, x1) => {
      const below = obstacles.filter(o => o.y > row.bot + 2 && o.x < x1 && o.x + o.w > x0).map(o => o.y);
      return below.length ? Math.min(...below) : row.bot + 220;
    };

    /* -- families: outbound feeds climb a riser right of their sources; inbound
          feeds descend one left of their targets. Busiest family nearest the rooms. -- */
    const fams = {};
    for (const m of members) {
      const rk = rackOfDev(m.dev.id);
      // rack patches rise beside their own source column (a col-A source into the col-B matrix
      // lands straight across the A|B gap instead of looping back from beyond column B)
      const key = `${m.dir}:${m.fam}` + (m.dir === "patch" || m.dir === "net" ? `#${m.src.col || "B"}` : "") + (P.racks.length > 1 ? `@${rk.id}` : "");
      (fams[key] ||= { key, dir: m.dir, rack: rk, members: [] }).members.push(m);
    }
    const famList = Object.values(fams).sort((a, b) => b.members.length - a.members.length || (a.dir === "out" ? -1 : 1));
    const colRank = { A: 0, B: 1, C: 2 };

    // a family's whole route, re-runnable: cfg can move its riser (range / want) or stack its
    // buses farthest from the rooms; every port it books is recorded so it can be ripped up
    // the points where wire w crosses wires of any other net (a family's crossings are the union)
    function crossPointsInto(w, net, pts) {
      const c = wireSegs(w);
      for (const o of out.wires) {
        if (o.net === net) continue;
        const d = wireSegs(o);
        if (d.x1 < c.x0 || d.x0 > c.x1 || d.y1 < c.y0 || d.y0 > c.y1) continue;
        for (const s of c.segs) for (const t of d.segs) {
          if (s.vert === t.vert) continue;
          const v = s.vert ? s : t, h = s.vert ? t : s;
          if (v.x1 > Math.min(h.x1, h.x2) + 1 && v.x1 < Math.max(h.x1, h.x2) - 1 && h.y1 > Math.min(v.y1, v.y2) + 1 && h.y1 < Math.max(v.y1, v.y2) - 1) pts.add(`${v.x1},${h.y1}`);
        }
      }
    }
    let trialMode = false;
    const routeFam = (F, cfg = {}) => {
      const net = F.net;
      F.cfg = cfg;
      F.ports = [];
      F.blockers = null; F.repairable = false;
      // a trial with a bound to beat stops as soon as what it has drawn already costs more — crossing
      // points and length only grow as wires are added, so a stopped trial could never have won
      F.aborted = false;
      const tally = cfg.bound != null ? { pts: new Set(), len: 0 } : null;
      const over = w => {
        if (!tally || !w) return false;
        crossPointsInto(w, F.net, tally.pts); tally.len += segLen(w.pts);
        return (F.aborted = tally.pts.size * 100 + tally.len / 10 >= cfg.bound);
      };
      // a member the trial can't place costs 1e5 (famCost's price) — usually more than the bound already
      const missed = () => { if (!tally) return false; tally.len += 1e6; return (F.aborted = tally.pts.size * 100 + tally.len / 10 >= cfg.bound); };
      const book = (store, id, y) => { (store[id] ||= []).push(y); F.ports.push([store, id, y]); };
      // riser column: right of the rightmost source column (out) / left of the leftmost target column (in)
      // network patches rise beside their switches; everything coming in, beside its targets
      const cols = F.members.map(m => (F.dir === "net" || F.dir === "patch" ? m.src.col : m.dev.col) || "B");
      const col = F.dir !== "in" ? cols.reduce((a, b) => colRank[b] > colRank[a] ? b : a) : cols.reduce((a, b) => colRank[b] < colRank[a] ? b : a);
      const rRange = cfg.range || (F.dir === "in" ? gapLeftOf(col) : gapRightOf(col));
      const why = (m, r) => { if (opts.debug && !trialMode) (out.trunkSkips ||= []).push(`${F.key} ${m ? wireId(m.c) : "*"}: ${r}`); };
      // ribbon: a trunk is as wide as its wires side by side — keep other nets off that width
      const half = TRUNK === "ribbon" ? Math.min(RIBBON_MAX - 1, F.members.length - 1) * RIBBON_PITCH / 2 : 0;
      const widen = (used, c, a1, a2) => { if (half < 4) return; for (const d of [-half, half]) used.push({ c: c + d, a1: Math.min(a1, a2), a2: Math.max(a1, a2), net }); };
      if (!(rRange[1] > rRange[0])) { why(null, "no riser channel"); return; }
      // buses: one per top-band row this family reaches
      const inRow = new Map(), inCrow = new Map();
      for (const m of F.members) {
        if (m.rack) continue;
        const r = m.t.pz.band === "top" ? rowOf(m.t.pz) : null; if (r) (inRow.get(r) || inRow.set(r, []).get(r)).push(m);
        const cr = m.t.pz.band === "cluster" ? crowOf(m.t.pz) : null; if (cr) (inCrow.get(cr) || inCrow.set(cr, []).get(cr)).push(m);
      }

      F.bus = new Map();
      const lowRow = rows[0];
      const busRows = rows.filter((r, k) => inRow.has(r) || rows.slice(k + 1).some(r2 => inRow.has(r2)) || (k === 0 && inRow.size));
      // an upper row is reached from the one below through a clear vertical: a gap
      // between the lower row's cards nearest the riser, else the west gutter
      for (const r of busRows) {
        const xs = [...(inRow.get(r) || []).map(m => m.t.tx), rRange[0], rRange[1]];
        let x0 = Math.min(...xs) - 4, x1 = Math.max(...xs) + 4;
        if (r !== lowRow) x0 = Math.min(x0, westMarginX[0]);
        const floor = stripFloor(r, x0, x1);
        const range = [r.bot + 10, floor - 10];
        const y = range[1] >= range[0] ? alloc(usedH, cfg.busFar ? range[1] : range[0], x0, x1, net, cfg.busFar ? -1 : +1, yy => !!segBlocked(x0, yy, x1, yy, null), range) : null;
        if (y == null) { why(null, `no bus lane under row y=${r.y} (strip ${range[0]}–${range[1]})`); break; }
        F.bus.set(r, y); widen(usedH, y, x0, x1);
      }
      if (inRow.size && !F.bus.has(lowRow)) { why(null, "no bus under the bottom row"); return; }   // no strip for this family: the classic passes take it
      const busY = F.bus.get(lowRow);
      // riser: spans from the bus (or the rack top) down to the lowest rack jack of the family
      const jackYs = F.members.flatMap(m => m.dir === "out" ? [m.port] : [m.dev.y + m.dev.h / 2, ...(m.rack ? [m.src.y + m.src.h / 2] : [])]);
      const rkTop = F.rack.y, rkBot = F.rack.y + F.rack.h;
      const rTop = busY ?? (inRow.size || inCrow.size ? rkTop + 6 : Math.min(...jackYs) - RT.lane * 3), rBot = Math.max(...jackYs) + RT.lane * 3;
      // side of the corridor: network hugs its switches, feeds coming in hug their targets,
      // feeds going out sit between — so each family's on-ramps and branches meet the fewest risers
      const want = cfg.want ?? (F.dir === "net" ? rRange[0] + RT.lane : F.dir === "in" ? rRange[1] - RT.lane : (rRange[0] + rRange[1]) / 2);
      const rx = alloc(usedV, Math.max(rRange[0], Math.min(rRange[1], want)), rTop, rBot, net, 0, xx => !!segBlocked(xx, rTop, xx, Math.max(...jackYs), null), rRange);
      if (rx == null) { why(null, `no riser x in ${rRange}`); return; }
      widen(usedV, rx, rTop, rBot);
      // connectors to the upper rows
      const up = new Map();
      for (let k = 1; k < rows.length; k++) {
        const r = rows[k]; if (!F.bus.has(r)) continue;
        const yLo = F.bus.get(rows[0]), yHi = F.bus.get(r);
        const gaps = [];
        for (const rr of rows.slice(0, k)) {
          const zs = [...rr.zs].sort((a, b) => a.x - b.x);
          for (let j = 1; j < zs.length; j++) gaps.push(Math.round((zs[j - 1].x + zs[j - 1].w + zs[j].x) / 2));
        }
        gaps.sort((a, b) => Math.abs(a - rx) - Math.abs(b - rx));
        let cx = null;
        for (const g of [...gaps, (westMarginX[0] + westMarginX[1]) / 2]) {
          const gx = alloc(usedV, g, yHi, yLo, net, 0, xx => !!segBlocked(xx, yHi, xx, yLo, null), [g - 18, g + 18]);
          if (gx != null) { cx = gx; break; }
        }
        if (cx != null) up.set(r, cx);
      }

      // cluster rows: a bus under each, and one gutter riser per cluster from the express run
      const cgut = new Map();
      for (const [r, ms] of inCrow) {
        const x0 = r.gutter[0], x1 = Math.max(...ms.map(m => m.t.tx)) + 4;
        const floor = (() => { const below = obstacles.filter(o => o.y > r.bot + 2 && o.x < x1 && o.x + o.w > x0).map(o => o.y); return below.length ? Math.min(...below) : r.bot + 220; })();
        const range = [r.bot + 10, floor - 10];
        const y = range[1] >= range[0] ? alloc(usedH, range[0], x0, x1, net, +1, yy => !!segBlocked(x0, yy, x1, yy, null), range) : null;
        if (y == null) { why(null, `no bus lane under cluster row y=${r.y}`); continue; }
        F.bus.set(r, y); widen(usedH, y, x0, x1);
      }
      // each cluster: an express level with a clear run from the riser to its gutter
      // (over the rack first, then under it), and a gutter riser to its row buses
      for (const k of new Set([...inCrow.keys()].map(r => r.k))) {
        const rowYs = [...inCrow.keys()].filter(r => r.k === k && F.bus.has(r)).map(r => F.bus.get(r));
        if (!rowYs.length) continue;
        const g = [...inCrow.keys()].find(r => r.k === k).gutter, gmid = (g[0] + g[1]) / 2;
        const levels = [];
        const hiY = busY ?? (lowRow ? lowRow.bot + 10 : rkTop - 60);
        // the clear level nearest the family's own jacks: straight across when nothing's in the way
        const jackMid = (Math.min(...jackYs) + Math.max(...jackYs)) / 2;
        for (let y = hiY; y <= rkBot + 320; y += RT.lane) levels.push(Math.round(y));
        levels.sort((a, b) => Math.abs(a - jackMid) - Math.abs(b - jackMid));
        // of the clear levels, the one the rest of the sheet crosses least, then the nearest
        let got = null, gotCost = Infinity, tried = 0;
        for (const ey of levels) {
          if (tried >= 40) break;
          if (segBlocked(rx, ey, g[1], ey, null) || conflicts(usedH, ey, rx, gmid, net)) continue;
          // the riser has to reach that level from the family's jacks, clear of bodies and other nets
          const vy0 = Math.min(ey, ...jackYs), vy1 = Math.max(ey, ...jackYs);
          if (segBlocked(rx, vy0, rx, vy1, null) || conflicts(usedV, rx, vy0, vy1, net)) continue;
          const lo = Math.min(ey, ...rowYs), hi = Math.max(ey, ...rowYs);
          const gx = alloc(usedV, gmid, lo, hi, net, 0, xx => !!segBlocked(xx, lo, xx, hi, null), g);
          if (gx == null) continue;
          tried++;
          const cost = countCrossings([[rx, ey], [gx, ey], [gx, lo === ey ? hi : lo]]) * 100 + Math.abs(ey - jackMid) / 4;
          if (cost < gotCost) { gotCost = cost; got = { ey, gx }; }
        }
        if (!got) { why(null, `no express run to cluster ${k}`); continue; }
        cgut.set(k, got);
      }

      /* -- each member: rack end + spine + room end, the cheapest legal one -- */
      // box → riser → box, for a patch inside the rack; the target end loops round to the
      // box's LEFT edge through a free level between boxes when the box sits left of the riser
      const rackPatch = m => {
        const a = m.src, b = m.dev, sx = a.x + a.w;
        // jack heights to try on the source's right edge (the first free ones round its middle)
        const pys = [...new Set([0, 1, -1, 2, -2, 3, -3].map(k => peekPort(rightPorts, a, a.y + a.h / 2 + k * RT.lane)))];
        let best = null, bestCost = Infinity, bestPy = null, bestTy = null;
        const fails = [], onCache = new Map();
        const consider = (pts, py, ty) => {
          pts = cleanPts(pts);
          const bl = pathBlocked(pts, null);
          if (bl || !pathRegisterable(pts, net)) { fails.push(`${JSON.stringify(pts)} ${bl ? "blocked by " + bl : "lane taken"}`); return; }
          const cost = countCrossings(pts) * 100 + segLen(pts);
          if (cost < bestCost) { bestCost = cost; best = pts; bestPy = py; bestTy = ty; }
        };
        // landing heights on the target's left edge: nearest the source jack first, then round it
        const tyFor = py => [...new Set([0, -1, 1, -2, 2, -3, 3].map(k => peekPort(leftPorts, b, Math.max(b.y, Math.min(b.y + b.h, py)) + k * RT.lane)))];
        for (const py of pys) for (const ty0 of tyFor(py)) {
        // a box in the switch's own column (or left of it): a local staple — out, down the gap
        // beside the switch, across a free level between boxes, into its left edge
        if (b.x <= sx) {
          const gR = gapRightOf(a.col || "B"), gL = gapLeftOf(b.col || "B");
          for (let k = 0; k <= 12; k++) for (const sgn of k ? [1, -1] : [1]) {
            const gy = (py + ty0) / 2 + sgn * k * RT.lane;
            const gx = alloc(usedV, gR[0] + RT.lane / 2, Math.min(py, gy), Math.max(py, gy), net, +1, xx => !!segBlocked(xx, Math.min(py, gy), xx, Math.max(py, gy), null), gR);
            const ax = alloc(usedV, gL[1] - RT.lane / 2, Math.min(gy, ty0), Math.max(gy, ty0), net, -1, xx => !!segBlocked(xx, Math.min(gy, ty0), xx, Math.max(gy, ty0), null), gL);
            if (gx != null && ax != null) consider([[sx, py], [gx, py], [gx, gy], [ax, gy], [ax, ty0], [b.x, ty0]], py, ty0);
          }
          continue;
        }
        const onKey = `${py}`;
        let on = onCache.has(onKey) ? onCache.get(onKey) : null;
        if (!onCache.has(onKey)) {
        const direct = [[sx, py], [rx, py]];
        if (!pathBlocked(direct, null) && pathRegisterable(direct, net)) on = direct;
        else { const g = gapRightOf(a.col || "B");
          for (let k = 1; k <= 10 && !on; k++) for (const sgn of [1, -1]) { const ly = py + sgn * k * RT.lane;
            const gx = alloc(usedV, (g[0] + g[1]) / 2, Math.min(py, ly), Math.max(py, ly), net, 0, xx => !!segBlocked(xx, Math.min(py, ly), xx, Math.max(py, ly), null), g);
            if (gx == null) continue;
            const q = [[sx, py], [gx, py], [gx, ly], [rx, ly]]; if (!pathBlocked(q, null) && pathRegisterable(q, net)) { on = q; break; } } }
        onCache.set(onKey, on);
        }
        if (!on) { fails.push(`no on-ramp at y=${py} to riser x=${rx}`); continue; }
        const tails = [];
        if (b.x > rx) tails.push([[rx, ty0], [b.x, ty0]]);
        else { const g = gapLeftOf(b.col || "B");
          for (let k = 0; k <= 12; k++) for (const sgn of k ? [-1, 1] : [1]) { const gy = ty0 + sgn * k * RT.lane;
            const ax = alloc(usedV, (g[0] + g[1]) / 2, Math.min(gy, ty0), Math.max(gy, ty0), net, 0, xx => !!segBlocked(xx, Math.min(gy, ty0), xx, Math.max(gy, ty0), null), g);
            if (ax != null) tails.push([[rx, gy], [ax, gy], [ax, ty0], [b.x, ty0]]); } }
        for (const tail of tails) consider([...on, ...tail], py, ty0);
        }
        if (!best) { m.whyNot = fails.slice(0, 2).join(" ; ") || "no candidates"; return null; }
        book(rightPorts, a.id, bestPy); book(leftPorts, b.id, bestTy);
        return best;
      };

      for (const m of F.members) {
        if (m.rack) {
          const pts = rackPatch(m);
          if (!pts) { F.repairable = true; why(m, `rack patch: ${m.whyNot}`); if (missed()) return; continue; }
          const cw = commit(m.c, "trunk", pts, { net, group: "trunk-" + F.key, trunk: F.key, rackPatch: true });
          done.add(m.i);
          if (over(cw)) return;
          continue;
        }
        const dev = m.dev, t = m.t;
        // rack end, written rack→spine: [points…, join on the riser]
        let rackEnd = null;
        if (m.dir === "out") {
          const sx = dev.x + dev.w, py = m.port;
          const direct = [[sx, py], [rx, py]];
          if (!pathBlocked(direct, null) && pathRegisterable(direct, net)) rackEnd = direct;
          else {
            // around a column in the way: step into the gap beside the source, to a free level, then across
            const g = gapRightOf(dev.col || "B");
            for (let k = 1; k <= 12 && !rackEnd; k++) for (const sgn of [1, -1]) {
              const ly = py + sgn * k * RT.lane;
              if (ly < rkTop + 8 || ly > rkBot + 60) continue;
              const gx = alloc(usedV, (g[0] + g[1]) / 2, Math.min(py, ly), Math.max(py, ly), net, 0, xx => !!segBlocked(xx, Math.min(py, ly), xx, Math.max(py, ly), null), g);
              if (gx == null) continue;
              const p = [[sx, py], [gx, py], [gx, ly], [rx, ly]];
              if (!pathBlocked(p, null) && pathRegisterable(p, net)) { rackEnd = p; break; }
            }
          }
        } else {
          const ty = peekPort(leftPorts, dev, dev.y + dev.h / 2);
          const p = [[rx, ty], [dev.x, ty]];
          if (!pathBlocked(p, null) && pathRegisterable(p, net)) rackEnd = [[dev.x, ty], [rx, ty]];   // written rack→spine
          else {
            // a riser elsewhere (east of the box, or out in the west margin): in at the box's left edge
            // from the gap beside it, reached along a free level between boxes
            const g = gapLeftOf(dev.col || "B");
            for (let k = 1; k <= 12 && !rackEnd; k++) for (const sgn of [-1, 1]) {
              const ly = ty + sgn * k * RT.lane;
              if (ly < rkTop + 8 || ly > rkBot + 60) continue;
              const ax = alloc(usedV, (g[0] + g[1]) / 2, Math.min(ty, ly), Math.max(ty, ly), net, 0, xx => !!segBlocked(xx, Math.min(ty, ly), xx, Math.max(ty, ly), null), g);
              if (ax == null) continue;
              const q = cleanPts([[dev.x, ty], [ax, ty], [ax, ly], [rx, ly]]);
              if (!pathBlocked(q, null) && pathRegisterable(q, net)) { rackEnd = q; break; }
            }
          }
          m.ty = ty;
        }
        if (!rackEnd) { F.repairable = true; why(m, "no on-ramp"); if (missed()) return; continue; }
        const join = rackEnd[rackEnd.length - 1];
        // room end candidates, each written spine→room, starting on the spine
        const land = t.landY ?? (t.cardBot);
        const cands = [];
        const row = t.pz.band === "top" ? rowOf(t.pz) : null;
        const crow = t.pz.band === "cluster" ? crowOf(t.pz) : null;
        if (crow) {
          const e = cgut.get(crow.k);
          if (F.bus.has(crow) && e) cands.push([[rx, e.ey], [e.gx, e.ey], [e.gx, F.bus.get(crow)], [t.tx, F.bus.get(crow)], [t.tx, land]]);
        } else if (row && F.bus.has(row)) {
          const by = F.bus.get(row);
          const viaRow = row === lowRow ? [[rx, busY]] : up.has(row) ? [[rx, busY], [up.get(row), busY], [up.get(row), by]] : null;
          if (viaRow) {
            cands.push([...viaRow, [t.tx, by], [t.tx, land]]);
            // the straight drop can land in a neighbouring ribbon's band: step aside on the bus, rise,
            // and come across to the landing just below it
            // …or land off-centre: anywhere along an adapter chip's bottom edge is still its jack side
            const ch = t.chipId && chipById[t.chipId];
            if (ch) for (const k of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) {
              const xl = t.tx + k * RT.lane;
              if (xl > ch.x + 6 && xl < ch.x + ch.w - 6) cands.push([...viaRow, [xl, by], [xl, land]]);
            }
            const yj = land + (by > land ? 8 : -8);
            if (Math.abs(by - land) > 14) for (const k of [1, -1, 2, -2, 3, -3, 4, -4]) {
              const xj = t.tx + k * RT.lane * 2;
              cands.push([...viaRow, [xj, by], [xj, yj], [t.tx, yj], [t.tx, land]]);
            }
          }
        } else {
          // beside/below the rack: break out of the riser or the lowest bus
          const picks = [];
          for (let y = Math.min(join[1], rTop); y <= Math.max(join[1], rBot); y += RT.lane) picks.push([[rx, y]]);
          if (busY != null) for (let x = Math.min(rx, t.tx - 240); x <= Math.max(rx, t.tx + 240); x += 24) picks.push([[rx, busY], [x, busY]]);
          const above = t.landY == null && join[1] < t.cardTop;
          const L = t.landY ?? (above ? t.cardTop : t.cardBot);
          for (const pre of picks) {
            const B = pre[pre.length - 1];
            if (t.landY != null ? B[1] >= L + 8 : above ? B[1] <= L - 8 : B[1] >= L + 8) cands.push([...pre, [t.tx, B[1]], [t.tx, L]]);
            for (let k = 1; k <= 4; k++) {
              const y2 = (t.landY != null || !above) ? L + 2 + k * RT.lane : L - 2 - k * RT.lane;
              cands.push([...pre, [B[0], y2], [t.tx, y2], [t.tx, L]]);
            }
          }
        }
        let best = null, bestCost = Infinity;
        const skipLand = new Set([t.chipId, t.chipId ? null : t.pz.id].filter(Boolean));
        for (const roomEnd of cands) {
          const fwd = cleanPts([...rackEnd.slice(0, -1), join, ...roomEnd]);
          const len = segLen(fwd);
          if (len >= bestCost) continue;
          // the landing body is exempt only for the final leg
          if (pathBlocked(fwd.slice(0, -1), null) || pathBlocked(fwd.slice(-2), skipLand) || !pathRegisterable(fwd, net)) continue;
          const cost = countCrossings(fwd) * 100 + len;
          if (cost < bestCost) { bestCost = cost; best = fwd; }
        }
        if (!best) {
          if (cands.length) F.repairable = true;   // it had routes to try — a neighbour may be in the way
          // which nets' lanes walled it off (the repair pass below tries moving just those families)
          for (const c of cands.slice(0, 12)) { const f = cleanPts([...rackEnd.slice(0, -1), join, ...c]); const n = blockingNet(f, net); if (n != null) (F.blockers ||= new Set()).add(n); }
          const c0 = cands[0] && cleanPts([...rackEnd.slice(0, -1), join, ...cands[0]]);
          why(m, `no legal room end (${cands.length} tried, row ${row ? (F.bus.has(row) ? "bus ok" : "no bus") : "none"}, up ${row && up.has(row)})` +
            (c0 ? ` first ${JSON.stringify(c0)}: ${pathBlocked(c0.slice(0, -1), null) || pathBlocked(c0.slice(-2), skipLand) || (!pathRegisterable(c0, net) ? "lane taken " + takenBy(c0, net) : "?")}` : "") +
            (opts.debug ? " | " + cands.slice(1, 9).map(c => { const f = cleanPts([...rackEnd.slice(0, -1), join, ...c]); return pathBlocked(f.slice(0, -1), null) || pathBlocked(f.slice(-2), skipLand) || takenBy(f, net) || "ok?"; }).join(" | ") : ""));
          if (missed()) return;
          continue;
        }
        const pts = m.dir === "out" ? best : [...best].reverse();
        if (m.dir === "in") book(leftPorts, dev.id, m.ty);
        const cw = commit(m.c, "trunk", pts, { net, group: "trunk-" + F.key, trunk: F.key });
        done.add(m.i);
        if (over(cw)) return;
      }
    };
    for (const F of famList) { F.net = nWire++; routeFam(F); }

    /* -- inter-rack trunks: every link between two racks of one signal type shares a riser that
          spans both racks. Each corridor (beside each column, the east corridor, the west margin)
          is tried in full — the family routed, scored by crossings then length, rolled back — and
          the cheapest is drawn. A link no corridor carries goes to the classic staple below. -- */
    const links = {};
    visConns.forEach((c, i) => {
      if (done.has(i)) return;
      const fam = linkFam(c); if (!fam) return;
      let a = devById[c.from], b = devById[c.to];
      const typ = d => s.devices[d.id]?.type;
      if (fam === "network" && SWITCHY.has(typ(b)) && !SWITCHY.has(typ(a))) [a, b] = [b, a];
      const pair = [rackOfDev(a.id).id, rackOfDev(b.id).id].sort().join("+");
      const key = `link:${fam}` + (P.racks.length > 2 ? `~${pair}` : "");
      (links[key] ||= { key, members: [] }).members.push({ c, i, src: a, dev: b, fam });
    });
    const linkPatch = (m, rx, net) => {
      const a = m.src, b = m.dev, sx = a.x + a.w;
      const pys = [...new Set([0, 1, -1, 2, -2].map(k => peekPort(rightPorts, a, a.y + a.h / 2 + k * RT.lane)))];
      const ok = pts => !pathBlocked(pts, null) && pathRegisterable(pts, net);
      const vClear = (x, y1, y2) => !segBlocked(x, Math.min(y1, y2), x, Math.max(y1, y2), null);
      let best = null, bestCost = Infinity, bestPy = null, bestTy = null;
      for (const py of pys) {
        // on to the riser: straight across when it lies east of the jack, else down the gap beside the box to a free level
        let on = null;
        if (rx > sx && ok([[sx, py], [rx, py]])) on = [[sx, py], [rx, py]];
        else { const g = gapRightOf(a.col || "B");
          for (let k = 1; k <= 10 && !on; k++) for (const sgn of [1, -1]) { const ly = py + sgn * k * RT.lane;
            const gx = alloc(usedV, (g[0] + g[1]) / 2, Math.min(py, ly), Math.max(py, ly), net, 0, xx => !vClear(xx, py, ly), g);
            if (gx == null) continue;
            const q = cleanPts([[sx, py], [gx, py], [gx, ly], [rx, ly]]); if (ok(q)) { on = q; break; } } }
        if (!on) continue;
        // off the riser into the box's left edge: straight when the riser lies west of it, else round through the gap on its left
        for (const k0 of [0, -1, 1, -2, 2]) {
          const ty = peekPort(leftPorts, b, Math.max(b.y, Math.min(b.y + b.h, py)) + k0 * RT.lane);
          const tails = [];
          if (rx < b.x) tails.push([[rx, ty], [b.x, ty]]);
          else { const g = gapLeftOf(b.col || "B");
            for (let k = 0; k <= 12; k++) for (const sgn of k ? [-1, 1] : [1]) { const gy = ty + sgn * k * RT.lane;
              const ax = alloc(usedV, (g[0] + g[1]) / 2, Math.min(gy, ty), Math.max(gy, ty), net, 0, xx => !vClear(xx, gy, ty), g);
              if (ax != null) tails.push([[rx, gy], [ax, gy], [ax, ty], [b.x, ty]]); } }
          for (const tail of tails) {
            const pts = cleanPts([...on, ...tail]);
            if (!ok(pts)) continue;
            const cost = countCrossings(pts) * 100 + segLen(pts);
            if (cost < bestCost) { bestCost = cost; best = pts; bestPy = py; bestTy = ty; }
          }
        }
      }
      if (!best) return null;
      (rightPorts[a.id] ||= []).push(bestPy); (leftPorts[b.id] ||= []).push(bestTy);
      return { pts: best, cost: bestCost };
    };
    for (const L of Object.values(links)) {
      const net = nWire++;
      const jackYs = L.members.flatMap(m => [m.src.y + m.src.h / 2, m.dev.y + m.dev.h / 2]);
      const y0 = Math.min(...jackYs), y1 = Math.max(...jackYs);
      const ranges = [gapRightOf("A"), gapRightOf("B"), gapRightOf("C"), [westMarginX[0], westMarginX[1]]].filter(r => r[1] > r[0]);
      const rxs = [];
      for (const R of ranges) for (const want of [(R[0] + R[1]) / 2, R[0] + RT.lane, R[1] - RT.lane]) {
        const x = alloc(usedV, Math.max(R[0], Math.min(R[1], want)), y0, y1, net, 0, xx => !!segBlocked(xx, y0, xx, y1, null), R);
        if (x != null && !rxs.includes(x)) rxs.push(x);
      }
      // a trial: route the family on this riser, score it, undo it
      const trial = (rx, keep) => {
        const mark = { w: out.wires.length, h: usedH.length, v: usedV.length };
        const ports = new Map(L.members.flatMap(m => [[rightPorts, m.src.id], [leftPorts, m.dev.id]]).map(([st, id]) => [`${st === rightPorts ? "r" : "l"}${id}`, [st, id, [...(st[id] || [])]]]));
        let cost = 0, got = [];
        for (const m of L.members) {
          const r = linkPatch(m, rx, net);
          if (!r) { cost += 1e5; continue; }
          cost += r.cost;
          commit(m.c, "trunk", r.pts, { net, group: "trunk-" + L.key, trunk: L.key, rackPatch: true, rackLink: true });
          got.push(m);
        }
        if (!keep) {
          out.wires.length = mark.w; usedH.length = mark.h; usedV.length = mark.v;
          for (const [st, id, list] of ports.values()) st[id] = list;
        } else for (const m of got) done.add(m.i);
        return cost;
      };
      let bestRx = null, bestCost = Infinity;
      for (const rx of rxs) { const c = trial(rx, false); if (c < bestCost) { bestCost = c; bestRx = rx; } }
      if (bestRx == null || bestCost >= 1e5 * L.members.length) { if (opts.debug) (out.trunkSkips ||= []).push(`${L.key}: no corridor`); continue; }
      trial(bestRx, true);
    }
    /* -- rip-up and reroute (after the links, which stay put): each family in turn comes off the sheet and is tried again in every
          corridor (each column gap, the east corridor, the west margin; a few riser x's in each)
          and with its buses stacked farthest from the rooms; it keeps whichever route crosses
          the rest of the sheet at the fewest points, then the shortest. The default route is a
          candidate too, so a family never gets worse — and with the others fixed, the sheet doesn't. -- */
    const famWires = F => out.wires.filter(w => w.net === F.net);
    const ripUp = F => {
      for (let k = out.wires.length - 1; k >= 0; k--) if (out.wires[k].net === F.net) out.wires.splice(k, 1);
      for (const used of [usedH, usedV]) for (let k = used.length - 1; k >= 0; k--) if (used[k].net === F.net) used.splice(k, 1);
      for (const [st, id, y] of F.ports || []) release(st, id, y);
      F.ports = [];
      for (const m of F.members) done.delete(m.i);
    };
    const famCost = F => {
      const pts = new Set(), mine = famWires(F);
      for (const w of mine) crossPointsInto(w, F.net, pts);
      const missing = F.members.filter(m => !done.has(m.i)).length;
      return missing * 1e5 + pts.size * 100 + mine.reduce((n, w) => n + segLen(w.pts), 0) / 10;
    };
    const corridors = [gapRightOf("A"), gapRightOf("B"), gapRightOf("C"), [westMarginX[0], westMarginX[1]]].filter(r => r[1] > r[0]);
    // one pass: a second found little more (2,597 → ~2,536 crossings on 325 random jobs) for twice the time
    for (let pass = 0, moved = true; pass < 1 && moved; pass++) { moved = false;
    for (const F of famList) {
      if (!famWires(F).length) continue;               // nothing of it on the sheet: the classic passes have it
      const was = F.cfg || {};
      let best = { cfg: was, cost: famCost(F) };
      if (best.cost < 100) continue;                    // crosses nothing already
      // coarse to fine: each corridor's middle, then the best corridor's edges and the far bus stack
      trialMode = true;
      ripUp(F);
      const trial = cfg => {
        routeFam(F, { ...cfg, bound: best.cost });
        const c = F.aborted ? Infinity : famCost(F);
        if (c < best.cost - 1e-6) best = { cfg, cost: c };
        ripUp(F);
      };
      trial({ ...was, busFar: !was.busFar });
      for (const R of corridors) for (const f of [0.5, 0.15, 0.85]) trial({ range: R, want: Math.round(R[0] + (R[1] - R[0]) * f) });
      const R = best.cfg.range;
      if (R) trial({ ...best.cfg, busFar: !best.cfg.busFar });
      trialMode = false;
      routeFam(F, best.cfg);
      // the kept route must be what the trial scored; if not, the old one goes back
      if (best.cfg !== was && famCost(F) > best.cost + 1e-6) { ripUp(F); best = { cfg: was, cost: 0 }; routeFam(F, was); }
      if (opts.debug) (out.ripLog ||= []).push(`${pass} ${F.key} ${JSON.stringify(best.cfg)} → ${Math.round(famCost(F))}`);
      if (best.cfg !== was) moved = true;
    }
    }

    /* -- repair: a family left with a wire it couldn't place is usually walled off by a neighbour's
          band (in Ribbon a trunk reserves its full width — a speaker riser ending right under a TV's
          decoder leaves the video drop nowhere to land). The rip-up above only scores a family's own
          crossings, so it can't see that; here each other family is moved through the same corridor
          options and the stuck one re-routed; a move is kept only if the pair gets better (fewer
          unplaced wires first, then crossings), otherwise both go back exactly as they were. -- */
    const missingOf = F => F.members.filter(m => !done.has(m.i)).length;
    let repairBudget = opts.noRepair ? 0 : 24;   // trials per route: a wire nothing can place shouldn't cost every redraw a second
    const snapFam = F => ({ F, wires: out.wires.filter(w => w.net === F.net), h: usedH.filter(u => u.net === F.net), v: usedV.filter(u => u.net === F.net),
      ports: [...(F.ports || [])], done: F.members.filter(m => done.has(m.i)).map(m => m.i), cfg: F.cfg });
    const restoreFam = S => { ripUp(S.F); out.wires.push(...S.wires); usedH.push(...S.h); usedV.push(...S.v);
      for (const [st, id, y] of S.ports) (st[id] ||= []).push(y); S.F.ports = S.ports; for (const i of S.done) done.add(i); S.F.cfg = S.cfg; };
    for (const F of famList) {
      if (!missingOf(F) || !F.repairable) continue;   // no route was even possible (no bus lane under that row…): nothing to free
      // the families whose lanes walled it off first, then the rest while the budget lasts
      const blockers = new Set(F.blockers || []);
      const order = [...famList.filter(G => blockers.has(G.net)), ...famList.filter(G => !blockers.has(G.net))];
      for (const G of order) {
        if (G === F || !famWires(G).length || !missingOf(F) || repairBudget <= 0) continue;
        const sF = snapFam(F), sG = snapFam(G), base = famCost(F) + famCost(G);
        const opts2 = [{ ...sG.cfg, busFar: !sG.cfg?.busFar }, ...corridors.flatMap(R => [0.5, 0.15, 0.85].map(f => ({ range: R, want: Math.round(R[0] + (R[1] - R[0]) * f) })))];
        let best = null;
        trialMode = true;
        for (const cfg of opts2) {
          if (repairBudget-- <= 0) break;
          // bounded like the rip-up: G alone past the pair's best can't win; then F gets what's left
          const bar = best ? best.cost : base;
          ripUp(F); ripUp(G); routeFam(G, { ...cfg, bound: bar });
          if (!G.aborted) { const cg = famCost(G); routeFam(F, { ...(sF.cfg || {}), bound: bar - cg });
            const c = F.aborted ? Infinity : cg + famCost(F);
            if (c < bar - 1e-6) best = { cfg, cost: c }; }
        }
        trialMode = false;
        ripUp(F); ripUp(G);
        if (best) { routeFam(G, best.cfg); routeFam(F, sF.cfg || {}); out.repaired = true; if (opts.debug) (out.ripLog ||= []).push(`repair ${F.key} by moving ${G.key} ${JSON.stringify(best.cfg)}`); }
        else { restoreFam(sG); restoreFam(sF); }
      }
    }

    visConns.forEach((c, i) => { if (!done.has(i) && (rackPatchFam(c) || linkFam(c))) { routeRackToRack(c, devById[c.from], devById[c.to]); done.add(i); } });
    // the classic passes see only what the trunks left behind
    for (const plan of plans) { plan.west = plan.west.filter(o => !done.has(o.i)); plan.east = plan.east.filter(o => !done.has(o.i)); }
  }

  /* ============ pass 4a: WEST wires — ONE global river-ordered pass ============
     All top-band feeds across every device, sorted by drop-x: westmost drop
     takes the TOP corridor lane and the EASTMOST riser of its channel. For
     right-side risers over left-side drops this ordering is crossing-free
     across fan-out groups — the least-hops rule applied at corridor scale. */
  // feeds with no lane of their own wait for the harness pass (after 4b), when
  // every sibling they could ride along with has been committed
  const harnessQueue = [];
  // harness style (job setting): feeds from a source with 3+ zone runs of one
  // signal ride a shared trunk even when they could route alone — the
  // electrical-drawing look on busy sheets. A per-wire hint can opt in/out.
  const harnessStyle = opts.harness ?? !!job.job?.harnessStyle;
  const hintOf = conn => { const ov = opts.hintOverride?.[wireId(conn)]; return ov !== undefined ? (ov || null) : (conn.routeHint || null); };
  const zoneFeedCount = (plan, signal) => [...plan.west, ...plan.east].filter(x => x.c.signal === signal).length;   // room runs only, not rack patches
  const wantsBundle = (plan, o) => {
    const h = hintOf(o.c);
    if (h?.bundle === false || h?.ch || h?.land) return false;   // a pinned shape is an own run
    return h?.bundle === true || (harnessStyle && zoneFeedCount(plan, o.c.signal) >= 3);
  };
  const westNetsByDev = {};
  const allWest = plans.flatMap(plan => plan.west.map(o => ({ plan, o }))); // plan order (farthest-first within device) — measured better than global river order
  const routeWestOne = (plan, o) => {
    const d = plan.dev;
    const sx = d.x + d.w;
    const westNets = westNetsByDev[d.id] ||= [];
    {
      const { tx, landY, cardBot } = o.t;
      const land = landY ?? cardBot;                 // chip bottom or card bottom border
      if (wantsBundle(plan, o) && bundleOnto({ o, d, sx, tx, land, cls: "zone-west" }, true)) { done.add(o.i); return; }
      const zh = hintOf(o.c);
      const skip = new Set([d.id, o.t.chipId].filter(Boolean));
      // riser channel by source column: colA rises in the A|B gap beside it,
      // colB in the B|C gap, colC/right in the right corridor. (colA used to
      // fall through to the right corridor — its exit leg then crossed every
      // B and C device, so direct source→TV feeds always fell back.)
      const rr = d.col === "A" ? gapABx : d.col === "B" ? gapBCx : riserRange;
      const corTop = P.corridors.find(c => c.id === "top");
      const laneLo = land + 14;
      const laneHi = (corTop?.y ?? land) + (corTop?.h ?? 200) - 8;
      let pts = null, usedRelax = false, usedCh = null;
      // riser channels in preference order: the column/corridor channel, then the
      // gutter east of the whole top band (row-1 targets in a multi-row band are
      // reachable only via the between-rows strip entered from the band's east end).
      // If nesting starves the wire, retry with the sibling constraint relaxed —
      // a bridged sibling crossing beats unroutable geometry (last resort).
      // A "gutter" hint (guided rerouting) tries the band-end gutter first.
      const topBandRightX = Math.max(...P.zones.filter(z => z.band === "top").map(z => z.x + z.w), rackRight);
      const gutter = { ch: "gutter", r: [topBandRightX + 8, topBandRightX + 90] };
      // one channel's best route: the first few lanes (nearest the rack first) that
      // take a legal riser, and of those the one with the fewest crossings — the
      // first-fit lane alone could cross a neighbor feed TWICE (its riser, then its
      // lane) where the next lane down crossed nothing
      const tryChannel = (rrTry, relax) => {
        let got = null, gotCost = Infinity, seen = 0;
        scanLane(laneHi, -1, [laneLo, laneHi], Math.min(tx, rrTry[0]), Math.max(tx, rrTry[1]), nWire, y => {
          const riserX = alloc(usedV, rrTry[0], Math.min(y, o.portY), Math.max(y, o.portY), nWire, +1,
            x => segBlocked(x, Math.min(y, o.portY), x, Math.max(y, o.portY), skip), rrTry);
          if (riserX == null) { dbg(o, { y, fail: "riser", rrTry }); return false; }
          const cand = [[sx, o.portY], [riserX, o.portY], [riserX, y], [tx, y], [tx, land]];
          const bl = pathBlocked(cand, skip);
          if (bl) { dbg(o, { y, riserX, fail: "blocked:" + bl }); return false; }
          if (!pathRegisterable(cand, nWire)) { dbg(o, { y, riserX, fail: "registry" }); return false; }
          if (!relax) { const sib = crossesSiblings(cand, westNets); if (sib) { dbg(o, { y, riserX, fail: "sibling", sib }); return false; } }
          const c = routeCost(cand);
          if (c < gotCost) { got = cand; gotCost = c; }
          return ++seen >= 6 || c < 1;               // a crossing-free lane can't be beaten by a longer one
        });
        return got;
      };
      // the direct L: out at port height, up at the drop — for a room east of the
      // rack's right edge it is the shortest orthogonal route there is (one bend)
      const tryL = relax => {
        if (tx <= rackRight + 6) return null;
        const cand = [[sx, o.portY], [tx, o.portY], [tx, land]];
        if (pathBlocked(cand, skip) || !pathRegisterable(cand, nWire)) return null;
        if (!relax && crossesSiblings(cand, westNets)) return null;
        return cand;
      };
      const plen = c => c.slice(1).reduce((n, q, i) => n + Math.abs(q[0] - c[i][0]) + Math.abs(q[1] - c[i][1]), 0);
      const cost = c => countCrossings(c) * 100 + plen(c) / 10;   // hops dominate, then length
      for (const relax of [false, true]) {
        if (zh?.ch === "col" || zh?.ch === "gutter") {
          // a pinned channel keeps its exact behavior: that channel first, the other as fallback
          for (const { ch, r } of zh.ch === "gutter" ? [gutter, { ch: "col", r: rr }] : [{ ch: "col", r: rr }, gutter]) {
            pts = tryChannel(r, relax);
            if (pts) { usedCh = ch; break; }
          }
        } else {
          // every sensible shape, then the cheapest: the column/corridor channel,
          // the right corridor (for A/B-column sources), the direct L; the gutter
          // past the whole top band only when none of those exists (it used to be
          // the only fallback — wires ran to the sheet's east edge and doubled back)
          const opts2 = [];
          const colPts = tryChannel(rr, relax); if (colPts) opts2.push({ ch: "col", pts: colPts });
          if (rr !== riserRange) { const rp = tryChannel(riserRange, relax); if (rp) opts2.push({ ch: "col", pts: rp }); }
          const lp = tryL(relax); if (lp) opts2.push({ ch: "col", pts: lp });
          if (!opts2.length) { const gp = tryChannel(gutter.r, relax); if (gp) opts2.push({ ch: "gutter", pts: gp }); }
          if (opts2.length) { const best = opts2.reduce((a, b) => cost(b.pts) < cost(a.pts) ? b : a); pts = best.pts; usedCh = best.ch; }
        }
        if (pts) { usedRelax = relax; break; }
      }
      if ((zh?.ch && zh.ch !== usedCh) || zh?.land) out.warnings.push({ code: "hint-unroutable", msg: wireId(o.c) });
      if (zh?.bundle === true) out.warnings.push({ code: "hint-unroutable", msg: wireId(o.c) });   // asked to bundle, rode alone
      if (pts && !usedRelax) westNets.push(commit(o.c, "zone-west", pts, { group: d.id + "-west" }).net);
      else if (pts) { commit(o.c, "zone-west", pts, { group: d.id + "-west", relaxed: true }); out.warnings.push({ code: "route-relaxed", msg: wireId(o.c) }); }
      else harnessQueue.push({ o, d, sx, tx, land, cls: "zone-west" });
      done.add(o.i);
    }
  };
  for (const { plan, o } of allWest) routeWestOne(plan, o);

  /* untwist: two top-band feeds that cross each other twice are wound round
     each other — the first-routed one took the lane the other needed (the
     lowest lane, nearest the rack), so every lane left to the second crosses it
     on its riser AND its lane. Rip both up and route them in the opposite order;
     keep the result only if the pair crosses fewer wires in total and both still
     route cleanly, otherwise restore exactly what was there. */
  {
    const westEntry = new Map(allWest.map(e => [wireId(e.o.c), e]));
    const pairCross = (a, b) => { let n = 0;
      for (const s of ptsSegs(a.pts)) for (const t of ptsSegs(b.pts)) {
        if (s.vert === t.vert) continue;
        const v = s.vert ? s : t, h = s.vert ? t : s;
        if (v.x1 > Math.min(h.x1, h.x2) + 1 && v.x1 < Math.max(h.x1, h.x2) - 1 && h.y1 > Math.min(v.y1, v.y2) + 1 && h.y1 < Math.max(v.y1, v.y2) - 1) n++;
      } return n; };
    const ok = w => w.cls === "zone-west" && !w.bundleOf && westEntry.has(w.id);   // relaxed wires too: they're the usual culprits
    for (let pass = 0; pass < 2; pass++) {
      let changed = false;
      const ws = out.wires.filter(ok);
      for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
        const A = out.wires.find(w => w.id === ws[i].id), B = out.wires.find(w => w.id === ws[j].id);
        if (!A || !B || !ok(A) || !ok(B) || pairCross(A, B) < 2) continue;
        // a harness leader (harness style bundles during this pass) carries its
        // members on its net: ripping it up would drop them with it
        if (out.wires.some(w => w.bundleOf && (w.net === A.net || w.net === B.net))) continue;
        const before = countCrossings(A.pts) + countCrossings(B.pts);
        const snap = { H: usedH.slice(), V: usedV.slice(), W: out.wires.slice(), warn: out.warnings.length, hq: harnessQueue.length,
          nets: Object.fromEntries(Object.entries(westNetsByDev).map(([k, v]) => [k, v.slice()])) };
        const drop = new Set([A.net, B.net]);
        const keep = arr => { const k = arr.filter(u => !drop.has(u.net)); arr.length = 0; arr.push(...k); };
        keep(usedH); keep(usedV);
        const rest = out.wires.filter(w => !drop.has(w.net)); out.wires.length = 0; out.wires.push(...rest);
        for (const v of Object.values(westNetsByDev)) { const k = v.filter(n => !drop.has(n)); v.length = 0; v.push(...k); }
        const eA = westEntry.get(A.id), eB = westEntry.get(B.id);
        routeWestOne(eB.plan, eB.o); routeWestOne(eA.plan, eA.o);
        const A2 = out.wires.find(w => w.id === A.id), B2 = out.wires.find(w => w.id === B.id);
        const good = A2 && B2 && ok(A2) && ok(B2) && harnessQueue.length === snap.hq &&
          countCrossings(A2.pts) + countCrossings(B2.pts) < before;
        if (good) { changed = true; continue; }
        usedH.length = 0; usedH.push(...snap.H); usedV.length = 0; usedV.push(...snap.V);
        out.wires.length = 0; out.wires.push(...snap.W); out.warnings.length = snap.warn; harnessQueue.length = snap.hq;
        for (const [k, v] of Object.entries(snap.nets)) { westNetsByDev[k].length = 0; westNetsByDev[k].push(...v); }
      }
      if (!changed) break;
    }
  }

  /* ============ pass 4b: EAST wires per plan ============ */
  for (const plan of plans) {
    const d = plan.dev;
    const sx = d.x + d.w;
    const eastNets = [];
    const westNets = westNetsByDev[d.id] || [];
    // EAST (audio band / clusters): straight-east-then-turn; else stage via the
    // gutter west of the target; else escape the rack row through the BC gap.
    // Risers advance monotonically per (group × gutter) so a later sibling's
    // riser can never sit on the wrong side of an earlier one (nesting).
    const riserTrack = {};
    for (const o of plan.east) {
      const { tx, landY, cardTop, cardBot } = o.t;
      if (wantsBundle(plan, o) && bundleOnto({ o, d, sx, tx, land: landY ?? cardBot, cls: "zone-east" }, true)) { done.add(o.i); continue; }
      const zh = hintOf(o.c);
      // guided rerouting: land on the card's top or bottom edge (chips have one entry)
      const side = landY == null && (zh?.land === "top" || zh?.land === "bottom") ? zh.land : null;
      const skip = new Set([d.id, o.t.chipId].filter(Boolean));

      // the target chip is exempt (the wire lands on it) — but only the LAST leg may
      // touch it: an earlier leg at chip height would run through its body
      const tChip = o.t.chipId ? chipById[o.t.chipId] : null;
      const piercesChip = pts => tChip && pts.slice(0, -1).some((q, i) => i && (() => {
        const [x1, y1] = pts[i - 1], [x2, y2] = q;
        return Math.min(x1, x2) < tChip.x + tChip.w - 1 && Math.max(x1, x2) > tChip.x + 1 &&
               Math.min(y1, y2) < tChip.y + tChip.h - 1 && Math.max(y1, y2) > tChip.y + 1;
      })());
      const blockedHere = pts => pathBlocked(pts, skip) || (piercesChip(pts) ? "target chip" : null);
      const finishFrom = (px, py, prefix, inverted = false, relax = false) => {
        const sibNets = relax ? [] : eastNets;
        // a chip under the card has one entry, its bottom: approach from BELOW no
        // matter where the source sits (a mid-band TV's chip is often below the
        // source port — deciding by the card top sent every lane through the card)
        const above = landY != null ? false : side ? side === "top" : py < cardTop;
        const land = landY ?? (above ? cardTop : cardBot);
        const below0 = Math.max(cardBot + 14, landY != null ? landY + 10 : 0);   // first lane under the card (and its chip)
        let pts = [...prefix, [px, py], [tx, py], [tx, land]];
        if (!blockedHere(pts) && pathRegisterable(pts, nWire) && !crossesSiblings(pts, sibNets)) return pts;
        const gutter = gutterFor(tx);
        let found = null;
        const tryStaged = (landAt, rng, desired, dir) => {
          // pre-check span = the ACTUAL lane segment (riser gutter → target),
          // not the whole wire extent — anything wider false-conflicts.
          // A below-rack escape nests MIRRORED: east-most riser first, lanes
          // scanned upward (later siblings higher + wester = no crossings).
          const rk = gutter[0] + (inverted ? "i" : "n");
          const prev = riserTrack[rk];
          const rDesired = inverted
            ? Math.min(gutter[1] - 6, prev != null ? prev - 12 : gutter[1] - 6)
            : Math.max(gutter[0] + 6, prev != null ? prev + 12 : gutter[0] + 6);
          const rRange = inverted ? [gutter[0], rDesired] : [rDesired, gutter[1]];
          // (measured 2026-09-27: also scanning from the lane next to the card and
          // keeping the cheaper route helped each wire but starved later ones —
          // residence hops 5→13 — so the customary start stays)
          const runFrom = start => { let got = null, gotR = null;
          scanLane(start, inverted ? -dir : dir, rng, Math.min(gutter[0], tx), Math.max(gutter[1], tx), nWire, y => {
            const riserX = alloc(usedV, rDesired, Math.min(py, y), Math.max(py, y), nWire, inverted ? -1 : +1,
              x => segBlocked(x, Math.min(py, y), x, Math.max(py, y), skip), rRange);
            if (riserX == null) { dbg(o, { y, fail: "riser" }); return false; }
            const cand = [...prefix, [px, py], [riserX, py], [riserX, y], [tx, y], [tx, landAt]];
            const bl = blockedHere(cand);
            if (bl) { dbg(o, { y, riserX, fail: "blocked:" + bl }); return false; }
            if (!pathRegisterable(cand, nWire)) {
              if (opts.debug) {
                for (let i = 0; i < cand.length - 1; i++) {
                  const [x1, y1] = cand[i], [x2, y2] = cand[i + 1];
                  const used = y1 === y2 ? usedH : usedV;
                  const c0 = y1 === y2 ? y1 : x1, a1 = y1 === y2 ? Math.min(x1, x2) : Math.min(y1, y2), a2 = y1 === y2 ? Math.max(x1, x2) : Math.max(y1, y2);
                  const hit = used.find(u => u.net !== nWire && Math.abs(u.c - c0) < RT.clear && Math.min(u.a2, a2) - Math.max(u.a1, a1) > -2);
                  if (hit) { dbg(o, { y, riserX, fail: "registry", seg: [x1, y1, x2, y2], vs: { c: hit.c, a1: hit.a1, a2: hit.a2, net: hit.net, id: out.wires.find(w => w.net === hit.net)?.id } }); break; }
                }
              }
              return false;
            }
            const sib = crossesSiblings(cand, sibNets); if (sib) { dbg(o, { y, riserX, fail: "sibling", sib }); return false; }
            got = cand; gotR = riserX;
            return true;
          });
          return { got, gotR }; };
          const pick = runFrom(desired);
          if (pick.got) { found = pick.got; riserTrack[rk] = pick.gotR; }
          return found;
        };
        // level-with-the-band sources (bottom-anchored amps) dive below the band
        // right at the source and run the bottom strip east — the mock's pattern;
        // a target-side riser would have to cross every card between here and there
        const tryDive = (landAt, rng, desired, dir) => {
          const bandMinX = plan.eastBandMinX;
          const g1 = Math.min(bandMinX != null ? bandMinX - 10 : tx - 10, tx - 10);
          const g0 = px + 10;
          if (g1 <= g0 + 6) return null;
          // nearest target routes first (east plan is x-sorted), so risers start at
          // the band edge and advance WEST: each farther sibling dives wider and
          // deeper, its strip run passing safely under the nearer ones
          const rk = "dive" + g0;
          const prev = riserTrack[rk];
          const rDesired = Math.min(g1, prev != null ? prev - 12 : g1);
          if (rDesired < g0 + 6) return null;
          scanLane(desired, dir, rng, px, tx, nWire, y => {
            const riserX = alloc(usedV, rDesired, Math.min(py, y), Math.max(py, y), nWire, -1,
              x => segBlocked(x, Math.min(py, y), x, Math.max(py, y), skip), [g0, rDesired]);
            if (riserX == null) { dbg(o, { y, fail: "dive-riser" }); return false; }
            const cand = [...prefix, [px, py], [riserX, py], [riserX, y], [tx, y], [tx, landAt]];
            if (blockedHere(cand) || !pathRegisterable(cand, nWire)) { dbg(o, { y, riserX, fail: "dive-blocked" }); return false; }
            if (crossesSiblings(cand, sibNets)) { dbg(o, { y, riserX, fail: "dive-sibling" }); return false; }
            found = cand;
            riserTrack[rk] = riserX;
            return true;
          });
          return found;
        };
        if (above) tryStaged(land, [Math.max(20, cardTop - 320), cardTop - 14], cardTop - 26, -1);
        else {
          // both shapes, then the cheaper (fewest crossings, then shortest): the dive
          // alone used to win whenever it existed, even when it ran the wire under the
          // whole band while a riser beside the target reached it at card level
          const before = { ...riserTrack };
          const dv = tryDive(land, [below0, below0 + 326], Math.max(cardBot + 40, below0), +1);
          const dvTrack = { ...riserTrack };
          for (const k of Object.keys(riserTrack)) if (!(k in before)) delete riserTrack[k];
          Object.assign(riserTrack, before);
          found = null;
          const st = tryStaged(land, [below0, below0 + 326], Math.max(cardBot + 40, below0), +1);
          const plen = c => c.slice(1).reduce((n, q, i) => n + Math.abs(q[0] - c[i][0]) + Math.abs(q[1] - c[i][1]), 0);
          const cost = c => countCrossings(c) * 100 + plen(c) / 10;
          if (dv && (!st || cost(dv) <= cost(st))) {
            found = dv;
            for (const k of Object.keys(riserTrack)) delete riserTrack[k];
            Object.assign(riserTrack, dvTrack);
          } else found = st;
        }
        // starved strip: a plain border target may land on the OPPOSITE border
        // (feeds over the top of the band) — chips can't flip, their stub is fixed
        if (!found && landY == null)
          tryStaged(above ? cardBot : cardTop,
            above ? [cardBot + 14, cardBot + 340] : [Math.max(20, cardTop - 320), cardTop - 14],
            above ? cardBot + 40 : cardTop - 26, above ? +1 : -1);
        return found;
      };

      let why = "";
      let pts = null, usedRelax = false;
      // last-resort tier: a pinned exit port (6px foreign near-miss) may retry
      // on an adjacent port
      const basePort = o.portY;
      const [pmin, pmax] = portSpan(d);
      for (const dp of [0, -12, 12, -24, 24]) {
        const pv = basePort + dp;
        if (pv < pmin || pv > pmax) continue;
        if (dp !== 0 && (rightPorts[d.id] || []).some(u => u !== basePort && Math.abs(u - pv) < 10)) continue;
        o.portY = pv;
      for (const relax of [false, true]) {
        pts = finishFrom(sx, o.portY, [], false, relax);
        if (!pts) why += relax ? "relaxed direct/staged failed; " : "direct/staged failed; ";
        if (!pts && (segBlocked(sx + 2, o.portY, tx, o.portY, skip) || conflicts(usedH, o.portY, sx, tx, nWire))) {
          // the exit row is walled (col-C neighbor) or lane-pinned: duck through
          // the nearest vertical channel onto a highway below (preferred) or
          // above the rack, continue east from there
          // a col-C source (amp) exits its RIGHT edge — the B|C gap is WEST of
          // it, so escaping there ran the first leg back through the amp's own
          // body (skip exempts d, so nothing caught it). Amps escape east.
          const eastOfDev = d.col === "C";
          const exChan = eastOfDev ? [sx + 6, sx + 70] : gapBCx;
          for (const hyDesired of [rackBottom + 16, rackTop - 16]) {
            const dir = hyDesired > o.portY ? +1 : -1;
            const hx0 = eastOfDev ? sx : colBx;
            const hy = alloc(usedH, hyDesired, hx0, tx, nWire, dir,
              y => segBlocked(hx0, y, tx, y, skip), null);
            if (hy == null) { why += "escape hy null; "; continue; }
            // descend on the EAST side of the channel — clear of the west-group
            // stubs that hug the west risers
            const ex = alloc(usedV, eastOfDev ? exChan[0] + 2 : exChan[1] - 6, Math.min(o.portY, hy), Math.max(o.portY, hy), nWire, eastOfDev ? +1 : -1,
              x => segBlocked(x, Math.min(o.portY, hy), x, Math.max(o.portY, hy), skip), exChan);
            if (ex == null) { why += "escape ex null; "; continue; }
            pts = finishFrom(ex, hy, [[sx, o.portY], [ex, o.portY]], !relax && hy > o.portY, relax);
            if (!pts) why += `escape finish failed hy=${hy}; `;
            if (pts) break;
          }
        }
        if (pts) { usedRelax = relax; break; }
      }
      if (pts) { if (dp !== 0) (rightPorts[d.id] ||= []).push(pv); break; }
      }
      if (!pts) o.portY = basePort;
      if (zh && (zh.bundle === true || zh.ch || (zh.land && (!side || !pts || pts[pts.length - 1][1] !== (side === "top" ? cardTop : cardBot)))))
        out.warnings.push({ code: "hint-unroutable", msg: wireId(o.c) });   // the pinned shape couldn't exist; auto took over
      if (pts && !usedRelax) eastNets.push(commit(o.c, "zone-east", pts, { group: d.id + "-east" }).net);
      else if (pts) { commit(o.c, "zone-east", pts, { group: d.id + "-east", relaxed: true }); out.warnings.push({ code: "route-relaxed", msg: wireId(o.c) }); }
      else {
        // flyover of last resort: dive beside the device, ride below the whole
        // drawing, rise at the target — legal (checked) if inelegant
        const land = landY ?? cardBot;
        let fb = null;
        for (const vx of [sx + 8, sx + 20, sx + 32]) {
          for (const bigY of [P.bounds.h - 10, P.bounds.h + 30, P.bounds.h + 70]) {
            const cand = [[sx, o.portY], [vx, o.portY], [vx, bigY], [tx, bigY], [tx, land]];
            if (!pathBlocked(cand, skip) && pathRegisterable(cand, nWire)) { fb = cand; break; }
          }
          if (fb) break;
        }
        if (fb) { commit(o.c, "zone-east", fb, { group: d.id + "-east", relaxed: true }); out.warnings.push({ code: "route-relaxed", msg: wireId(o.c) + " (flyover)" }); }
        else harnessQueue.push({ o, d, sx, tx, land, cls: "zone-east", why });
      }
      done.add(o.i);
    }
    if (westNets.length > 1) out.groups.push({ dev: d.id + "-west", nets: westNets });
    if (eastNets.length > 1) out.groups.push({ dev: d.id + "-east", nets: eastNets });
  }

  /* ============ pass 4b': HARNESS — electrical-drawing bundling ============
     A feed that found no lane of its own rides an already-routed sibling (same
     source device, same signal) as ONE conductor — it takes the sibling's net,
     so the shared run is a single line the registry and hop pass treat as one —
     and breaks out as close to its own destination as the geometry allows.
     Render draws the shared trunk heavier with a ×N count. Without harness
     style only feeds that would otherwise fall back are bundled, so clean
     sheets never change; with it (or a per-wire hint) the 4a/4b passes call
     bundleOnto first and route alone only when no breakout exists. */
  for (const h of harnessQueue) {
    if (bundleOnto(h, false)) continue;
    const { o, d, sx, tx, land } = h;
    commit(o.c, h.cls + "-fallback", [[sx, o.portY], [tx, o.portY], [tx, land]], { group: d.id });
    out.warnings.push({ code: "route-fallback", msg: wireId(o.c), why: h.why });
  }

  function bundleOnto(h, proactive) {
    const { o, d, tx } = h;
    const t = o.t;
    const skip = new Set([t.chipId].filter(Boolean));
    // landings: a chip is entered from below; a card from below or above
    const lands = t.landY != null ? [{ y: t.landY, below: true }] : [{ y: t.cardBot, below: true }, { y: t.cardTop, below: false }];
    let best = null, bestCost = Infinity;
    // by choice, ride only another zone feed (a rack-to-rack patch is not a
    // trunk that reads as "to the rooms"); as a last resort, any sibling
    const leaders = out.wires.filter(w => w.from === o.c.from && w.signal === o.c.signal && !w.cls.endsWith("-fallback") && w.pts?.length > 1 &&
      (!proactive || w.cls === "zone-west" || w.cls === "zone-east"));
    for (const L of leaders) {
      for (let i = 0; i + 1 < L.pts.length; i++) {
        const [a, b] = [L.pts[i], L.pts[i + 1]];
        const picks = [];
        if (a[1] === b[1]) {
          // off a horizontal run: straight above/below the target, plus samples
          // along the run for Z-shaped breakouts
          const lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]);
          picks.push([Math.max(lo, Math.min(hi, tx)), a[1]]);
          for (let x = lo; x <= hi; x += 24) picks.push([x, a[1]]);
          picks.push([hi, a[1]]);
        } else { const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]); for (let y = lo; y < hi; y += RT.lane) picks.push([a[0], y]); picks.push([a[0], hi]); }
        for (const B of picks) for (const ln of lands) {
          // L: across at the trunk's height, then straight into the landing;
          // Z: step to a strip just outside the landing edge first, then across
          const shapes = [];
          if (ln.below ? B[1] >= ln.y + 8 : B[1] <= ln.y - 8) shapes.push([B, [tx, B[1]], [tx, ln.y]]);
          for (let k = 1; k <= 5; k++) {
            const y2 = ln.below ? ln.y + 2 + k * RT.lane : ln.y - 2 - k * RT.lane;
            shapes.push([B, [B[0], y2], [tx, y2], [tx, ln.y]]);
          }
          for (const raw of shapes) {
            const branch = raw.filter((q, k, arr) => k === 0 || q[0] !== arr[k - 1][0] || q[1] !== arr[k - 1][1]);
            if (branch.length < 2) continue;
            const len = branch.reduce((n, q, k) => k ? n + Math.abs(q[0] - branch[k - 1][0]) + Math.abs(q[1] - branch[k - 1][1]) : n, 0);
            if (len >= bestCost) continue;   // can't beat the best even with zero hops
            // the target chip is exempt only for the final landing leg — a
            // breakout dropping off a trunk above it must not pass through it
            if (pathBlocked(branch, skip) || (skip.size && pathBlocked(branch.slice(0, -1), null)) || !pathRegisterable(branch, L.net)) continue;
            const cost = countCrossings(branch) * 100 + len;   // fewest hops, then the shortest breakout
            if (cost < bestCost) { bestCost = cost; best = { L, i, B, branch }; }
          }
        }
      }
    }
    if (!best) return false;
    const { L, i, B, branch } = best;
    const trunk = [...L.pts.slice(0, i + 1), B];
    commit(o.c, h.cls, [...trunk, ...branch.slice(1)], { net: L.net, group: d.id + "-harness", bundleOf: L.bundleOf || L.id, trunkLen: trunk.length });
    out.warnings.push({ code: "route-bundled", msg: wireId(o.c), ...(proactive ? { chosen: true } : {}) });
    return true;
  }

  function tryCommit(conn, cls, cands, skip) {
    for (const pts of cands) {
      if (!pts || pts.some(p => p[0] == null || p[1] == null)) continue;
      if (!pathBlocked(pts, skip) && pathRegisterable(pts, nWire)) return commit(conn, cls, pts);
    }
    const pts = cands.find(Boolean);
    if (pts && !pts.some(p => p[0] == null || p[1] == null)) {
      out.warnings.push({ code: "route-fallback", msg: wireId(conn) });
      return commit(conn, cls + "-fallback", pts);
    }
    out.warnings.push({ code: "unrouted", msg: wireId(conn) });
    return null;
  }

  function routeRackToRack(conn, a, b) {
    const sx = a.x + a.w, skip = new Set([a.id, b.id]);
    const rackOf = t => P.racks.find(r => r.devices.some(d => d.id === t.id));
    const hov = opts.hintOverride?.[wireId(conn)];
    const rHint = hov !== undefined ? (hov || null) : (conn.routeHint || null);
    // right-edge ↔ right-edge staple (inter-rack switch trunk, or same-column wrap target)
    if (b.x <= a.x && b.x + b.w >= a.x + a.w * 0.5 && rackOf(a) !== rackOf(b)) {
      // stacked racks, aligned columns: tight staple beside the aligned devices
      const sy = portPlan[wireId(conn)] ?? takeRightPort(a, a.y + a.h / 2);
      const ty = takeRightPort(b, b.y + b.h / 2);
      // a crowded staple lane (a 30-room estate's racks: every riser beside them taken) widens before it gives up,
      // and as a last resort draws the flagged best effort — a wire must never vanish from the drawing (2026-10-03)
      let gx = null;
      for (const reach of [80, 200, 360]) {
        gx = alloc(usedV, sx + 14, Math.min(sy, ty), Math.max(sy, ty), nWire, +1,
          x => segBlocked(x, Math.min(sy, ty), x, Math.max(sy, ty), skip), [sx + 8, sx + reach]);
        if (gx != null) break;
      }
      const staple = (x, y0 = sy, y1 = ty) => [[sx, y0], [x, y0], [x, y1], [b.x + b.w, y1]];
      // no free port left on an edge (a 48-port switch's every right-edge slot): mid-height, flagged
      tryCommit(conn, "staple", [gx != null ? staple(gx) : null, staple(sx + 14, sy ?? a.y + a.h / 2, ty ?? b.y + b.h / 2)], skip);
      if (rHint?.ch) out.warnings.push({ code: "hint-unroutable", msg: wireId(conn) });   // the inter-rack trunk has one shape
      return;
    }
    const sy = portPlan[wireId(conn)] ?? takeRightPort(a, a.y + a.h / 2);
    if (b.x >= sx) {
      // rightward flow into the next column: straight, else Z in the gap, else a
      // double-jog through a free inter-row level; the entry port scans the
      // target's left edge until the whole path checks out
      const gap = b.col === "C" ? gapBCx : gapABx;
      const [tmin, tmax] = portSpan(b);
      const tyDesired = leftPlan[wireId(conn)] ?? Math.max(tmin, Math.min(tmax, sy));
      let gapR = riserRangeFor(wireId(conn), gap);
      let committed = null, sywCache = null, westTaken = false;   // west-wrap exit port: taken at most once per connection
      // in rank order if at all possible; a ranked riser with no legal x retries unranked (order never beats routable)
      for (const ranked of gapR === gap ? [false] : [true, false]) {
      if (committed) break;
      if (!ranked) gapR = gap;
      for (let k = 0; k <= Math.ceil((tmax - tmin) / RT.lane) + 1 && !committed; k++) {
        for (const sgn of k ? [1, -1] : [1]) {
          const ty = tyDesired + sgn * k * RT.lane;
          if (ty < tmin || ty > tmax || (leftPorts[b.id] || []).some(u => Math.abs(u - ty) < 10)) continue;
          const cands = [];
          if (sy === ty) cands.push([[sx, sy], [b.x, ty]]);
          const zx = gapR[0] > gapR[1] ? null : alloc(usedV, riserWant(wireId(conn), gapR), Math.min(sy, ty), Math.max(sy, ty), nWire, 0,
            x => segBlocked(x, Math.min(sy, ty), x, Math.max(sy, ty), skip), gapR);
          if (zx != null) cands.push([[sx, sy], [zx, sy], [zx, ty], [b.x, ty]]);
          // starved center: the gap's edge channels may still be free (deep B→C
          // descents to bottom-anchored amps travel the whole crowded gap)
          for (const [des, bias] of [[gapR[1] - 6, -1], [gapR[0] + 6, +1]]) {
            const ze = gapR[0] > gapR[1] ? null : alloc(usedV, Math.max(gapR[0], Math.min(gapR[1], des)), Math.min(sy, ty), Math.max(sy, ty), nWire, bias,
              x => segBlocked(x, Math.min(sy, ty), x, Math.max(sy, ty), skip), gapR);
            if (ze != null && ze !== zx) cands.push([[sx, sy], [ze, sy], [ze, ty], [b.x, ty]]);
          }
          // double-jog (col A → C, or when the single Z is starved): across a
          // free inter-row level — the nearest one first, then the next ones out
          // (the nearest can be free itself yet leave its risers no lane; a
          // walk-through job's cable box → amp had a clean level under the
          // receiver that the single nearest pick, over its top, never reached)
          const gap1 = a.col === "A" ? gapABx : gapBCx;
          const myRange = [rackTop + 26, rackBottom - 10];
          const my = alloc(usedH, sy, gapABx[0], gapBCx[1], nWire, 0,
            y => segBlocked(gapABx[0], y, gapBCx[1], y, skip), [rackTop + 26, rackBottom - 10]);
          const abx = my != null ? alloc(usedV, (gap1[0] + gap1[1]) / 2, Math.min(sy, my), Math.max(sy, my), nWire, 0,
            x => segBlocked(x, Math.min(sy, my), x, Math.max(sy, my), skip), gap1) : null;
          const bcx = my != null && gapR[0] <= gapR[1] ? alloc(usedV, gapR[1] - 6, Math.min(my, ty), Math.max(my, ty), nWire, -1,
            x => segBlocked(x, Math.min(my, ty), x, Math.max(my, ty), skip), gapR) : null;
          if (my != null && abx != null && bcx != null && Math.abs(abx - bcx) > 6)
            cands.push([[sx, sy], [abx, sy], [abx, my], [bcx, my], [bcx, ty], [b.x, ty]]);
          const base = cands.find(c => c && !pathBlocked(c, skip) && pathRegisterable(c, nWire));
          let chosen = base;
          // an A-column feed may instead wrap the WEST margin — out the left
          // edge, down the outside, in at port height. Taken only when it
          // saves ≥2 crossings over the gap descent (user redline: the AVB
          // feed collected four hops crossing the input-module feed band)
          // media sources never west-wrap — a source's feed exits RIGHT, always
          // (user redline: an ATV feed hooking out the left edge reads backwards).
          // The wrap is for infrastructure trunks (AVB switch etc.) dodging a
          // busy feed band.
          // (base may be null when the gap is starved — the wrap is then the
          // only legal route, so it no longer needs a gap route to compare to)
          if (a.col === "A" && a.type !== "source" && rHint?.ch !== "ab" && (ty < a.y - 4 || ty > a.y + a.h + 4)) {
            // the exit is a LEFT-edge port and must say so — the left-port
            // manager spaces it clear of later westward arrivals at this tile
            // (reusing the right-port y once walled off a backhaul's only door)
            const syw = sywCache ??= peekPort(leftPorts, a, ty > a.y ? a.y + 4 : a.y + a.h - 4);   // hug the far edge; arrivals keep the center lane
            const wx = alloc(usedV, westMarginX[1], Math.min(syw, ty), Math.max(syw, ty), nWire, -1,
              x => segBlocked(x, Math.min(syw, ty), x, Math.max(syw, ty), skip), westMarginX);
            const west = wx != null ? [[a.x, syw], [wx, syw], [wx, ty], [b.x, ty]] : null;
            // an explicit hint takes the wrap whenever it is legal; unhinted
            // wires still need to earn the detour (≥2 crossings saved)
            if (west && !pathBlocked(west, skip) && pathRegisterable(west, nWire) &&
                (rHint?.ch === "west" || !base || countCrossings(west) + 2 <= countCrossings(base))) {
              chosen = west;
              westTaken = true;
              (leftPorts[a.id] ||= []).push(syw);   // the winner claims its exit port
              release(rightPorts, a.id, sy);         // …and the unused right-edge booking goes back
            }
          }
          if (chosen) {
            (leftPorts[b.id] ||= []).push(ty);
            committed = commit(conn, "intra", chosen);
            if (!westTaken) riserClaim(wireId(conn), committed);
          }
          if (committed) break;
        }
      }
      }
      // judged once, on the final outcome — not per entry-port attempt
      if ((rHint?.ch === "west" && !westTaken) || rHint?.ch === "staple" || rHint?.ch === "wrap")
        out.warnings.push({ code: "hint-unroutable", msg: wireId(conn) });
      if (!committed) {
        const ty = takeLeftPort(b, sy);
        tryCommit(conn, "intra", [[[sx, sy], [(sx + b.x) / 2, sy], [(sx + b.x) / 2, ty], [b.x, ty]]], skip);
      }
    } else {
      // same column: stacked neighbors deserve a tight STAPLE — out the edge
      // facing the target, straight up/down the near gap channel, in the
      // target's right edge. The over-the-top wrap (the only template before
      // the 2026-09-20 redline) sent an adjacent feed on a lap of the whole
      // column and salted the AB gap with crossings; it stays as the fallback
      // and for leftward cross-column runs.
      const sameCol = Math.abs(b.x - a.x) < 8 && rackOf(a) === rackOf(b);
      let staple = null, sy2 = null, ty2 = null;
      if (sameCol) {
        const above = b.y < a.y;
        sy2 = peekPort(rightPorts, a, above ? a.y + 12 : a.y + a.h - 12);
        ty2 = peekPort(rightPorts, b, above ? b.y + b.h - 12 : b.y + 12);
        let gx = null;   // the tight lane first; a crowded rack (a 30-room estate) widens it before giving up (2026-10-03)
        for (const reach of [44, 120, 240]) {
          gx = alloc(usedV, sx + 14, Math.min(sy2, ty2), Math.max(sy2, ty2), nWire, +1,
            x => segBlocked(x, Math.min(sy2, ty2), x, Math.max(sy2, ty2), skip), [sx + 8, sx + reach]);
          if (gx != null && !pathBlocked([[sx, sy2], [gx, sy2], [gx, ty2], [b.x + b.w, ty2]], skip)) break;
        }
        const cand = gx != null ? [[sx, sy2], [gx, sy2], [gx, ty2], [b.x + b.w, ty2]] : null;
        if (cand && !pathBlocked(cand, skip) && pathRegisterable(cand, nWire)) staple = cand;
      }
      const ty = peekPort(leftPorts, b, sy);
      const rack = rackOf(b) || rackOf(a);
      const overY = alloc(usedH, rack.y + 26, gapABx[0], gapBCx[1], nWire, +1,
        y => segBlocked(gapABx[0], y, gapBCx[1], y, skip), [rack.y + 26, rack.y + PL.rackPadTop - 4]);
      const upX = alloc(usedV, (gapBCx[0] + gapBCx[1]) / 2, overY ?? rack.y, sy, nWire, 0,
        x => overY != null && segBlocked(x, overY, x, sy, skip), gapBCx);
      const dnX = alloc(usedV, (gapABx[0] + gapABx[1]) / 2, overY ?? rack.y, ty, nWire, 0,
        x => overY != null && segBlocked(x, overY, x, ty, skip), gapABx);
      const wrap = overY != null && upX != null && dnX != null ?
        [[sx, sy], [upX, sy], [upX, overY], [dnX, overY], [dnX, ty], [b.x, ty]] : null;
      const wrapOk = wrap && !pathBlocked(wrap, skip) && pathRegisterable(wrap, nWire) ? wrap : null;
      // staple wins ties — it is shorter and hugs the tiles; wrap only when it
      // measurably crosses less. A hint overrides the comparison (when legal).
      // The winner claims its ports (peeked above).
      let pick = staple && (!wrapOk || countCrossings(staple) <= countCrossings(wrapOk)) ? staple : wrapOk;
      if (rHint?.ch === "staple" && staple) pick = staple;
      else if (rHint?.ch === "wrap" && wrapOk) pick = wrapOk;
      else if (rHint?.ch && pick) out.warnings.push({ code: "hint-unroutable", msg: wireId(conn) });   // incl. ab/west: this class has no gap route
      if (pick === staple && staple) {
        (rightPorts[a.id] ||= []).push(sy2); (rightPorts[b.id] ||= []).push(ty2);
        release(rightPorts, a.id, sy);   // the staple exits at sy2 — the planned mid-port is free again
      }
      else if (pick) (leftPorts[b.id] ||= []).push(ty);
      // nothing legal: draw the flagged best effort (a tight staple) — a wire must never vanish from the drawing
      const yA = sy2 ?? sy ?? a.y + a.h / 2, yB = ty2 ?? b.y + b.h / 2;
      const last = !pick ? [[sx, yA], [sx + 14, yA], [sx + 14, yB], [b.x + b.w, yB]] : null;
      tryCommit(conn, pick === staple ? "staple" : "wrap", [pick, last], skip);
    }
  }

  function routeDevToChip(conn, a, chip) {
    const sx = a.x + a.w, ccy = chip.y + chip.h / 2;
    const sy = portPlan[wireId(conn)] ?? takeRightPort(a, a.y + a.h / 2);
    const skip = new Set([a.id, chip.id]);
    if (chip.x >= sx) {
      // chip to the right (ENC beside its source): straight or tiny Z into its left edge
      const mx = alloc(usedV, sx + RT.lane, Math.min(sy, ccy), Math.max(sy, ccy), nWire, 0, null, [sx + 4, chip.x - 4]);
      tryCommit(conn, "chip-feed", [
        Math.abs(sy - ccy) < 1 ? [[sx, sy], [chip.x, ccy]] : null,
        mx != null ? [[sx, sy], [mx, sy], [mx, ccy], [chip.x, ccy]] : null,
      ], skip);
    } else {
      // chip west or below: exit right, ride a gap channel, approach the chip top
      const cx = chip.x + chip.w / 2;
      const gx = alloc(usedV, (gapBCx[0] + gapBCx[1]) / 2, 0, 1, nWire, 0, null, gapBCx);
      const belowChip = chip.x + chip.w > a.x;   // tucked under a device, not west of the column
      if (belowChip) {
        // tucked-below chip (e.g. DEC feeding the amp it sits under)
        const laneY = alloc(usedH, chip.y + chip.h / 2, Math.min(gx ?? sx, chip.x), sx + 20, nWire, 0,
          y => segBlocked(Math.min(gx ?? sx, chip.x), y, sx, y, skip), null);
        const gx2 = gx != null && laneY != null ? alloc(usedV, gx, Math.min(sy, laneY), Math.max(sy, laneY), nWire, 0,
          x => segBlocked(x, Math.min(sy, laneY), x, Math.max(sy, laneY), skip), gapBCx) : null;
        tryCommit(conn, "chip-feed", [
          gx2 != null && laneY != null ? [[sx, sy], [gx2, sy], [gx2, laneY], [chip.x, laneY]] : null,
        ], skip);
      } else {
        // chip west (DEC left of a col-B device): over an inter-row gap, drop to
        // chip top — lane and gap channel validated jointly per candidate; a
        // pinned exit port may retry on an adjacent one
        let pts = null;
        const [smin, smax] = portSpan(a);
        for (const dsy of [0, -12, 12, -24, 24]) {
          const syv = sy + dsy;
          if (syv < smin || syv > smax) continue;
          if (dsy !== 0 && (rightPorts[a.id] || []).some(u => u !== sy && Math.abs(u - syv) < 10)) continue;
          // badge exemption: the chip accepts its feed on top OR bottom edge —
          // whichever inter-row strip has a free lane
          scanLane(chip.y - 14, 0, [Math.min(a.y, chip.y - 40), chip.y + chip.h + 60], cx, gapBCx[1], nWire, y => {
            if (y >= chip.y - 3 && y <= chip.y + chip.h + 3) return false; // never through the chip band
            const landAt = y < chip.y ? chip.y : chip.y + chip.h;
            const gx2 = alloc(usedV, gapBCx[1] - 6, Math.min(syv, y), Math.max(syv, y), nWire, -1,
              x => segBlocked(x, Math.min(syv, y), x, Math.max(syv, y), skip), gapBCx);
            if (gx2 == null) return false;
            const cand = [[sx, syv], [gx2, syv], [gx2, y], [cx, y], [cx, landAt]];
            if (pathBlocked(cand, skip) || !pathRegisterable(cand, nWire)) return false;
            pts = cand;
            return true;
          });
          if (!pts && chip.y > a.y - 100) {
            // wrap over the column top and drop straight onto the chip
            const rack2 = P.racks.find(rk => rk.devices.some(dd => dd.id === a.id)) || P.racks[0];
            const overY = alloc(usedH, rack2.y + 26, cx, gapBCx[1], nWire, +1,
              y => segBlocked(cx, y, gapBCx[1], y, skip), [rack2.y + 26, rack2.y + PL.rackPadTop - 4]);
            const gx3 = overY != null ? alloc(usedV, gapBCx[1] - 6, Math.min(syv, overY), Math.max(syv, overY), nWire, -1,
              x => segBlocked(x, Math.min(syv, overY), x, Math.max(syv, overY), skip), gapBCx) : null;
            if (overY != null && gx3 != null) {
              const cand = [[sx, syv], [gx3, syv], [gx3, overY], [cx, overY], [cx, chip.y]];
              if (!pathBlocked(cand, skip) && pathRegisterable(cand, nWire)) pts = cand;
            }
          }
          if (pts) { if (dsy !== 0) (rightPorts[a.id] ||= []).push(syv); break; }
        }
        tryCommit(conn, "chip-feed", [pts], skip);
      }
    }
  }

  function routeChipToDev(conn, chip, b) {
    // chip badge output exits toward the device it feeds (badge exemption). A chip with two
    // outputs (an AVDM encoder: video to the switch, audio to the Savant input module) has two
    // jacks: video leaves the top half of its edge, audio the bottom half
    const outs = visConns.filter(c => c.from === chip.id);
    const ccy = chip.y + chip.h / 2 + (outs.length > 1 ? (conn.signal === "video" ? -chip.h / 4 : chip.h / 4) : 0), skip = new Set([chip.id, b.id]);
    const chipR = chip.x + chip.w;
    // landing heights on the target's left edge: the planned one first, then the other free ones
    // nearest it — a single height walled off by a neighbouring staple used to mean a fallback
    const ty0 = takeLeftPort(b, leftPlan[wireId(conn)] ?? ccy);
    const [tmin, tmax] = portSpan(b), tys = [ty0];
    for (let yy = tmin; yy <= tmax; yy += RT.lane)
      if (Math.abs(yy - ty0) >= 10 && !(leftPorts[b.id] || []).some(u => Math.abs(u - yy) < 10)) tys.push(yy);
    tys.splice(1, tys.length, ...tys.slice(1).sort((m, n) => Math.abs(m - ty0) - Math.abs(n - ty0)).slice(0, 6));
    const cands = [];
    for (const ty of tys) {
    // a chip's second (audio) output drops right beside the chip, inside its video wire's turn
    if (outs.length > 1 && conn.signal !== "video" && chipR <= b.x) {
      // several such drops into one box nest: the lowest chip hugs the chips, the highest
      // takes the outermost lane — so no drop cuts across a lower chip's exit
      const sibs = visConns.filter(c => c.to === b.id && c.signal === conn.signal && chipById[c.from] && visConns.filter(k => k.from === c.from).length > 1)
        .map(c => chipById[c.from]).sort((p, q) => q.y - p.y);
      const rank = Math.max(0, sibs.findIndex(k => k.id === chip.id));
      const hx = alloc(usedV, chipR + 6 + rank * RT.lane, Math.min(ccy, ty), Math.max(ccy, ty), nWire, +1,
        x => segBlocked(x, Math.min(ccy, ty), x, Math.max(ccy, ty), skip), [chipR + 4, b.x - 4]);
      if (hx != null) cands.push([[chipR, ccy], [hx, ccy], [hx, ty], [b.x, ty]]);
    }
    if (chipR <= b.x) {
      if (Math.abs(ty - ccy) < 1) cands.push([[chipR, ccy], [b.x, ty]]);
      if (b.x - chipR >= 10) {
        const rr = riserRangeFor(wireId(conn), [chipR + 4, b.x - 4]);
        const mx = rr[0] > rr[1] ? null : alloc(usedV, riserWant(wireId(conn), rr), Math.min(ccy, ty), Math.max(ccy, ty), nWire, 0,
          x => segBlocked(x, Math.min(ccy, ty), x, Math.max(ccy, ty), skip), rr);
        if (mx != null) cands.push([[chipR, ccy], [mx, ccy], [mx, ty], [b.x, ty]]);
      }
      // tight squeeze (chip parked right beside the hub): exit the chip's LEFT
      // edge and ride the AB gap to the input row
      const wx = alloc(usedV, Math.min(gapABx[1], chip.x - 10), Math.min(ccy, ty), Math.max(ccy, ty), nWire, -1,
        x => segBlocked(x, Math.min(ccy, ty), x, Math.max(ccy, ty), skip), [gapABx[0], Math.min(gapABx[1], chip.x - 4)]);
      if (wx != null) cands.push([[chip.x, ccy], [wx, ccy], [wx, ty], [b.x, ty]]);
    } else {
      // chip below/right of its device: rise into the left edge via the west gap
      const gap = b.col === "C" ? gapBCx : gapABx;
      const wx = alloc(usedV, gap[1] - 6, Math.min(ccy, ty), Math.max(ccy, ty), nWire, -1,
        x => segBlocked(x, Math.min(ccy, ty), x, Math.max(ccy, ty), skip), gap);
      if (wx != null) cands.push([[chip.x, ccy], [wx, ccy], [wx, ty], [b.x, ty]]);
    }
    // order never beats routable: the unranked riser is the last resort before a fallback
    if (riserPlan[wireId(conn)] && chipR <= b.x && b.x - chipR >= 10) {
      const mx = alloc(usedV, (chipR + b.x) / 2, Math.min(ccy, ty), Math.max(ccy, ty), nWire, 0,
        x => segBlocked(x, Math.min(ccy, ty), x, Math.max(ccy, ty), skip), [chipR + 4, b.x - 4]);
      if (mx != null) cands.push([[chipR, ccy], [mx, ccy], [mx, ty], [b.x, ty]]);
    }
    }
    const won = tryCommit(conn, "chip-out", cands, skip);
    // the winner may land at another height: that one is booked, the planned one goes back
    const ly = won && !/fallback/.test(won.cls) ? won.pts.at(-1)[1] : ty0;
    if (ly !== ty0) { release(leftPorts, b.id, ty0); (leftPorts[b.id] ||= []).push(ly); }
    riserClaim(wireId(conn), won);
  }

  function routeReturn(conn, b, origin = conn.from) {
    // audio return: starts at the border aligned with the display (or the local
    // encoder's puck for network backhauls), wraps to the target's LEFT edge —
    // least-hops around the corridor bundles
    const ls = localSlotOf(origin);
    const { pz, cx } = ls ? { pz: ls.pz, cx: ls.cx } : slotOf(origin);
    const compChip = ls ? null : (sol.companions || []).find(c => c.serves === origin);
    const chipHalf = compChip ? (chipById[compChip.id]?.w ?? 0) / 2 + 8 : 0;
    const ownChip = origin !== conn.from ? chipById[conn.from] : null;   // a chip under the TV sending to the rack
    const sx0 = ownChip ? ownChip.x + ownChip.w / 2 + 14 : ls ? cx : (feedsToEp[origin] ? cx + Math.max(RT.lane, chipHalf) : cx);
    const skip = new Set([pz.id, b.id, ...(ownChip ? [ownChip.id] : [])]);
    const corTop = P.corridors.find(c => c.id === "top");
    // hug the strip just under the source card, above the corridor's feed lanes
    // — the return crosses only the drops it can't avoid (least-hops)
    const laneLo = ownChip ? ownChip.y + ownChip.h + 8 : pz.y + pz.h + 14;
    // range reaches below the rack too — a return from a far cluster may have to
    // travel under everything to reach the AB gap
    const laneHi = Math.max(corTop ? corTop.y + corTop.h - 6 : pz.y + pz.h + 220, rackBottom + 320);
    // entry port: PEEKED, not claimed — if the middle port's row is walled off,
    // the search retries the target's other free left ports; only the port the
    // winning route actually lands on is claimed (a claimed-but-dead port once
    // made returns vanish with no geometry at all)
    const [tmin, tmax] = portSpan(b), tmid = b.y + b.h / 2;
    const portCands = [peekPort(leftPorts, b, tmid)];
    for (let yy = tmin; yy <= tmax; yy += RT.lane)
      if (!portCands.includes(yy) && !(leftPorts[b.id] || []).some(u => Math.abs(u - yy) < 10)) portCands.push(yy);
    portCands.splice(1, portCands.length, ...portCands.slice(1).sort((m, n) => Math.abs(m - tmid) - Math.abs(n - tmid)));
    let ty = portCands[0];
    // gather every valid (lane, channel) candidate and take the one that costs
    // the fewest hops — returns route last, so the corridor is fully known
    let best = null, bestCost = Infinity, seen = 0, firstTry = null;
    const rdbg = info => { if (opts.debug) { const k = wireId(conn); ((out.debug ||= {})[k] ||= []).length < 400 && out.debug[k].push(info); } };
    // the target is exempt from segBlocked so the final approach may land on its
    // edge — but that exemption must not let EARLIER segments pierce its body
    // (seen live: a lane at card height crossed the module, wrapped the west
    // margin, and re-entered from the left)
    const hitsTarget = cand => {
      for (let i = 1; i < cand.length - 1; i++) {
        const [x1, y1] = cand[i - 1], [x2, y2] = cand[i];
        if (Math.min(x1, x2) < b.x + b.w && Math.max(x1, x2) > b.x &&
            Math.min(y1, y2) < b.y + b.h && Math.max(y1, y2) > b.y) return true;
      }
      return false;
    };
    // a stacked card directly below can wall off the straight descent — jog
    // through the row strip into the cluster gutter beside the card, then drop
    const buildCands = (y, wx) => {
      const cb = ownChip ? ownChip.y + ownChip.h : pz.y + pz.h;   // a chip's wire leaves the chip's bottom
      const list = [[[sx0, cb], [sx0, y], [wx, y], [wx, ty], [b.x, ty]]];
      if (y > cb + 60) {
        // the descent beside the card is a channel like any other — allocate it
        // (cluster gutters carry inbound risers; a fixed offset would collide)
        for (const [g0, g1, bias] of [[pz.x - 70, pz.x - 10, -1], [pz.x + pz.w + 10, pz.x + pz.w + 70, +1]]) {
          const gx = alloc(usedV, bias < 0 ? g1 : g0, cb + 16, y, nWire, bias,
            x => segBlocked(x, cb + 16, x, y, skip), [g0, g1]);
          if (gx != null) for (const midY of [cb + 16, cb + 30, cb + 44])
            list.push([[sx0, cb], [sx0, midY], [gx, midY], [gx, y], [wx, y], [wx, ty], [b.x, ty]]);
        }
      }
      return list;
    };
    const scan = (band, rangesArr, budget, tag) => {
      let n = 0;
      scanLane(band[0], +1, band, gapABx[0], sx0, nWire, y => {
        // a return leaves its card's BOTTOM — a lane above that would climb back
        // through the card (a mid-band TV sits beside the rack, so a hint band
        // between two rack devices can be higher than the card's bottom)
        if (y < laneLo) { rdbg({ [tag]: y, fail: "above-source-card" }); return false; }
        for (const range of rangesArr) {
          const isGap = range === gapABx || range === gapBCx;
          const wx = alloc(usedV, isGap ? (range[0] + range[1]) / 2 : range[1],
            Math.min(y, ty), Math.max(y, ty), nWire, isGap ? 0 : -1,
            x => segBlocked(x, Math.min(y, ty), x, Math.max(y, ty), skip), range);
          if (wx == null) { rdbg({ [tag]: y, r: range === gapABx ? "ab" : "west", fail: "alloc" }); continue; }
          const list = buildCands(y, wx);
          // remember the first geometrically sane attempt (doesn't pierce the
          // target) as the best-effort fallback, with the port it lands on
          if (!firstTry) { const c0 = list.find(c => !hitsTarget(c)); if (c0) firstTry = { pts: c0, ty }; }
          const cand = list.find(c => !hitsTarget(c) && !pathBlocked(c, skip) && pathRegisterable(c, nWire));
          if (!cand) {
            rdbg({ [tag]: y, wx, r: range === gapABx ? "ab" : "west",
              fail: list.map(c => hitsTarget(c) ? "pierce" : (pathBlocked(c, skip) || "registry")).join("|") });
            continue;
          }
          // hops dominate; congestion breaks ties toward emptier corridors
          const cost = countCrossings(cand) * 100 + pathCongestion(cand);
          if (cost < bestCost) { best = cand; bestCost = cost; }
          n++;
        }
        return n >= budget;
      });
    };
    // guided rerouting: a hint pins the channel range and/or the lane band
    // (between two named rack devices). Hints are advisory — if the pinned
    // route can't exist, warn honestly and fall back to the free search.
    const ov = opts.hintOverride?.[wireId(conn)];
    const hint = ov !== undefined ? (ov || null) : (conn.routeHint || null);
    let hintBand = null, hintBad = false;
    if (hint?.between) {
      const d1 = rackDevById[hint.between[0]], d2 = rackDevById[hint.between[1]];
      if (d1 && d2) {
        const gTop = Math.min(d1.y + d1.h, d2.y + d2.h) + 4, gBot = Math.max(d1.y, d2.y) - 4;
        if (gBot - gTop >= 8) hintBand = [gTop, gBot]; else hintBad = true;
      } else hintBad = true;
    }
    // "staple"/"wrap" belong to rack-to-rack runs; a return can't honor them
    if (hint && hint.ch && hint.ch !== "ab" && hint.ch !== "west") hintBad = true;
    const hintRanges = hint?.ch === "west" ? [westMarginX] : hint?.ch === "ab" ? [gapABx] : [gapABx, westMarginX];
    const reset = () => { best = null; bestCost = Infinity; seen = 0; };
    // the hint gets every entry port before the free search takes over
    if (hint && !hintBad) {
      for (const p of portCands) {
        ty = p; reset();
        if (hintBand) scan(hintBand, hintRanges, 30, "y");
        else {
          scan([laneLo, laneHi], hintRanges, 30, "y");
          // (never a lane above the source card's own bottom: a mid-band TV can sit lower than the rack)
          if (!best) scan([Math.max(rackBottom + 24, laneLo), Math.max(rackBottom, laneLo) + 560], hintRanges, 12, "band2");
        }
        if (best) break;
      }
    }
    if (hint && !best) out.warnings.push({ code: "hint-unroutable", msg: wireId(conn) });
    if (!best) {
      for (const p of portCands) {
        ty = p; reset();
        // a column-C target (e.g. a Hyperion) is reached through the B/C gap first
        const ranges = b.col === "C" ? [gapBCx, gapABx, westMarginX] : [gapABx, westMarginX];
        scan([laneLo, laneHi], ranges, 30, "y");
        // tall racks put the only clear crossing BELOW everything — the near-card
        // scan can exhaust its sample budget before ever reaching it; the first
        // 340px below the rack belong to the amp dive strips, duck BENEATH them
        if (!best) scan([Math.max(rackBottom + 24, laneLo), Math.max(rackBottom, laneLo) + 560], ranges, 12, "band2");
        if (best) break;
      }
    }
    // every other class draws a flagged best-effort path when the corridor is
    // full; a return used to VANISH instead — the connection disappeared from
    // the schematic. Draw the first sane attempt and let the fallback warning say so.
    if (best) (leftPorts[b.id] ||= []).push(ty);
    else if (firstTry) (leftPorts[b.id] ||= []).push(firstTry.ty);
    tryCommit(conn, "return", [best, !best && firstTry ? firstTry.pts : null], skip);
  }

  /* ============ pass 4c: audio returns — last, so they can dodge everything ============ */
  visConns.forEach((conn, i) => {
    if (done.has(i)) return;
    const toDev = devById[conn.to];
    if ((ix.endpointsById[conn.from] || s.locals[conn.from]) && toDev) { routeReturn(conn, toDev); done.add(i); return; }
    const zc = s.companions[conn.from];
    if (zc && toDev && ix.endpointsById[zc.serves]) { routeReturn(conn, toDev, zc.serves); done.add(i); return; }
    out.warnings.push({ code: "unrouted", msg: `no route class for ${wireId(conn)}` });
  });

  /* ============ pass 4d: untwist by lane swap ============
     Two feeds that cross each other twice are wound round each other: each has
     a riser, a lane, a drop, and the one routed first took the lane the other
     needed. Swapping the two LANE heights (risers and drops stay put) unwinds
     them. Kept only when both new paths are legal (no body, no lane overlap)
     and the pair crosses fewer wires in total; otherwise nothing changes. */
  {
    const FEEDS = new Set(["zone-west", "zone-east", "return"]);
    const segs2 = pts => ptsSegs(pts);
    const pairCross = (a, b) => { let n = 0;
      for (const s of segs2(a)) for (const t of segs2(b)) {
        if (s.vert === t.vert) continue;
        const v = s.vert ? s : t, h = s.vert ? t : s;
        if (v.x1 > Math.min(h.x1, h.x2) + 1 && v.x1 < Math.max(h.x1, h.x2) - 1 && h.y1 > Math.min(v.y1, v.y2) + 1 && h.y1 < Math.max(v.y1, v.y2) - 1) n++;
      } return n; };
    // the lane: the longest horizontal run strictly inside the path
    const laneOf = pts => { let bi = -1, bl = 0;
      for (let i = 1; i + 2 < pts.length; i++) if (pts[i][1] === pts[i + 1][1]) { const l = Math.abs(pts[i + 1][0] - pts[i][0]); if (l > bl) { bl = l; bi = i; } }
      return bi; };
    const withLane = (pts, i, y) => pts.map((q, k) => k === i || k === i + 1 ? [q[0], y] : [q[0], q[1]]);
    // a moved lane must not flip the legs beside it (that would draw a spike)
    const sane = (old, nu, i) =>
      Math.sign(nu[i][1] - nu[i - 1][1]) === Math.sign(old[i][1] - old[i - 1][1]) && Math.sign(nu[i + 2][1] - nu[i + 1][1]) === Math.sign(old[i + 2][1] - old[i + 1][1]);
    const unreg = net => { for (const arr of [usedH, usedV]) { const k = arr.filter(u => u.net !== net); arr.length = 0; arr.push(...k); } };
    const skipOf = w => new Set([w.from, w.to, s.companions[w.to]?.id].filter(Boolean));
    // a fan-out's wires never cross each other (out.groups: the non-relaxed siblings per device side)
    const sibHit = w => {
      const grp = out.groups.find(g => g.nets.includes(w.net));
      if (!grp) return false;
      return out.wires.some(o => o !== w && grp.nets.includes(o.net) && pairCross(w.pts, o.pts) > 0);
    };
    // a harness leader shares its net with its members, whose trunks copy its
    // riser and lane: a move carries them along — the shared prefix takes the
    // leader's new points and the breakout slides with the run it leaves from.
    // (Moving the leader alone stranded them on lanes the registry, keyed by
    // net, no longer held, and the swapped partner landed on top of them.)
    const membersOf = w => out.wires.filter(m => m.bundleOf && m.net === w.net);
    const carry = (oldL, newL, m) => {
      let k = 0;
      while (k < m.pts.length && k < oldL.length && m.pts[k][0] === oldL[k][0] && m.pts[k][1] === oldL[k][1]) k++;
      if (!k) return null;
      const q = m.pts.map((p, i) => i < k ? [newL[i][0], newL[i][1]] : [p[0], p[1]]);
      if (k < m.pts.length && k < oldL.length) {
        const [a, b] = [oldL[k - 1], oldL[k]], ax = a[1] === b[1] ? 1 : 0;   // the run's fixed coordinate
        for (let j = k; j < m.pts.length && m.pts[j][ax] === a[ax]; j++) q[j][ax] = newL[k - 1][ax];
      }
      // still orthogonal, and every leg runs the way it did (no spikes, no flips)
      for (let i = 1; i < q.length; i++) {
        if (q[i][0] !== q[i - 1][0] && q[i][1] !== q[i - 1][1]) return null;
        for (const c of [0, 1]) if (Math.sign(q[i][c] - q[i - 1][c]) !== Math.sign(m.pts[i][c] - m.pts[i - 1][c])) return null;
      }
      return q;
    };
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      const ws = out.wires.filter(w => FEEDS.has(w.cls) && !w.bundleOf);
      for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
        const A = ws[i], B = ws[j];
        if (pairCross(A.pts, B.pts) < 1) continue;   // any crossing pair: a swap can remove single crossings too
        // candidate moves: swap the lane heights, swap the riser columns (the first
        // vertical after the port stub — stacked sibling ports whose risers are in
        // the wrong order cross each other's stubs), or both; the move that cuts
        // the most crossings wins
        const before = countCrossings(A.pts) + countCrossings(B.pts);
        const oldA = A.pts, oldB = B.pts;
        const moves = [];
        const ia = laneOf(A.pts), ib = laneOf(B.pts);
        const lane = (pa, pb) => { if (ia < 0 || ib < 0 || pa[ia][1] === pb[ib][1]) return null;
          const nA = withLane(pa, ia, pb[ib][1]), nB = withLane(pb, ib, pa[ia][1]);
          return sane(pa, nA, ia) && sane(pb, nB, ib) ? [nA, nB] : null; };
        const riserOk = p => p.length >= 4 && p[0][1] === p[1][1] && p[1][0] === p[2][0] && p[1][0] > p[0][0];
        const riser = (pa, pb) => { if (!riserOk(pa) || !riserOk(pb) || pa[1][0] === pb[1][0]) return null;
          const xa = pa[1][0], xb = pb[1][0];
          const nA = pa.map((q, k) => k === 1 || k === 2 ? [xb, q[1]] : [q[0], q[1]]), nB = pb.map((q, k) => k === 1 || k === 2 ? [xa, q[1]] : [q[0], q[1]]);
          // the stub still runs right, and the lane still leaves the riser the same way
          const dirOk = (o, n) => n[1][0] > n[0][0] && Math.sign(n[3][0] - n[2][0]) === Math.sign(o[3][0] - o[2][0]) && n[3][0] !== n[2][0];
          return dirOk(pa, nA) && dirOk(pb, nB) ? [nA, nB] : null; };
        const l = lane(oldA, oldB); if (l) moves.push(l);
        const r = riser(oldA, oldB); if (r) moves.push(r);
        if (l && r) { const both = lane(r[0], r[1]); if (both) moves.push(both); }
        if (!moves.length) continue;
        const mA = membersOf(A), mB = membersOf(B);
        const unit = [A, ...mA, B, ...mB], old = unit.map(w => w.pts);
        const before2 = before + [...mA, ...mB].reduce((n, m) => n + countCrossings(m.pts), 0);
        unreg(A.net); unreg(B.net);
        let best = null, bestN = before2;
        for (const [nA, nB] of moves) {
          const next = [nA, ...mA.map(m => carry(oldA, nA, m)), nB, ...mB.map(m => carry(oldB, nB, m))];
          if (next.some(p => !p) || unit.some((w, k) => pathBlocked(next[k], skipOf(w)))) continue;
          // A's bundle against the registry, then B's against the registry plus A's
          const nA2 = next.slice(0, 1 + mA.length), nB2 = next.slice(1 + mA.length);
          let good = nA2.every(p => pathRegisterable(p, A.net));
          if (good) { for (const p of nA2) registerPath(p, A.net); good = nB2.every(p => pathRegisterable(p, B.net)); unreg(A.net); }
          if (!good) continue;
          unit.forEach((w, k) => { w.pts = next[k]; });
          const n = next.reduce((t, p) => t + countCrossings(p), 0);
          const sibOk = !sibHit(A) && !sibHit(B);     // sibling nesting stays inviolable
          unit.forEach((w, k) => { w.pts = old[k]; });
          if (sibOk && n < bestN) { bestN = n; best = next; }
        }
        if (best) { unit.forEach((w, k) => { w.pts = best[k]; registerPath(best[k], w.net); }); changed = true; continue; }
        unit.forEach((w, k) => registerPath(old[k], w.net));
      }
      if (!changed) break;
    }
  }

  /* ============ pass 5: crossings → hops ============ */
  computeHops(out);
  if (opts.debug) out.channels = { h: usedH, v: usedV };  // registered segments, for the congestion overlay
  return out;
}

function computeHops(out) {
  // collect segments
  const segs = [];
  out.wires.forEach(w => w.pts.forEach((p, i) => {
    if (i === 0) return;
    const [x1, y1] = w.pts[i - 1], [x2, y2] = p;
    segs.push({ w, si: i - 1, x1, y1, x2, y2, vert: x1 === x2 });
  }));
  const crossings = [];
  for (const a of segs) for (const b of segs) {
    if (a.w.net >= b.w.net || a.vert === b.vert) continue;
    const v = a.vert ? a : b, h = a.vert ? b : a;
    const hx1 = Math.min(h.x1, h.x2), hx2 = Math.max(h.x1, h.x2);
    const vy1 = Math.min(v.y1, v.y2), vy2 = Math.max(v.y1, v.y2);
    if (v.x1 > hx1 + 1 && v.x1 < hx2 - 1 && h.y1 > vy1 + 1 && h.y1 < vy2 - 1)
      crossings.push({ v, h, x: v.x1, y: h.y1 });
  }
  // ownership: a segment crossing an adjacent same-signal bundle bridges it
  // wide; otherwise the vertical hops (matches the mocks)
  const byV = new Map(), byH = new Map();
  for (const c of crossings) {
    (byV.get(c.v) ?? byV.set(c.v, []).get(c.v)).push(c);
    (byH.get(c.h) ?? byH.set(c.h, []).get(c.h)).push(c);
  }
  const clusterKeyed = (list, coord) => {
    const sorted = [...list].sort((a, b) => a[coord] - b[coord]);
    const groups = [];
    for (const c of sorted) {
      const g = groups[groups.length - 1];
      if (g && c[coord] - g[g.length - 1][coord] <= RT.hopMerge && c === c) g.push(c); else groups.push([c]);
    }
    return groups;
  };
  const assigned = new Set();
  // a wire crossing a bundle (≥2 clustered same-signal wires) bridges the whole
  // bundle with ONE arc — the drafting convention Ryan wants (2026-09-27: tried
  // one small bump per wire; he preferred the single big arc)
  for (const [h, list] of byH) {
    for (const g of clusterKeyed(list, "x")) {
      if (g.length >= 2 && g.every(c => c.v.w.signal === g[0].v.w.signal)) {
        h.w.hops.push({ si: h.si, x: (g[0].x + g[g.length - 1].x) / 2, y: g[0].y, w: g[g.length - 1].x - g[0].x + 2 * RT.hopR, orient: "h" });
        g.forEach(c => assigned.add(c));
      }
    }
  }
  for (const [v, list] of byV) {
    for (const g of clusterKeyed(list, "y")) {
      const rest = g.filter(c => !assigned.has(c));
      if (!rest.length) continue;
      if (rest.length >= 2 && rest.every(c => c.h.w.signal === rest[0].h.w.signal)) {
        v.w.hops.push({ si: v.si, x: rest[0].x, y: (rest[0].y + rest[rest.length - 1].y) / 2, w: rest[rest.length - 1].y - rest[0].y + 2 * RT.hopR, orient: "v" });
      } else {
        rest.forEach(c => v.w.hops.push({ si: v.si, x: c.x, y: c.y, w: 2 * RT.hopR, orient: "v" }));
      }
      rest.forEach(c => assigned.add(c));
    }
  }
  // normalize per segment: arcs that overlap merge into one wider bridge
  // (separate 12px arcs 9px apart drew the path backwards), and every arc is
  // clamped to its own segment (a 24px bridge on a 20px stub poked into a card)
  for (const w of out.wires) {
    if (!w.hops?.length) continue;
    const bySi = {};
    for (const h of w.hops) (bySi[h.si] ||= []).push(h);
    const merged = [];
    for (const [si, hs] of Object.entries(bySi)) {
      const [a, b] = [w.pts[+si], w.pts[+si + 1]];
      const vert = a[0] === b[0];
      const lo = Math.min(vert ? a[1] : a[0], vert ? b[1] : b[0]), hi = Math.max(vert ? a[1] : a[0], vert ? b[1] : b[0]);
      const ivs = hs.map(h => { const c = vert ? h.y : h.x; return { s: c - h.w / 2, e: c + h.w / 2, orient: h.orient }; }).sort((m, n) => m.s - n.s);
      const runs = [];
      for (const iv of ivs) { const last = runs[runs.length - 1]; if (last && iv.s <= last.e) last.e = Math.max(last.e, iv.e); else runs.push({ ...iv }); }
      for (const r of runs) {
        const s0 = Math.max(lo, r.s), e0 = Math.min(hi, r.e);
        if (e0 - s0 < 4) continue;
        const c = (s0 + e0) / 2;
        merged.push({ si: +si, x: vert ? a[0] : c, y: vert ? c : a[1], w: e0 - s0, orient: r.orient });
      }
    }
    w.hops = merged;
  }
  out.crossings = crossings.length;
}

/* ---------- render ----------
   The finished SVG sheet: placement + routed wires drawn in the approved
   mock-sheet.svg language (grid frame, dashed cards, icon glyphs, chips,
   colored runs with hop arcs, dynamic legend, vertical Synergy title block).
   Pure string builder — no DOM. */

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// SVG path for a routed wire with hop arcs spliced in:
// vertical hops bulge RIGHT (sweep 1 downward, 0 upward);
// horizontal hops bulge UP (sweep 0 right→left, 1 left→right)
/* ---------- guided rerouting: legal alternates for one wire ----------
   Re-runs the router with forced hints and returns the distinct successful
   paths. Hints are topological (channel choice / between two rack devices),
   so a chosen hint survives re-layout, re-import, and router upgrades. */
export function routeAlternates(job, ix, placed, opts, wid) {
  const [from, to] = String(wid).split("→");
  const devs = placed.racks.flatMap(r => r.devices);
  const toDev = devs.find(d => d.id === to);
  const fromDev = devs.find(d => d.id === from);
  const menu = [{ label: "Auto", hint: null }];
  if (!toDev) {
    // zone feeds: the vocabulary is the riser channel (west feeds), the card
    // edge they land on (east feeds), and whether they ride a harness
    if (!fromDev) return [];
    const base = route(job, ix, placed, { ...opts, hintOverride: { [wid]: false } });
    const w = base.wires.find(x => x.id === wid);
    if (!w) return [];
    const cls = w.cls.replace(/-fallback$/, "");
    if (!/^zone-(west|east)$/.test(cls)) return [];
    // harness choices first: a pinned shape is also an own run, and the
    // de-dupe below keeps the first label for a given path
    if (base.wires.some(x => x.id !== wid && x.from === w.from && x.signal === w.signal && /^zone-(west|east)$/.test(x.cls)))
      menu.push({ label: "Join the harness (share the trunk)", hint: { bundle: true } },
                { label: "Own run (leave the harness)", hint: { bundle: false } });
    if (cls === "zone-west") menu.push({ label: "Up beside the rack", hint: { ch: "col" } },
                                       { label: "Up past the end of the zone row", hint: { ch: "gutter" } });
    else menu.push({ label: "Into the top of the zone box", hint: { land: "top" } },
                   { label: "Into the bottom of the zone box", hint: { land: "bottom" } });
  } else {
    // must mirror routeRackToRack's same-column test (same x AND same rack), or
    // aligned devices in stacked racks get a menu their router can't honor
    const rackOfId = id => placed.racks.find(r => r.devices.some(d => d.id === id));
    const sameCol = fromDev && Math.abs(toDev.x - fromDev.x) < 8 && rackOfId(fromDev.id) === rackOfId(toDev.id);
    if (fromDev && sameCol) {
      menu.push({ label: "Straight across beside the gear", hint: { ch: "staple" } },
                 { label: "Over the top of the rack", hint: { ch: "wrap" } });
    } else {
      menu.push({ label: "Through the gap between the first two columns", hint: { ch: "ab" } },
                 { label: "Around the left edge of the drawing", hint: { ch: "west" } });
      // returns can also be pinned to the strip between two stacked devices
      if (!fromDev) {
        const colDevs = devs.filter(d => d.col === toDev.col).sort((a, b) => a.y - b.y);
        for (let i = 0; i + 1 < colDevs.length; i++) {
          const a = colDevs[i], b = colDevs[i + 1];
          if (b.y - (a.y + a.h) > 14)
            menu.push({ label: `Between ${a.model || a.id} and ${b.model || b.id}`,
                        hint: { ch: "ab", between: [a.id, b.id] } });
        }
      }
    }
  }
  const alts = [], seen = new Set();
  for (const m of menu) {
    const rt = route(job, ix, placed, { ...opts, hintOverride: { [wid]: m.hint || false } });
    const w = rt.wires.find(x => x.id === wid);
    if (!w || !w.pts || w.pts.length < 2) continue;
    if (m.hint && rt.warnings.some(x => x.code === "hint-unroutable" && x.msg === wid)) continue;
    const key = JSON.stringify(w.pts);
    if (seen.has(key)) continue;
    seen.add(key);
    alts.push({ label: m.label, hint: m.hint, pts: w.pts, d: wireD(w), crossings: rt.crossings });
  }
  return alts;
}

export function wireD(w) {
  let d = `M${w.pts[0][0]} ${w.pts[0][1]}`;
  for (let i = 1; i < w.pts.length; i++) {
    const [x1, y1] = w.pts[i - 1], [x2, y2] = w.pts[i];
    const hops = (w.hops || []).filter(h => h.si === i - 1)
      .sort((a, b) => x1 === x2 ? (y2 > y1 ? a.y - b.y : b.y - a.y) : (x2 > x1 ? a.x - b.x : b.x - a.x));
    for (const h of hops) {
      const r = h.w / 2;   // one arc per hop — a bundle bridge is one big half-circle
      if (x1 === x2) {
        const dir = y2 > y1 ? 1 : -1, sweep = y2 > y1 ? 1 : 0;
        d += `L${x1} ${h.y - dir * r}A${r} ${r} 0 0 ${sweep} ${x1} ${h.y + dir * r}`;
      } else {
        const dir = x2 > x1 ? 1 : -1, sweep = x2 > x1 ? 1 : 0;
        d += `L${h.x - dir * r} ${y1}A${r} ${r} 0 0 ${sweep} ${h.x + dir * r} ${y1}`;
      }
    }
    d += `L${x2} ${y2}`;
  }
  return d;
}

const LEGEND_LABELS = { video: SIGNAL_SHORT.video, audio: SIGNAL_SHORT.audio, dante: "Dante audio", audioReturn: SIGNAL_SHORT.audioReturn, network: SIGNAL_SHORT.network, prewire: SIGNAL_SHORT.prewire };
const fmtDate = iso => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${+m[2]}/${+m[3]}/${m[1].slice(2)}` : esc(iso); };

// a label that must stay inside its tile: past the width it's squeezed to fit
// (textLength) instead of spilling over the tile edge or a neighbor
const fitText = (x, y, text, size, fill, maxW) => {
  const t = String(text ?? "");
  const est = t.length * size * 0.56;
  const fit = est > maxW ? ` textLength="${Math.round(maxW)}" lengthAdjust="spacingAndGlyphs"` : "";
  return `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" fill="${fill}"${fit}>${esc(t)}</text>`;
};
// a tile prints brand over model; a placeholder name ("AV receiver — Theater")
// splits at its dash instead, so the generic type stays whole on top
// A known brand (from the job's locked catalog entry, or a multi-word maker)
// stays whole: "AVPro Edge" over "AC-MX-88", never "AVPro" over "Edge AC-MX-88".
const MULTIWORD_BRANDS = ["AVPro Edge"];
const tileName = (model, brand) => {
  const m = String(model || "");
  const i = m.indexOf(" — ");
  if (i > 0) return [m.slice(0, i), m.slice(i + 3)];
  for (const b of [brand, ...MULTIWORD_BRANDS].filter(Boolean))
    if (m.toLowerCase().startsWith(b.toLowerCase() + " ")) return [m.slice(0, b.length), m.slice(b.length + 1)];
  return m.split(" ");
};

/* ---------- Dante as labels ----------
   The receiving box (an amp) carries "DANTE ← Kitchen · Pool · Dante bridge" over its
   top edge (names wrap three to a line); each source says where it goes — a room
   adapter beside its chip ("→ Director"), a rack box over its top edge. */
function drawDanteTags(job, ix, sol, s, P, tags, bw) {
  const o = [], color = bw ? "#333" : SIGNAL_COLORS.dante;
  const tile = id => P.racks.flatMap(r => r.devices).find(d => d.id === id) || null;
  const chip = id => P.chips.find(c => c.id === id) || null;
  const nameOf = id => {
    const comp = s.companions[id];
    if (comp && ix.endpointsById[comp.serves]) return `${ix.zonesById[ix.endpointZone[comp.serves]]?.name || "Room"} ${adapterTag(comp)}`;
    const d = s.devices[id];
    if (d?.type === "danteBridge") return "Dante bridge";
    return d ? String(d.model || d.id).replace(/^(AudioControl|AVPro Edge|Anthem|Savant|Sonance|Crestron|Snap One)\s+/i, "") : describeNode(job, sol, id).short;
  };
  const text = (x, y, str, anchor = "start") => o.push(`<text class="dantetag" x="${x}" y="${y}"${anchor !== "start" ? ` text-anchor="${anchor}"` : ""} font-size="9" font-weight="700" letter-spacing=".3" fill="${color}" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(str)}</text>`);
  // the receiving side: one block per box, over its top edge
  const byTo = new Map();
  for (const t of tags) (byTo.get(t.to) || byTo.set(t.to, []).get(t.to)).push(t.from);
  for (const [to, froms] of byTo) {
    const b = tile(to) || chip(to); if (!b) continue;
    const names = [...new Set(froms.map(nameOf))];
    const lines = []; for (let i = 0; i < names.length; i += 3) lines.push(names.slice(i, i + 3).join(" · "));
    lines.forEach((ln, i) => text(b.x, b.y - 5 - (lines.length - 1 - i) * 11, `${i ? "" : "DANTE ← "}${ln}`));
  }
  // the sending side
  const byFrom = new Map();
  for (const t of tags) (byFrom.get(t.from) || byFrom.set(t.from, []).get(t.from)).push(t.to);
  for (const [from, tos] of byFrom) {
    const names = [...new Set(tos.map(nameOf))].join(" · ");
    const c = chip(from), d = tile(from);
    if (c) text(c.x + c.w + 4, c.y + c.h / 2 + 3, `→ ${names}`);
    else if (d && !byTo.has(from)) text(d.x + d.w, d.y - 5, `DANTE → ${names}`, "end");
  }
  return o.join("");
}

/* ---------- trunk drawing (trunk mode) ----------
   A trunk net's members share runs. Split every net into pieces carried by the
   same set of wires, then draw
     bundle: a shared piece as one heavy line with ×N, a single wire thin;
     ribbon: every wire its own thin line, packed side by side (lanes ordered so
             the wire that turns off first rides on the side it turns to);
             past RIBBON_MAX wires a piece falls back to the bundle look.
   Each piece gets a white halo, so whatever it passes over reads as crossed
   under. Wire numbers (the Wire Schedule's) sit on each wire's room end. */
const RIBBON_MAX = 10, RIBBON_PITCH = 4, RIBBON_MIN_PITCH = 3, RIBBON_MERGE = 10;   // 10 lanes at 4 px; up to 13 squeezed into the same 36 px (tighter blurs on screen)
const SPEAKER_SETUP_SHORT = c => ({ "surround-5.1": "5.1", "surround-7.1": "7.1", "surround-7.1.4": "7.1.4" }[c] || "surround");
/* Ribbon layout (Ryan 2026-10-01: "make the ribbons as clean as possible"). Every wire keeps ONE
   lane for the whole of each shared run — no re-centring as wires join or leave — and is drawn as
   one continuous offset line, so its corners meet. A run is the stretch of one axis line its wires
   overlap; lanes across it are ordered by where each wire peels off at either end (whoever turns
   off first sits outermost on that side), using the neighbouring run's lanes as the turn point —
   iterated, that makes corners concentric. A lone stretch (a jack's stub, a room drop) sits on
   the centre line, so a wire leaves its jack straight and turns into its lane. Returns null when
   a run would be wider than RIBBON_MAX lanes (that trunk draws in the bundle look instead). */
export function ribbonLayout(members) {
  const runsOf = mi => members[mi].runs || 1;
  let P = RIBBON_PITCH;
  const wsegs = members.map((m, mi) => {
    const out = [], p = m.w.pts;
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i]; if (a[0] === b[0] && a[1] === b[1]) continue;
      const h = a[1] === b[1];
      out.push({ mi, a, b, dir: h ? "h" : "v", at: h ? a[1] : a[0], lo: Math.min(h ? a[0] : a[1], h ? b[0] : b[1]), hi: Math.max(h ? a[0] : a[1], h ? b[0] : b[1]), base: -(runsOf(mi) - 1) / 2 * P });
    }
    out.forEach((g, k) => { g.prev = out[k - 1] || null; g.next = out[k + 1] || null; });
    return out;
  });
  // runs: stretches of one direction that overlap along their axis and lie on the same line — or
  // on parallel tracks of this trunk closer than RIBBON_MERGE (the router may give one family two
  // tracks a few px apart; drawn separately, one track's lanes would land on the other's)
  const all = wsegs.flat(), up = all.map((_, i) => i);
  const find = i => up[i] === i ? i : (up[i] = find(up[i]));
  // first the stretches on one line that overlap — or that meet end to end, for two wires (an on-ramp
  // and a breakout at the same riser: once the riser spreads into lanes, both would reach into the gap)
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (a.dir === b.dir && a.at === b.at && Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > (a.mi !== b.mi ? -0.5 : 0.5)) up[find(i)] = find(j);
  }
  // then parallel tracks closer than RIBBON_MERGE (or whose bands would touch: a ×7 line doubling back
  // 12 px apart lays its legs side by side) — but never a run holding a wire's first or last stretch:
  // its jack stub or room drop stays on its own line (pulled into a neighbour's run, it leaves its jack sideways)
  const end = g => !g.prev || !g.next, pinned = new Set();
  all.forEach((g, i) => { if (end(g) && runsOf(g.mi) === 1) pinned.add(find(i)); });
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (a.dir !== b.dir || a.at === b.at || pinned.has(find(i)) || pinned.has(find(j))) continue;
    const reach = Math.max(RIBBON_MERGE, ((runsOf(a.mi) - 1) + (runsOf(b.mi) - 1)) / 2 * RIBBON_PITCH + RIBBON_PITCH);
    // (touching counts: a ×5 line's two legs either side of a 12 px jog draw as straight lanes, not a shear)
    if (Math.abs(a.at - b.at) <= reach && Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > -0.5) up[find(i)] = find(j);
  }
  const groups = new Map();
  all.forEach((g, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)).push(g); });
  const runs = [...groups.values()];
  // a merged run's lanes sit around one axis; `base` stays relative to each stretch's own line
  for (const r of runs) r.axis = r.length > 1 ? Math.round(r.reduce((n, g) => n + g.at, 0) / r.length * 2) / 2 : r[0].at;
  const shared = runs.filter(r => r.length > 1);
  // past RIBBON_MAX lanes the pitch tightens to keep the band as wide as the router keeps clear
  // ((RIBBON_MAX − 1) × pitch). A stretch too full even for that (its lines would merge) is
  // gathered into a bundle bar with its ×N — the lanes run into it and fan back out, like a loom
  const maxLanes = Math.floor((RIBBON_MAX - 1) * RIBBON_PITCH / RIBBON_MIN_PITCH) + 1;
  const width = r => r.reduce((n, g) => n + runsOf(g.mi), 0);
  const bars = [...shared.filter(r => width(r) > maxLanes), ...runs.filter(r => r.length === 1 && runsOf(r[0].mi) > maxLanes)];
  for (const r of bars) for (const g of r) g.bar = true;
  const lanes = runs.filter(r => !r[0].bar).map(width);
  const widest = Math.max(1, ...lanes);
  if (widest > RIBBON_MAX) P = (RIBBON_MAX - 1) * RIBBON_PITCH / (widest - 1);
  for (const r of runs) for (const g of r) g.base = (r[0].bar ? 0 : -(runsOf(g.mi) - 1) / 2 * P) + (r.length > 1 ? r.axis - g.at : 0);
  const centre = g => g.base + (runsOf(g.mi) - 1) / 2 * P;
  const along = (g, pt) => g.dir === "h" ? pt[0] : pt[1], across = (g, pt) => g.dir === "h" ? pt[1] : pt[0];
  // how a stretch leaves the run at one end: which side it turns to, and where (its neighbour's lane)
  const endOf = (g, atLo) => {
    const pt = along(g, g.a) === (atLo ? g.lo : g.hi) ? g.a : g.b;
    const n = pt === g.a ? g.prev : g.next;
    if (!n || n.dir === g.dir) return { side: 0, t: atLo ? g.lo : g.hi };
    const other = n.a === pt ? n.b : n.a;
    return { side: Math.sign(across(g, other) - across(g, pt)), t: (atLo ? g.lo : g.hi) + centre(n) };
  };
  const BIG = 1e7;
  const keyLo = e => e.side < 0 ? -BIG - e.t : e.side > 0 ? BIG + e.t : 0;
  const keyHi = e => e.side < 0 ? -BIG + e.t : e.side > 0 ? BIG - e.t : 0;
  // wires that leave (or reach) one jack together stay one line there and split into lanes at the
  // next turn — the way one cable fans out — instead of spreading onto a neighbouring jack's line
  const jackPt = g => !g.prev && runsOf(g.mi) === 1 ? g.a + "" : !g.next && runsOf(g.mi) === 1 ? g.b + "" : null;
  for (const r of shared) if (r.every(g => jackPt(g) && jackPt(g) === jackPt(r[0]))) r.fork = true;
  for (let it = 0; it < 6; it++) {
    for (const r of shared) {
      if (r[0].bar || r.fork) continue;
      const info = r.map(g => ({ g, lo: keyLo(endOf(g, true)), hi: keyHi(endOf(g, false)) }));
      info.sort((x, y) => (x.lo - y.lo) || (x.hi - y.hi) || (x.g.mi - y.g.mi));
      const N = r.reduce((n, g) => n + runsOf(g.mi), 0);
      let k = 0;
      for (const { g } of info) { g.base = r.axis - g.at + (k - (N - 1) / 2) * P; k += runsOf(g.mi); }
    }
  }
  // each wire, each of its runs: one offset polyline
  const shift = (g, pt, o) => g.dir === "h" ? [pt[0], pt[1] + o] : [pt[0] + o, pt[1]];
  return wsegs.map((gs, mi) => Array.from({ length: runsOf(mi) }, (_, r) => {
    if (!gs.length) return members[mi].w.pts;
    const off = g => g.bar ? g.base : g.base + r * P, pts = [shift(gs[0], gs[0].a, off(gs[0]))];
    for (let k = 1; k < gs.length; k++) {
      const g0 = gs[k - 1], g1 = gs[k], c = g1.a;
      if (g0.dir === g1.dir) { pts.push(shift(g0, c, off(g0)), shift(g1, c, off(g1))); continue; }
      pts.push(g0.dir === "h" ? [c[0] + off(g1), c[1] + off(g0)] : [c[0] + off(g0), c[1] + off(g1)]);
    }
    const gl = gs[gs.length - 1]; pts.push(shift(gl, gl.b, off(gl)));
    // a single wire starts and ends ON its jack (two wires out of one jack step into their lanes from it);
    // a multi-run line lands as its N cables side by side
    if (runsOf(mi) === 1) { pts.unshift(gs[0].a); pts.push(gl.b); }
    return pts.filter((q, k) => !k || q[0] !== pts[k - 1][0] || q[1] !== pts[k - 1][1]);
  })).map(polys => Object.assign(polys, { pitch: P,
    bars: bars.map(r => ({ dir: r[0].dir, at: r.axis, lo: Math.min(...r.map(g => g.lo)), hi: Math.max(...r.map(g => g.hi)), n: width(r) })) }));
}
const polyD = pts => pts.map((q, i) => `${i ? "L" : "M"}${+q[0].toFixed(2)} ${+q[1].toFixed(2)}`).join("");

function drawTrunks(list, style0, labels, extra = {}, others = [], bodies = []) {
  const o = [], labelReqs = [];
  // ×N counts: the middle of the run unless a box or another count is there — then slide along
  // the run, then try its other side (2026-10-01: 11 of 481 bundle counts sat on a box or chip)
  const tickBoxes = [];
  // segs: [{dir, lo, hi, at}] — the run first, then other stretches of the same wire to fall back on
  const tickAt = (segs, n, color) => {
    const txt = `×${n}`, w = 6.5 * txt.length, h = 11;
    const free = r => !bodies.some(q => r.x < q.x + q.w + 1 && r.x + r.w > q.x - 1 && r.y < q.y + q.h + 1 && r.y + r.h > q.y - 1) &&
      !tickBoxes.some(q => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y);
    let pick = null;
    for (const { dir, lo, hi, at } of segs) {
      for (const t of [0.5, 0.38, 0.62, 0.26, 0.74, 0.14, 0.86]) {
        const c = lo + (hi - lo) * t;
        const opts = dir === "h"
          ? [{ x: c, y: at - 7, anchor: "middle", r: { x: c - w / 2, y: at - 16, w, h } }, { x: c, y: at + 15, anchor: "middle", r: { x: c - w / 2, y: at + 6, w, h } }]
          : [{ x: at + 7, y: c + 4, anchor: "", r: { x: at + 7, y: c - 5, w, h } }, { x: at - 7, y: c + 4, anchor: "end", r: { x: at - 7 - w, y: c - 5, w, h } }];
        pick = opts.find(q => free(q.r));
        if (pick) break;
      }
      if (pick) break;
    }
    const { dir, lo, hi, at } = segs[0];
    pick ||= dir === "h" ? { x: (lo + hi) / 2, y: at - 7, anchor: "middle", r: null } : { x: at + 7, y: (lo + hi) / 2 + 4, anchor: "", r: null };
    if (pick.r) tickBoxes.push(pick.r);
    o.push(`<text class="bustick" x="${+pick.x.toFixed(1)}" y="${+pick.y.toFixed(1)}"${pick.anchor ? ` text-anchor="${pick.anchor}"` : ""} font-size="10.5" font-weight="700" fill="${color}" paint-order="stroke" stroke="#fff" stroke-width="3">${txt}</text>`);
  };
  const byNet = new Map();
  for (const t of list) (byNet.get(t.w.net) || byNet.set(t.w.net, []).get(t.w.net)).push(t);
  const tags = [];
  const ownPts = new Map();   // ribbon: a wire's own (offset) line, so tapping it lights its lane
  for (const members of byNet.values()) {
    const { color, dash } = members[0];
    const R = style0 === "ribbon" ? ribbonLayout(members) : null;
    const style = style0 === "ribbon" && !R ? "bundle" : style0;   // a run past RIBBON_MAX lanes draws bundled
    if (R) {
      const dashA = dash ? ` stroke-dasharray="${dash}"` : "";
      const all = R.flatMap((polys, mi) => polys.map(pts => ({ pts, mi })));
      for (const { pts } of all) o.push(`<path d="${polyD(pts)}" stroke="#fff" stroke-width="4.2" stroke-linejoin="round" stroke-linecap="butt"/>`);
      const sw = R[0]?.pitch < RIBBON_PITCH ? 1.1 : 1.4;   // a squeezed ribbon draws finer lines
      const bars = R[0]?.bars || [], barD = b => b.dir === "h" ? `M${b.lo} ${b.at}L${b.hi} ${b.at}` : `M${b.at} ${b.lo}L${b.at} ${b.hi}`;
      for (const b of bars) o.push(`<path d="${barD(b)}" stroke="#fff" stroke-width="9.2" stroke-linecap="butt"/>`);
      for (const { pts } of all) o.push(`<path d="${polyD(pts)}" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="butt"${dashA}/>`);
      for (const b of bars) {
        o.push(`<path d="${barD(b)}" stroke="${color}" stroke-width="5.2" stroke-linecap="round"${dashA}/>`);
        if (b.hi - b.lo < 70) continue;
        tickAt([{ dir: b.dir, lo: b.lo, hi: b.hi, at: b.at }], b.n, color);
      }
      R.forEach((polys, mi) => ownPts.set(members[mi].w, polys[Math.floor((polys.length - 1) / 2)]));
    } else {
    // pieces: per axis line, elementary intervals with the set of wires on them
    const lines = new Map();
    members.forEach((m, mi) => m.w.pts.forEach((q, i) => {
      if (!i) return;
      const a = m.w.pts[i - 1], b = q, hz = a[1] === b[1];
      if (a[0] === b[0] && a[1] === b[1]) return;
      const key = `${hz ? "h" : "v"}|${hz ? a[1] : a[0]}`;
      (lines.get(key) || lines.set(key, []).get(key)).push({ mi, si: i - 1, lo: Math.min(hz ? a[0] : a[1], hz ? b[0] : b[1]), hi: Math.max(hz ? a[0] : a[1], hz ? b[0] : b[1]) });
    }));
    const pieces = [];
    for (const [key, ivs] of lines) {
      const [dir, c] = key.split("|"); const at = +c;
      const bps = [...new Set(ivs.flatMap(v => [v.lo, v.hi]))].sort((a, b) => a - b);
      for (let k = 1; k < bps.length; k++) {
        const on = ivs.filter(v => v.lo <= bps[k - 1] && v.hi >= bps[k]);
        if (on.length) pieces.push({ dir, at, lo: bps[k - 1], hi: bps[k], on });
      }
    }
    const xy = p => p.dir === "h" ? [[p.lo, p.at], [p.hi, p.at]] : [[p.at, p.lo], [p.at, p.hi]];
    // a piece counts cable runs, not wires: an analog module → amp line is ×N runs on its own
    const runsOf = v => members[v.mi].runs || 1;
    for (const p of pieces) p.n = p.on.reduce((n, v) => n + runsOf(v), 0);
    const W = p => p.n > 1 && (style === "bundle" || p.n > RIBBON_MAX) ? 5.2 : 2.2;
    const ribbon = p => style === "ribbon" && p.n > 1 && p.n <= RIBBON_MAX;
    // halos first, then the lines
    for (const p of pieces) {
      const [[x1, y1], [x2, y2]] = xy(p), wd = ribbon(p) ? (p.n - 1) * RIBBON_PITCH + 2 : W(p);
      o.push(`<path d="M${x1} ${y1}L${x2} ${y2}" stroke="#fff" stroke-width="${wd + 4}" stroke-linecap="butt"/>`);
    }
    const dashA = dash ? ` stroke-dasharray="${dash}"` : "";
    // ribbon lane order per piece: turn-toward-+ first (earliest turn outermost), straight, then turn-toward-−
    const laneOf = new Map();   // `${mi}|${si}|${lo}` → offset
    for (const p of pieces.filter(ribbon)) {
      const info = p.on.map(v => {
        const pts = members[v.mi].w.pts, a = pts[v.si], b = pts[v.si + 1], nx = pts[v.si + 2];
        const along = p.dir === "h" ? (b[0] - a[0]) : (b[1] - a[1]);
        const end = p.dir === "h" ? b[0] : b[1];
        const turn = nx ? Math.sign(p.dir === "h" ? nx[1] - b[1] : nx[0] - b[0]) : 0;
        // distance travelled on this line before turning (smaller = turns off sooner)
        const t = along >= 0 ? end - p.lo : p.hi - end;
        return { v, turn, t };
      });
      const plus = info.filter(i => i.turn > 0).sort((a, b) => a.t - b.t);
      const zero = info.filter(i => i.turn === 0);
      const minus = info.filter(i => i.turn < 0).sort((a, b) => b.t - a.t);
      // each wire takes as many lanes as it has runs; laneOf holds its first lane
      const ordered = [...plus, ...zero, ...minus], n = p.n;
      let k = 0;
      for (const i of ordered) { laneOf.set(`${i.v.mi}|${i.v.si}|${p.lo}|${p.dir}`, ((n - 1) / 2 - k) * RIBBON_PITCH); k += runsOf(i.v); }
    }
    for (const p of pieces) {
      const [[x1, y1], [x2, y2]] = xy(p);
      if (!ribbon(p)) { o.push(`<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${color}" stroke-width="${W(p)}" stroke-linecap="round"${dashA}/>`); continue; }
      for (const v of p.on) for (let r = 0; r < runsOf(v); r++) {
        const off = (laneOf.get(`${v.mi}|${v.si}|${p.lo}|${p.dir}`) ?? ((p.n - 1) / 2) * RIBBON_PITCH) - r * RIBBON_PITCH;
        const [a, b] = p.dir === "h" ? [[x1, y1 + off], [x2, y2 + off]] : [[x1 + off, y1], [x2 + off, y2]];
        o.push(`<path d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}" stroke="${color}" stroke-width="1.4" stroke-linecap="square"${dashA}/>`);
      }
    }
    // ×N on the longer shared runs (bundle look)
    const longestOnLine = new Map();
    for (const p of pieces) if (p.dir === "h" && p.n > 1) { const k = p.at, b = longestOnLine.get(k); if (!b || p.hi - p.lo > b.hi - b.lo) longestOnLine.set(k, p); }
    const seg = p => { const [[x1, y1], [x2, y2]] = xy(p);
      return p.dir === "h" ? { dir: "h", lo: Math.min(x1, x2), hi: Math.max(x1, x2), at: y1 } : { dir: "v", lo: Math.min(y1, y2), hi: Math.max(y1, y2), at: x1 }; };
    const tick = (p, alts = []) => tickAt([p, ...alts.filter(q => q !== p && q.hi - q.lo >= 12)].map(seg), p.n, color);
    const ticked = new Set();
    for (const p of pieces) {
      if (p.n < 2 || p.hi - p.lo < 70 || ribbon(p)) continue;
      if (p.dir === "h" && longestOnLine.get(p.at) !== p) continue;
      // fallback stretches: other pieces carrying exactly the same wires (the count still reads true there)
      const key = q => q.on.map(v => v.mi).sort((a, b) => a - b).join(",");
      tick(p, pieces.filter(q => q.n === p.n && key(q) === key(p)).sort((a, b) => (b.hi - b.lo) - (a.hi - a.lo))); ticked.add(p);
    }
    // a multi-run wire always shows its own count: on its longest stretch alone, when no tick already says it
    members.forEach((m, mi) => {
      if ((m.runs || 1) < 2) return;
      const solo = pieces.filter(p => p.on.length === 1 && p.on[0].mi === mi);
      if (solo.some(p => ticked.has(p)) || style === "ribbon" && m.runs <= RIBBON_MAX) return;   // a ribbon draws its runs
      const p = solo.sort((a, b) => (b.hi - b.lo) - (a.hi - a.lo))[0];
      if (p && p.hi - p.lo >= 16) { tick(p, solo); ticked.add(p); }
    });
    }
    // wire numbers at each room end — placed below, once every line is drawn
    for (const m of members) {
      const lab = labels[m.w.id] && (extra[m.w.id] ? `${labels[m.w.id]} · ${extra[m.w.id]}` : labels[m.w.id]); if (!lab) continue;
      const pts = ownPts.get(m.w) || m.w.pts, inbound = /^(audioReturn)$/.test(m.w.signal) || m.w.dante;
      if (pts.length < 2) continue;
      labelReqs.push({ lab, color, pts: inbound ? [...pts].reverse() : pts, w: m.w });
    }
  }
  /* label placement (dogfood 2026-10-01: "R-01 · eARC KIT" sat on a neighbouring ribbon): each label tries
     spots along its wire's room-end stretch, either side, then the stretch before it, and takes the one
     touching the fewest drawn lines and no other label */
  const drawn = [...list.flatMap(({ w }) => { const p = ownPts.get(w) || w.pts; return p.slice(1).map((q, i) => [p[i], q]); }),
    ...others.flatMap(w => w.pts.slice(1).map((q, i) => [w.pts[i], q]))];
  const placedBoxes = [];
  const hitsSeg = (bx, [a, b]) => Math.max(a[0], b[0]) >= bx[0] && Math.min(a[0], b[0]) <= bx[2] && Math.max(a[1], b[1]) >= bx[1] && Math.min(a[1], b[1]) <= bx[3];
  for (const L of labelReqs) {
    const tw = L.lab.length * 5.5 + 4, n = L.pts.length;
    let best = null;
    for (const [si, pen] of [[n - 2, 0], [n - 3, 3], [n - 4, 6], [n - 5, 9]]) {
      if (si < 0) continue;
      const a = L.pts[si], b = L.pts[si + 1], vert = a[0] === b[0];
      const len = vert ? Math.abs(b[1] - a[1]) : Math.abs(b[0] - a[0]);
      if (len < 12) continue;
      for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const x0 = a[0] + (b[0] - a[0]) * f, y0 = a[1] + (b[1] - a[1]) * f;
        const spots = vert
          ? [{ x: x0 + 6, y: y0 + 3.5, anchor: "", box: [x0 + 5, y0 - 5, x0 + 6 + tw, y0 + 5] }, { x: x0 - 6, y: y0 + 3.5, anchor: "end", box: [x0 - 6 - tw, y0 - 5, x0 - 5, y0 + 5] }]
          : [{ x: x0, y: y0 - 5, anchor: "middle", box: [x0 - tw / 2, y0 - 13, x0 + tw / 2, y0 - 3] }, { x: x0, y: y0 + 12, anchor: "middle", box: [x0 - tw / 2, y0 + 3, x0 + tw / 2, y0 + 13] }];
        for (const sp of spots) {
          const segHits = drawn.filter(sg => hitsSeg(sp.box, sg)).length;
          const lblHits = placedBoxes.filter(q => q[0] < sp.box[2] && q[2] > sp.box[0] && q[1] < sp.box[3] && q[3] > sp.box[1]).length;
          // a room card, chip or rack box under the label (its border, its glyphs) reads as badly as a line
          const bodyHits = bodies.filter(q => q.x < sp.box[2] && q.x + q.w > sp.box[0] && q.y < sp.box[3] && q.y + q.h > sp.box[1]).length;
          const cost = lblHits * 100 + bodyHits * 30 + segHits * 10 + pen + Math.abs(f - 0.5) * 2;
          if (!best || cost < best.cost) best = { ...sp, cost };
        }
      }
    }
    if (!best) continue;
    placedBoxes.push(best.box);
    tags.push(`<text class="wirenum" x="${+best.x.toFixed(1)}" y="${+best.y.toFixed(1)}"${best.anchor ? ` text-anchor="${best.anchor}"` : ""} font-size="9" font-weight="700" letter-spacing=".3" fill="${L.color}" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(L.lab)}</text>`);
  }
  // each trunk wire keeps a path of its own, invisible until selected: tapping a trunk picks
  // one wire, and the selection shows that wire's whole route through its trunk
  const own = list.map(({ w, color }) => `<path class="wire trunkwire${w.dante ? " dante" : ""}" data-wire="${esc(w.id)}" data-from="${esc(w.from)}" data-to="${esc(w.to)}" data-signal="${esc(w.signal)}" d="${ownPts.has(w) ? polyD(ownPts.get(w)) : wireD(w)}" stroke="${color}" stroke-opacity="0" fill="none"/>`);
  return `<g class="trunks" fill="none">${o.join("")}</g>${tags.join("")}${own.join("")}`;
}

export function render(job, ix, P, rt, opts = {}) {
  const bw = !!opts.grayscale;   // B&W-safe mode: dashes carry signal identity
  const kindColor = opts.kindColor !== false;   // color by kind (View toggle, on by default)
  const usage = opts.usage || {};
  const gls = P.glyphScale || 1;                 // TV + speaker glyph scale place() chose                // status lights: boxUsage(job, ix, catalog, advice)
  const s = ix.solutions[opts.solution ?? 0];
  const sol = s.sol;
  const out = [];
  const push = (...x) => out.push(...x);

  push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET.width} ${SHEET.height}" font-family="'Avenir Next', Avenir, Futura, 'Helvetica Neue', sans-serif">`);

  /* defs: grid, TV gradient, speaker/sub glyphs, logo sphere clip */
  push(`<defs>
  <pattern id="gp" width="60" height="60" patternUnits="userSpaceOnUse">
    <path d="M12 0V60M24 0V60M36 0V60M48 0V60M0 12H60M0 24H60M0 36H60M0 48H60" stroke="#f0f1f4" stroke-width="1" fill="none"/>
    <path d="M0.5 0V60M0 0.5H60" stroke="#e3e5eb" stroke-width="1" fill="none"/>
  </pattern>
  <linearGradient id="tvg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d6e4f2"/><stop offset="1" stop-color="#9dbcd9"/></linearGradient>
  <g id="spk"><circle r="16" fill="#2d2d2d" stroke="#151515"/><circle r="9.5" fill="#8f8f8f" stroke="#3a3a3a"/><circle r="3" fill="#2d2d2d"/></g>
  <g id="spks"><circle r="10" fill="#2d2d2d" stroke="#151515"/><circle r="6" fill="#8f8f8f" stroke="#3a3a3a"/><circle r="1.8" fill="#2d2d2d"/></g>
  <g id="sub"><rect x="-15" y="-15" width="30" height="30" rx="3" fill="#2d2d2d" stroke="#151515"/><circle r="9" fill="#8f8f8f" stroke="#3a3a3a"/><circle r="2.6" fill="#2d2d2d"/></g>
</defs>`);

  /* sheet frame */
  push(`<rect width="${SHEET.width}" height="${SHEET.height}" fill="#fff"/>`);
  push(`<rect x="${SHEET.content.x}" y="${SHEET.content.y}" width="${SHEET.content.w}" height="${SHEET.content.h}" fill="url(#gp)"/>`);
  push(`<rect x="${SHEET.outerFrame.x}" y="${SHEET.outerFrame.y}" width="${SHEET.outerFrame.w}" height="${SHEET.outerFrame.h}" fill="none" stroke="#444" stroke-width="1.5"/>`);
  push(`<rect x="${SHEET.content.x}" y="${SHEET.content.y}" width="${SHEET.content.w}" height="${SHEET.content.h}" fill="none" stroke="#777"/>`);

  /* drawing space */
  push(`<g transform="translate(${SHEET.content.x + (P.fitOffset?.x || 0)} ${SHEET.content.y + (P.fitOffset?.y || 0)}) scale(${P.fitScale})">`);

  for (const h of P.areaHeaders)
    push(`<text x="${h.cx}" y="${h.y}" text-anchor="middle" font-size="13" letter-spacing="4" fill="#8a8a8a" font-weight="600">${esc(h.name)}</text>`);

  /* racks + devices */
  for (const r of P.racks) {
    push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="#8a8a8a" stroke-width="1.4" stroke-dasharray="7 5"/>`);
    push(`<text x="${r.x + 14}" y="${r.y + 24}" font-size="20" font-weight="700" fill="#111">${esc(r.name)}</text>`);
    for (const d of r.devices) {
      const dev = s.devices[d.id] || {};
      // color by kind: tint + edge (B&W: patterned edge on the usual black)
      const fk = deviceKind(dev, job.job?.catalogSnapshot?.devices?.[dev.catalogRef]);   // the face follows the kind even with color off
      const kind = kindColor ? fk : null;
      const tint = (base) => kind && (!bw || kind === "power") ? KIND_STYLE[kind].tint : base;
      push(`<g class="devtile" data-device="${esc(d.id)}"${kind ? ` data-kind="${kind}"` : ""}>`);
      if (d.kind === "small") {
        const rx = ["appletv", "streamer"].includes(sourceFace(dev)) ? 8 : 3;
        push(`<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" rx="${rx}" fill="${tint("#1e1e1e")}"/>`);
        if (kind) push(kindEdge(kind, d.x, d.y, d.h, rx, bw));
        push(`<circle cx="${d.x + 9}" cy="${d.y + d.h / 2}" r="2.3" fill="#3fbf5a"/>`);
        const u = usage[d.id] || {}, L = { lit: kind && KIND_STYLE[kind].edge ? KIND_STYLE[kind].edge : "#3b82c4", bw };
        if (dev.type === "power") {
          // WattBox: its outlets, lit for every box plugged in (two rows)
          const o = u.outlets || { used: 0, cap: 0 };
          if (o.cap) push(pipField(d.x + d.w - 34, d.y + d.h / 2 - 6, o, { ...L, rows: 2, maxPer: 9, w: 4.5, h: 5, pitch: 6.5, shape: "outlet", what: "Outlets" }));
          else push([0, 1].map(i => `<rect x="${d.x + d.w - 34 + i * 12}" y="${d.y + d.h / 2 - 5}" width="9" height="10" rx="2" fill="none" stroke="#8f8f8f" stroke-width="0.9"/>`).join(""));
        } else if (dev.type === "avbSwitch" && u.ports) push(pipField(d.x + d.w - 30, d.y + d.h / 2 - 6, u.ports, { ...L, rows: 2, maxPer: 8, w: 4.5, h: 5, pitch: 6, what: "Ports" }));
        else push(faceGlyph(dev, d.x + d.w - 18, d.y + d.h / 2));
        push(fitText(d.x + d.w / 2, d.y + d.h + 15, d.model, 12, "#333", d.w + 36));
      } else if (d.kind === "amp") {
        push(`<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" rx="3" fill="${tint("#1c1c1c")}" stroke="#0d0d0d"/>`);
        if (kind) push(kindEdge(kind, d.x, d.y, d.h, 3, bw));
        const [brand, ...restName] = tileName(d.model, job.job?.catalogSnapshot?.devices?.[dev.catalogRef]?.brand);
        push(fitText(d.x + d.w / 2, d.y + 16, brand, 11, "#ddd", d.w - 12));
        // channel strip: used (blue), reserved (gray), spare (outline)
        const zones = Math.max(1, Math.floor(+dev.zones) || 8);
        const feeds = (sol.connections || []).filter(c => c.from === d.id && c.signal === "speaker");
        const slot = {};
        const mark = (k, st) => { if (slot[k] !== "used") slot[k] = st; };   // a live feed outranks a reservation
        // feeds with channels occupy every zone-out they span ("1-4" = outs 1–2);
        // feeds made without channels take the next free out instead of all
        // piling onto out 1
        const loose = [];
        for (const f of feeds) {
          const st = (f.scope || "included") !== "included" ? "res" : "used";
          const chs = expandChannels(f.channels);
          if (!chs.length) { loose.push(st); continue; }
          for (const ch of chs) mark(Math.min(zones, Math.ceil(ch / 2)), st);
        }
        for (const st of loose) { let k = 1; while (k < zones && slot[k]) k++; mark(k, st); }
        const pitch = Math.min(18, (d.w - 32) / zones), x0 = d.x + d.w / 2 - (zones - 1) * pitch / 2 - 3.5;
        const sv = Object.values(slot);
        push(`<g class="lights">${lightsTitle("Amp zones", sv.filter(v => v === "used").length, zones, sv.filter(v => v === "res").length)}`);
        for (let k = 1; k <= zones; k++) {
          const x = x0 + (k - 1) * pitch;
          const st = slot[k];
          push(st === "used" ? `<rect x="${x}" y="${d.y + 26}" width="7" height="11" fill="${bw ? "#e6e6e6" : "#3b82c4"}"/>` :
               st === "res" ? `<rect x="${x}" y="${d.y + 26}" width="7" height="11" fill="#8c8c8c"/>` :
                              `<rect x="${x}" y="${d.y + 26}" width="7" height="11" fill="none" stroke="#666"/>`);
          push(`<text x="${x + 3.5}" y="${d.y + 48}" text-anchor="middle" font-size="8" fill="#9aa">${k}</text>`);
        }
        push(`</g>`);
        push(fitText(d.x + d.w / 2, d.y + d.h - 10, restName.join(" ") || d.model, 11, "#eee", d.w - 40));   // clear of the status light
        push(`<circle cx="${d.x + d.w - 12}" cy="${d.y + d.h - 12}" r="2.2" fill="#3fbf5a"/>`);
      } else {
        push(`<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" rx="3" fill="${tint("#262626")}" stroke="#101010"/>`);
        if (kind) push(kindEdge(kind, d.x, d.y, d.h, 3, bw));
        let [brand, ...restName] = tileName(d.model, job.job?.catalogSnapshot?.devices?.[dev.catalogRef]?.brand);
        // a receiver's tile says the room it drives on top, the product under it (Ryan 2026-10-02:
        // "Family Room · Anthem MRX 540") — read from the wiring; an imported "MRX SLM — Great Room" keeps its room
        if (dev.type === "avr") {
          const said = String(d.model || "").includes(" — ");
          const rooms = said ? [String(d.model).split(" — ").slice(1).join(" — ")] : drivesRooms(job, sol, d.id);
          if (rooms.length) { brand = rooms.join(" · "); restName = [said ? String(d.model).split(" — ")[0] : d.model]; }
        }
        push(fitText(d.x + d.w / 2, d.y + 17, brand, 11, dev.type === "avr" && brand !== tileName(d.model)[0] ? "#fff" : "#ddd", d.w - 12));
        // faceplate identity cues (squint-test assists, never the identifier)
        const my = d.y + d.h / 2 + 3;
        const u = usage[d.id] || {}, lit = kind && KIND_STYLE[kind].edge ? KIND_STYLE[kind].edge : "#3b82c4", dim = "#8f8f8f";
        const L = { lit, bw };
        if (dev.type === "avr") {
          // display window: one light per HDMI input (a plain slot when the inputs aren't known)
          push(`<rect x="${d.x + 14}" y="${my - 6}" width="${u.in ? Math.max(34, u.in.cap * 6 + 8) : 34}" height="12" rx="2" fill="#0d1116" stroke="#3a3f46" stroke-width="0.8"/>`);
          if (u.in) push(pipField(d.x + 18 + (u.in.cap * 6 - 2) / 2, my - 3, u.in, { ...L, w: 4, pitch: 6, maxPer: 12, what: "HDMI inputs" }));
          push(`<circle cx="${d.x + d.w - 24}" cy="${my}" r="8" fill="#161616" stroke="#7a7a7a" stroke-width="1.3"/>`);
          push(`<line x1="${d.x + d.w - 24}" y1="${my - 2}" x2="${d.x + d.w - 24}" y2="${my - 7}" stroke="#9a9a9a" stroke-width="1.3"/>`);
        } else if (fk === "video") {
          // matrix: a row of input lights over a row of output lights
          if (u.in || u.out) {
            if (u.in) push(pipField(d.x + d.w / 2 + 6, my - 9, u.in, { ...L, label: "IN", what: "HDMI inputs" }));
            if (u.out) push(pipField(d.x + d.w / 2 + 6, my + 1, u.out, { ...L, label: "OUT", what: "HDMI outputs" }));
          } else for (let gi = 0; gi < 3; gi++) for (let gj = 0; gj < 3; gj++)
            push(`<circle cx="${d.x + d.w / 2 - 6 + gj * 6}" cy="${my - 6 + gi * 6}" r="1.3" fill="${dim}"/>`);
        } else if (fk === "mxnet" || fk === "network" || fk === "avb") {
          // switch: its ports (two rows); MXNet adds a play mark — ports carrying video
          const cx = d.x + d.w / 2 + (fk === "mxnet" ? 6 : 0);
          if (u.ports) push(pipField(cx, my - 8, u.ports, { ...L, rows: 2, maxPer: 12, what: "Ports" }));
          else for (let gi = 0; gi < 2; gi++) for (let gj = 0; gj < 6; gj++)
            push(`<rect x="${cx - 19 + gj * 7}" y="${my - 8 + gi * 8}" width="5" height="6" rx="0.6" fill="none" stroke="${dim}" stroke-width="0.8"/>`);
          if (fk === "mxnet") {
            const fw = u.ports ? pipWidth(u.ports.cap, 2, 12, 7, 5) : 40;
            const tx = cx - fw / 2 - 12;
            push(`<path d="M${tx} ${my - 6}l7 4.5-7 4.5z" fill="${bw ? "#e6e6e6" : lit}"/>`);
          }
        } else if (fk === "control") {
          // the brains of the job
          const c = bw || !kind ? "#cfcfcf" : lit, bx = d.x + d.w / 2, by = my - 1;
          push(`<g fill="none" stroke="${c}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">` +
            `<path d="M${bx - 0.8} ${by - 7}C${bx - 5} ${by - 9} ${bx - 9.5} ${by - 6} ${bx - 8.5} ${by - 2.5}C${bx - 11} ${by} ${bx - 9.5} ${by + 5} ${bx - 6} ${by + 5.5}C${bx - 5} ${by + 8} ${bx - 1.5} ${by + 8.5} ${bx - 0.8} ${by + 6}Z"/>` +
            `<path d="M${bx + 0.8} ${by - 7}C${bx + 5} ${by - 9} ${bx + 9.5} ${by - 6} ${bx + 8.5} ${by - 2.5}C${bx + 11} ${by} ${bx + 9.5} ${by + 5} ${bx + 6} ${by + 5.5}C${bx + 5} ${by + 8} ${bx + 1.5} ${by + 8.5} ${bx + 0.8} ${by + 6}Z"/>` +
            `<path d="M${bx - 6} ${by - 3}q2.5 0.5 2.5 3M${bx - 4.5} ${by + 2.5}q2 -0.5 3.2 1.5M${bx + 6} ${by - 3}q-2.5 0.5 -2.5 3M${bx + 4.5} ${by + 2.5}q-2 -0.5 -3.2 1.5"/></g>`);
        } else if (dev.type === "audioInputModule" || dev.type === "audioOutputModule") {
          // mirrored module cues: jack field sits on the side the signals live —
          // input = left cluster with an arrow flowing IN, output = right
          // cluster with the arrow flowing OUT (matches where wires attach);
          // each jack lights when a run lands on it
          const inMod = dev.type === "audioInputModule";
          if (u.jacks) {
            const per = Math.ceil(Math.min(u.jacks.cap, 16) / 2), fw = per * 6 - 1.8;
            push(pipField(inMod ? d.x + 26 + fw / 2 : d.x + d.w - 26 - fw / 2, my - 6, u.jacks, { ...L, rows: 2, maxPer: 8, w: 4.2, h: 4.2, pitch: 6, shape: "jack", what: inMod ? "Audio inputs" : "Audio outputs" }));
          } else {
            const jx = inMod ? d.x + 26 : d.x + d.w - 44;
            for (let gi = 0; gi < 2; gi++) for (let gj = 0; gj < 4; gj++)
              push(`<circle cx="${jx + gj * 6}" cy="${my - 3 + gi * 6}" r="1.4" fill="${dim}"/>`);
          }
          const ax = inMod ? d.x + 10 : d.x + d.w - 20;
          push(`<line x1="${ax}" y1="${my}" x2="${ax + 9}" y2="${my}" stroke="${dim}" stroke-width="1.1"/>`);
          push(`<path d="M${ax + 9} ${my}l-3.2 -2.4v4.8z" fill="${dim}"/>`);
        }
        push(fitText(d.x + d.w / 2, d.y + d.h - 10, restName.join(" "), 10.5, "#eee", d.w - 40));   // clear of the status light
        push(`<circle cx="${d.x + d.w - 12}" cy="${d.y + d.h - 10}" r="2.2" fill="#3fbf5a"/>`);
      }
      push(`</g>`);
    }
  }

  /* zone cards */
  for (const z of P.zones) {
    const gray = z.scope !== "included";
    push(`<g class="zcard" data-zone="${esc(z.id)}">`);
    // un-filled shapes only hit-test on their stroke — this invisible fill makes the whole card tappable
    push(`<rect class="hit" x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" fill="transparent" stroke="none"/>`);
    push(`<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" fill="none" stroke="${gray ? "#b5b5b5" : "#8a8a8a"}" stroke-width="1.4" stroke-dasharray="7 5"/>`);
    push(`<text x="${z.x + z.w / 2}" y="${z.y + (z.compact ? 19 : 24)}" text-anchor="middle" font-size="${z.compact ? 13 : 18}" font-weight="700" fill="${gray ? "#999" : "#111"}">${esc(z.name)}</text>`);
    // room remote, top-right corner: what the client picks up in this room
    const rem = REMOTE_LABELS[z.remote];
    if (rem) {
      const rx = z.x + z.w - 24, ry = z.y + 9;
      push(`<rect x="${rx}" y="${ry}" width="11" height="22" rx="5" fill="#2d2d2d" stroke="#8a8a8a" stroke-width="0.8"/>`);
      push(`<circle cx="${rx + 5.5}" cy="${ry + 5}" r="1.5" fill="#8f8f8f"/>`);
      push(`<circle cx="${rx + 5.5}" cy="${ry + 10}" r="1.2" fill="#6a6a6a"/>`);
      push(`<rect x="${rx + 3.5}" y="${ry + 14}" width="4" height="4" rx="1" fill="#6a6a6a"/>`);
      push(`<text x="${rx + 5.5}" y="${ry + 33}" text-anchor="middle" font-size="7" letter-spacing="0.5" fill="#8a8a8a">${rem}</text>`);
    }
    for (const g of z.groups) {
      const gx = z.x + g.x, gy = z.y + g.y;
      if (g.kind === "display") {
        const f = Math.min(gls, 1.15);   // the TV's words grow a little with it
        push(`<rect x="${gx}" y="${gy}" width="${g.w}" height="${g.h}" fill="url(#tvg)" stroke="#556" stroke-width="1.2"/>`);
        push(`<text x="${gx + g.w / 2}" y="${gy + g.h / 2 - 3 * f}" text-anchor="middle" font-size="${+(11 * f).toFixed(1)}" fill="#233">${esc(g.brand)}</text>`);
        push(`<text x="${gx + g.w / 2}" y="${gy + g.h / 2 + 13 * f}" text-anchor="middle" font-size="${+(12 * f).toFixed(1)}" font-weight="600" fill="#233">${esc(g.sizeText)}</text>`);
      } else if (g.kind === "speakers") {
        // the glyphs are drawn at 1× and scaled with their group (TVs + speakers 25% bigger)
        const sg = speakerGlyphs(ix.endpointsById[g.epId], gx, gy, g.w / gls);
        push(gls === 1 ? sg : `<g transform="translate(${gx} ${gy}) scale(${gls}) translate(${-gx} ${-gy})">${sg}</g>`);
      }
      for (const l of g.locals || (g.local ? [g.local] : [])) {
        const ldev = s.locals[l.deviceId] || {};
        push(`<rect x="${z.x + l.x}" y="${z.y + l.y}" width="${l.w}" height="${l.h}" rx="8" fill="#1e1e1e"/>`);
        push(faceGlyph(ldev, z.x + l.x + l.w - 15, z.y + l.y + l.h / 2) ||
             `<circle cx="${z.x + l.x + l.w - 11}" cy="${z.y + l.y + l.h / 2}" r="2.4" fill="#cfcfcf"/>`);
        push(`<text x="${z.x + l.x + l.w / 2}" y="${z.y + l.y + l.h / 2 + 3}" text-anchor="middle" font-size="8.5" fill="#bbb">${esc(l.label || l.deviceId)}</text>`);
      }
      if (g.caption) push(`<text x="${z.x + g.cx}" y="${z.y + g.captionY}" text-anchor="middle" font-size="11.5" fill="#333">${esc(g.caption)}</text>`);
    }
    push(`</g>`);
  }

  /* annotations render as keynotes: circled number on the zone card (top-left
     corner), full sentence in the legend's NOTES block */
  const keynote = n => n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `(${n})`;
  const markersOn = {};
  for (const a of P.legend.notes || []) {
    const z = P.zones.find(z => z.id === a.near);
    if (!z) continue;
    const k = markersOn[z.id] = (markersOn[z.id] || 0) + 1;    // two notes on one card sit side by side
    push(`<text x="${z.x + 9 + (k - 1) * 13}" y="${z.y + 17}" font-size="11" font-weight="700" fill="${bw ? "#333" : "#b32017"}">${keynote(a.n)}</text>`);
  }

  /* harness underlay: bundled feeds share their root's trunk as one heavier
     run, then break out thin toward their own destinations (electrical-drawing
     convention). The count rides the root segment carrying the most wires. */
  const busTicks = [], wireTags = [];
  const colorOf = w => {
    const key = w.scope !== "included" ? "prewire" : w.dante ? "dante" : (w.signal === "speaker" ? "audio" : w.signal);
    const gs = bw ? (SIGNAL_DASHES[key] || SIGNAL_DASHES.video) : null;
    return gs ? gs.stroke : SIGNAL_COLORS[key] || "#555";
  };
  const members = rt.wires.filter(w => w.bundleOf && w.trunkLen > 1);
  if (members.length) {
    push(`<g class="harness" fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.32">`);
    const roots = new Map();
    for (const m of members) {
      push(`<path d="${m.pts.slice(0, m.trunkLen).map((q, k) => `${k ? "L" : "M"}${q[0]} ${q[1]}`).join("")}" stroke="${colorOf(m)}"/>`);
      (roots.get(m.bundleOf) ?? roots.set(m.bundleOf, []).get(m.bundleOf)).push(m);
    }
    push(`</g>`);
    for (const [rid, ms] of roots) {
      const R = rt.wires.find(w => w.id === rid && !w.bundleOf);
      if (!R) continue;
      const pairs = m => new Set(m.pts.slice(0, m.trunkLen).map((q, k, a) => k ? `${a[k - 1]}|${q}` : null).filter(Boolean));
      const trunks = ms.map(pairs);
      let best = null;
      for (let j = 1; j < R.pts.length; j++) {
        const key = `${R.pts[j - 1]}|${R.pts[j]}`;
        const n = 1 + trunks.filter(t => t.has(key)).length;
        const len = Math.abs(R.pts[j][0] - R.pts[j - 1][0]) + Math.abs(R.pts[j][1] - R.pts[j - 1][1]);
        if (n > 1 && (!best || n > best.n || (n === best.n && len > best.len))) best = { j, n, len };
      }
      if (best) {
        const [x1, y1] = R.pts[best.j - 1], [x2, y2] = R.pts[best.j];
        busTicks.push({ mx: (x1 + x2) / 2, my: (y1 + y2) / 2, vert: x1 === x2, n: best.n, color: colorOf(R) });
      }
    }
  }

  /* wires (under chips so badges sit inline on their runs) */
  const TRK = trunkMode(job, opts), trunkWires = [], mergedTags = {};
  push(`<g fill="none" stroke-width="2.2" stroke-linecap="round">`);
  for (const w of rt.wires) {
    const key = w.scope !== "included" ? "prewire" : w.dante ? "dante" : (w.signal === "speaker" ? "audio" : w.signal);
    const gs = bw ? (SIGNAL_DASHES[key] || SIGNAL_DASHES.video) : null;
    const color = gs ? gs.stroke : SIGNAL_COLORS[key] || "#555";
    const dash = gs?.dash || (key === "dante" ? "6 4" : null);
    // one-line bus notation: a line drawn once carries its real run count
    const conn = (sol.connections || []).find(c => c.from === w.from && c.to === w.to && c.signal === w.signal);
    const n = conn ? trunkCount(conn, s) : 1;
    const onTrunk = TRK && w.cls === "trunk";
    if (onTrunk) trunkWires.push({ w, color, dash, runs: n });   // drawn as trunks below (they count the runs)
    else push(`<path class="wire${w.dante ? " dante" : ""}" data-wire="${esc(w.id)}" data-from="${esc(w.from)}" data-to="${esc(w.to)}" data-signal="${esc(w.signal)}" d="${wireD(w)}" stroke="${color}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`);
    if (n > 1 && !onTrunk) {
      let bi = 1, bl = -1;
      for (let i = 1; i < w.pts.length; i++) {
        const L = Math.abs(w.pts[i][0] - w.pts[i - 1][0]) + Math.abs(w.pts[i][1] - w.pts[i - 1][1]);
        if (L > bl) { bl = L; bi = i; }
      }
      const [x1, y1] = w.pts[bi - 1], [x2, y2] = w.pts[bi];
      busTicks.push({ mx: (x1 + x2) / 2, my: (y1 + y2) / 2, vert: x1 === x2, n, color });
    }
    // what the run IS when no adapter box says it: a Bullet Train (sized) or the eARC kit
    const tag = conn?.run === "bullet" && ix.endpointsById[conn.to]
      ? (() => { const b = bulletFor(ix.zonesById[ix.endpointZone[conn.to]]); return b.m ? `BULLET ${b.m}m` : "BULLET ?"; })()
      : conn?.earcKit ? "eARC KIT" : null;
    // a trunk wire that also carries a schedule number wears ONE label: "V-01 · BULLET 20m"
    if (tag && TRK && w.cls === "trunk" && opts.wireLabels?.[w.id]) mergedTags[w.id] = tag;
    else if (tag && w.pts.length > 1) {
      // on the first run of real length, walking in from the TV end
      const pts = conn.earcKit ? w.pts : [...w.pts].reverse();
      let k = 1;
      while (k < pts.length - 1 && Math.abs(pts[k][0] - pts[k - 1][0]) + Math.abs(pts[k][1] - pts[k - 1][1]) < 44) k++;
      const [x1, y1] = pts[k - 1], [x2, y2] = pts[k];
      wireTags.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, vert: x1 === x2, text: tag, color });
    }
  }
  push(`</g>`);
  if (trunkWires.length) push(drawTrunks(trunkWires, TRK, opts.wireLabels || {}, mergedTags, rt.wires.filter(w => !(TRK && w.cls === "trunk")),
    [...P.zones, ...P.chips, ...P.racks.flatMap(r => r.devices)]));
  // rack titles again, over the wiring with a white halo: a riser climbing out of the rack top can't cut them
  for (const r of P.racks) push(`<text class="racklabel" data-rack="${esc(r.id)}" x="${r.x + 14}" y="${r.y + 24}" font-size="20" font-weight="700" fill="#111" paint-order="stroke" stroke="#fff" stroke-width="5" stroke-linejoin="round">${esc(r.name)}</text>`);
  if (rt.danteTags?.length) push(drawDanteTags(job, ix, sol, s, P, rt.danteTags, bw));
  // a tag reads beside its run — on whichever side no other wire runs alongside
  const segsAll = rt.wires.flatMap(w => w.pts.slice(1).map((q, i) => [w.pts[i], q]));
  const clear = (x0, x1, y0, y1) => !segsAll.some(([[ax, ay], [bx, by]]) =>
    Math.max(ax, bx) >= x0 && Math.min(ax, bx) <= x1 && Math.max(ay, by) >= y0 && Math.min(ay, by) <= y1);
  for (const t of wireTags) {
    const tw = t.text.length * 5.6 + 4;
    let ax, ay, anchor = "";
    if (t.vert) {
      const right = clear(t.x + 3, t.x + 6 + tw, t.y - 6, t.y + 6);
      const left = !right && clear(t.x - 6 - tw, t.x - 3, t.y - 6, t.y + 6);
      [ax, ay] = [left ? t.x - 6 : t.x + 6, t.y + 3.5]; if (left) anchor = ' text-anchor="end"';
    } else {
      const below = !clear(t.x - tw / 2, t.x + tw / 2, t.y - 14, t.y - 3) && clear(t.x - tw / 2, t.x + tw / 2, t.y + 3, t.y + 14);
      [ax, ay] = [t.x, below ? t.y + 12 : t.y - 5]; anchor = ' text-anchor="middle"';
    }
    push(`<text class="wiretag" x="${ax}" y="${ay}"${anchor} font-size="9" font-weight="700" letter-spacing=".4" fill="${t.color}" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(t.text)}</text>`);
  }
  for (const b of busTicks) {
    push(`<line x1="${b.mx - 4}" y1="${b.my + (b.vert ? -4 : 5)}" x2="${b.mx + 4}" y2="${b.my + (b.vert ? 4 : -5)}" stroke="${b.color}" stroke-width="1.6"/>`);
    push(`<text class="bustick" x="${b.mx + (b.vert ? 9 : 0)}" y="${b.my + (b.vert ? 4 : -9)}"${b.vert ? "" : ' text-anchor="middle"'} font-size="10.5" font-weight="600" fill="${b.color}" paint-order="stroke" stroke="#fff" stroke-width="3">×${b.n}</text>`);
  }

  /* companion chips */
  for (const c of P.chips) {   // a tap on a chip opens what it serves (the app's click-to-edit)
    push(`<g class="chiptile" data-chip="${esc(c.id)}"><rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="2" fill="#1e1e1e"/>`);
    push(`<text x="${c.x + c.w / 2}" y="${c.y + 13}" text-anchor="middle" font-size="10" fill="#eee">${esc(adapterTag(c))}</text>`);
    push(`<circle cx="${c.x + c.w - 6}" cy="${c.y + c.h / 2}" r="1.8" fill="#3fbf5a"/></g>`);
  }

  /* invisible fat twins over every wire: 12px tap targets for click-to-trace
     (transparent stroke, so print/export are untouched) */
  push(`<g fill="none" stroke="transparent" stroke-width="12">`);
  for (const w of rt.wires)
    push(`<path class="wirehit" data-wire="${esc(w.id)}" data-from="${esc(w.from)}" data-to="${esc(w.to)}" data-signal="${esc(w.signal)}" d="${wireD(w)}" pointer-events="stroke"/>`);
  push(`</g>`);
  // as-built revision clouds + numbered deltas (asbuilt.js changeMarks, drawn by the
  // caller from this sheet's own placement + routes): drawing-space coordinates, on top
  if (opts.marks) push(opts.marks);
  push(`</g>`); // end drawing space

  /* dynamic legend */
  const lg = P.legend;
  push(`<rect x="${lg.x}" y="${lg.y}" width="${lg.w}" height="${lg.h}" fill="#fff" stroke="#777"/>`);
  push(`<text x="${lg.x + 12}" y="${lg.y + 16}" font-size="10" font-weight="700" fill="#555" letter-spacing="1">LEGEND</text>`);
  lg.rows.forEach((k, i) => {
    const x = lg.x + 12 + i * 140;
    if (k === "danteTag") {
      push(`<text x="${x}" y="${lg.y + 40}" font-size="9" font-weight="700" letter-spacing=".4" fill="${bw ? "#333" : SIGNAL_COLORS.dante}">DANTE ←</text>`);
      push(`<text x="${x + 50}" y="${lg.y + 40}" font-size="11.5" fill="#333">Dante (labels)</text>`);
      return;
    }
    const st = bw ? SIGNAL_DASHES[k] : null;
    const ld = st?.dash || (k === "dante" ? "6 4" : null);
    push(`<path d="M${x} ${lg.y + 36}H${x + 32}" stroke="${st ? st.stroke : SIGNAL_COLORS[k]}" stroke-width="3" fill="none"${ld ? ` stroke-dasharray="${ld}"` : ""}/>`);
    push(`<text x="${x + 38}" y="${lg.y + 40}" font-size="11.5" fill="#333">${LEGEND_LABELS[k] || k}</text>`);
  });
  // equipment key: a small box per kind, tinted and edged like the rack tiles
  (lg.kinds || []).forEach((k, i) => {
    const x = lg.x + 12 + i * PL.legendEqW, y = lg.y + PL.legendH - 6;
    push(`<rect x="${x}" y="${y}" width="26" height="14" rx="2" fill="${!bw || k === "power" ? KIND_STYLE[k].tint : "#262626"}"/>`);
    push(kindEdge(k, x, y, 14, 2, bw));
    push(`<text x="${x + 32}" y="${y + 11}" font-size="11.5" fill="#333">${esc(KIND_STYLE[k].label)}</text>`);
  });
  const ny = lg.y + PL.legendH + (lg.eqH || 0);   // the NOTES block sits under the equipment key
  if (lg.notes?.length) {
    // NOTES block: red caveats stay red (dark in grayscale), numbered to match
    // the circled markers on their zone cards
    push(`<line x1="${lg.x}" y1="${ny - 4}" x2="${lg.x + lg.w}" y2="${ny - 4}" stroke="#bbb" stroke-width="0.7"/>`);
    push(`<text x="${lg.x + 12}" y="${ny + 10}" font-size="9" font-weight="700" fill="#555" letter-spacing="1">NOTES</text>`);
    lg.notes.forEach((a, i) => {
      push(`<text x="${lg.x + 54}" y="${ny + 10 + i * 15}" font-size="10" fill="${bw ? "#333" : "#b32017"}">${keynote(a.n)}  ${esc(a.text)}</text>`);
    });
  }

  /* title block (vertical right edge, per the approved mock) */
  const tb = { x: SHEET.titleBlock.x, y: SHEET.titleBlock.y, w: 156, h: SHEET.titleBlock.h };
  const J = job.job || {};
  const [addr1, ...addrRest] = String(J.client?.address || "").split(",");
  const stage = (J.stage || "proposal").toLowerCase();
  const stageTxt = stage === "asbuilt" || stage === "as-built" ? "AS-BUILT" : "PROPOSAL";
  const stageCol = stageTxt === "AS-BUILT" ? "#2f7a3a" : "#b32017";
  const revs = (J.revisions || []).slice(-4);
  const lastDate = revs.length ? revs[revs.length - 1].date : J.catalogSnapshot?.asOf;
  const cx = tb.x + tb.w / 2;
  push(`<rect x="${tb.x}" y="${tb.y}" width="${tb.w}" height="${tb.h}" fill="#fff" stroke="#444" stroke-width="1.2"/>`);
  push(`<line x1="${tb.x}" y1="300" x2="${tb.x + tb.w}" y2="300" stroke="#444"/>`);
  // logo mark removed for now (text-only wordmark until the authentic logo file lands)
  const co = { name: "SYNERGY", tagline: "AUDIO VIDEO SYSTEMS",
    info: "300 El Camino Real · Tustin, CA 92780 · P: 714-505-2003 · www.synergy.tv", ...(opts.company || {}) };
  push(`<text transform="rotate(-90 ${tb.x + 56} 160)" x="${tb.x + 56}" y="160" text-anchor="middle" font-size="26" font-weight="700" letter-spacing="7" fill="#111">${esc(co.name)}</text>`);
  push(`<text transform="rotate(-90 ${tb.x + 88} 160)" x="${tb.x + 88}" y="160" text-anchor="middle" font-size="9" letter-spacing="2.6" fill="#444">${esc(co.tagline)}</text>`);
  push(`<text transform="rotate(-90 ${tb.x + 118} 160)" x="${tb.x + 118}" y="160" text-anchor="middle" font-size="7.5" fill="#666">${esc(co.info)}</text>`);
  push(`<line x1="${tb.x}" y1="470" x2="${tb.x + tb.w}" y2="470" stroke="#444"/>`);
  push(`<text transform="rotate(-90 ${tb.x + 52} 385)" x="${tb.x + 52}" y="385" text-anchor="middle" font-size="14" font-weight="700" fill="#111">${esc(J.client?.name || "")}</text>`);
  push(`<text transform="rotate(-90 ${tb.x + 76} 385)" x="${tb.x + 76}" y="385" text-anchor="middle" font-size="11" fill="#333">${esc(addr1.trim())}</text>`);
  push(`<text transform="rotate(-90 ${tb.x + 96} 385)" x="${tb.x + 96}" y="385" text-anchor="middle" font-size="11" fill="#333">${esc(addrRest.join(",").trim())}</text>`);
  push(`<text x="${tb.x + 8}" y="486" font-size="8" fill="#777">Project</text>`);
  push(`<text x="${tb.x + 8}" y="500" font-size="11" fill="#111">${esc(J.name || "")}</text>`);
  push(`<line x1="${tb.x}" y1="510" x2="${tb.x + tb.w}" y2="510" stroke="#999" stroke-width="0.7"/>`);
  push(`<text x="${tb.x + 8}" y="524" font-size="8" fill="#777">Drawing</text>`);
  push(`<text x="${tb.x + 8}" y="538" font-size="11" fill="#111">AV Schematic — ${esc(sol.name || "")}${J.sheetLabel ? ` · ${esc(J.sheetLabel)}` : ""}</text>`);
  push(`<line x1="${tb.x}" y1="548" x2="${tb.x + tb.w}" y2="548" stroke="#444"/>`);
  push(`<rect x="${tb.x + 18}" y="558" width="120" height="24" fill="none" stroke="${stageCol}" stroke-width="1.6"/>`);
  push(`<text x="${cx}" y="575" text-anchor="middle" font-size="13" font-weight="700" letter-spacing="2" fill="${stageCol}">${stageTxt}</text>`);
  push(`<line x1="${tb.x}" y1="592" x2="${tb.x + tb.w}" y2="592" stroke="#444"/>`);
  push(`<text x="${cx}" y="606" text-anchor="middle" font-size="9" font-weight="700" letter-spacing="1" fill="#333">REVISIONS</text>`);
  push(`<g stroke="#999" stroke-width="0.7">`);
  for (let i = 0; i <= 4; i++) push(`<line x1="${tb.x}" y1="${612 + i * 22}" x2="${tb.x + tb.w}" y2="${612 + i * 22}"/>`);
  push(`<line x1="${tb.x + 18}" y1="612" x2="${tb.x + 18}" y2="700"/><line x1="${tb.x + 76}" y1="612" x2="${tb.x + 76}" y2="700"/><line x1="${tb.x + 136}" y1="612" x2="${tb.x + 136}" y2="700"/></g>`);
  revs.forEach((rv, i) => {
    const y = 626 + i * 22;
    push(`<g font-size="8.5" fill="#333"><text x="${tb.x + 9}" y="${y}" text-anchor="middle">${esc(rv.rev)}</text><text x="${tb.x + 47}" y="${y}" text-anchor="middle">${fmtDate(rv.date)}</text><text x="${tb.x + 106}" y="${y}" text-anchor="middle">${esc(String(rv.description || "").slice(0, 16))}</text><text x="${tb.x + 146}" y="${y}" text-anchor="middle">${esc(rv.by || "")}</text></g>`);
  });
  const fields = [["Date", fmtDate(lastDate)], ["Scale", "None"], ["Drawn by", esc(J.drawnBy || "SignalPath")], ["Sheet", opts.sheet || "1 of 3"]];
  let fy = 712;
  push(`<line x1="${tb.x}" y1="${fy}" x2="${tb.x + tb.w}" y2="${fy}" stroke="#444"/>`);
  for (const [label, val] of fields) {
    push(`<text x="${tb.x + 8}" y="${fy + 16}" font-size="8" fill="#777">${label}</text>`);
    push(`<text x="${cx}" y="${fy + 36}" text-anchor="middle" font-size="13" fill="#111">${val}</text>`);
    fy += 48;
    push(`<line x1="${tb.x}" y1="${fy}" x2="${tb.x + tb.w}" y2="${fy}" stroke="#444"/>`);
  }
  push(`<text transform="rotate(-90 ${cx} 972)" x="${cx}" y="972" text-anchor="middle" font-size="7" fill="#999">Design intent only — not engineering / construction documentation</text>`);
  push(`</svg>`);
  return out.join("\n");
}

/* icon layouts per speaker config (positions relative to the group rect) */
/* small-tile faceplate cue, centered at (cx, cy) — one quiet glyph per source
   type so a rack of black boxes passes the squint test */
// a source's face: its stored sourceType, else read off its name (kit and library boxes
// carry a model, not a sourceType — an Apple TV from a kit still gets its badge)
function sourceFace(dev) {
  if (dev.sourceType) return dev.sourceType;
  if (dev.type !== "source") return null;
  const n = `${dev.model || ""} ${dev.catalogRef || ""}`;
  return /apple\s*-?tv/i.test(n) ? "appletv" : /kaleidescape|strato/i.test(n) ? "kaleidescape"
    : /cable|directv|dish|xfinity|tivo|u-?verse|satellite/i.test(n) ? "cable" : /turn\s*table|record player/i.test(n) ? "turntable"
    : /sonos|\bport\b|music|stream|sms\d|bluesound|heos|wiim|\bconnect\b/i.test(n) ? "streamer" : null;
}
function faceGlyph(dev, cx, cy) {
  switch (sourceFace(dev)) {
    case "appletv":
      return `<rect x="${cx - 8}" y="${cy - 5.5}" width="16" height="11" rx="3" fill="none" stroke="#fff" stroke-width="1"/>` +
             `<text x="${cx}" y="${cy + 3}" text-anchor="middle" font-size="7.5" font-weight="600" fill="#fff">tv</text>`;
    case "streamer":
      return `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="12" fill="#cfcfcf">♪</text>`;
    case "turntable":
      return `<circle cx="${cx - 2}" cy="${cy}" r="7.5" fill="#2d2d2d" stroke="#6a6a6a" stroke-width="1"/>` +
             `<circle cx="${cx - 2}" cy="${cy}" r="1.4" fill="#8f8f8f"/>` +
             `<line x1="${cx + 7}" y1="${cy - 7}" x2="${cx + 2.5}" y2="${cy - 0.5}" stroke="#8f8f8f" stroke-width="1.3"/>`;
    case "cable":
      return `<rect x="${cx - 9}" y="${cy - 5}" width="18" height="10" rx="1.5" fill="#08130a" stroke="#1e3320" stroke-width="0.8"/>` +
             `<text x="${cx}" y="${cy + 3}" text-anchor="middle" font-size="7" font-family="Menlo, monospace" fill="#3fbf5a">02</text>`;
    case "kaleidescape":
      return `<path d="M${cx - 4} ${cy - 5}L${cx + 5} ${cy}L${cx - 4} ${cy + 5}Z" fill="#cfcfcf"/>`;
  }
  if (dev.type === "avbSwitch")
    return [0, 1, 2, 3].map(i =>
      `<rect x="${cx - 12 + i * 6.5}" y="${cy - 2}" width="4" height="4" fill="none" stroke="#8f8f8f" stroke-width="0.9"/>`).join("");
  return "";
}

function speakerGlyphs(ep, gx, gy, gw) {
  const cfg = ep?.config || "stereo";
  const use = (id, x, y) => `<use href="#${id}" x="${gx + x}" y="${gy + y}"/>`;
  const row = (ids, y) => ids.map((id, i) => use(id, 16 + i * 34, y)).join("");
  if (cfg === "mono") return use("spk", 16, 16);
  if (cfg === "surround-5.1") return row(["spk", "spk", "spk"], 16) + row(["spk", "sub", "spk"], 54);
  if (cfg === "surround-7.1" || cfg === "surround-7.1.4")
    return row(["spk", "spk", "spk", "spk"], 16) + `<g transform="translate(17,0)">` + row(["spk", "sub", "spk"], 54) + `</g>`;   // row() already adds gx
  if (cfg === "2.1" || cfg === "stereo-2.1") return row(["spk", "sub", "spk"], 16);
  if (cfg.startsWith("soundbar")) {
    const barW = cfg === "soundbar-sub" ? gw - 38 : gw;
    let out2 = `<rect x="${gx}" y="${gy + 6}" width="${barW}" height="16" rx="8" fill="#2d2d2d" stroke="#151515"/>`;
    if (cfg === "soundbar-sub") out2 += use("sub", gw - 15, 16);
    return out2;
  }
  if (cfg === "landscape") {
    const sats = satCount(ep), subs = ep?.buriedSub ? 1 : 0;
    let out2 = "";
    for (let i = 0; i < sats; i++) out2 += use("spks", 10 + i * 26, 16);
    if (subs) out2 += use("sub", sats * 26 + 18, 16);
    return out2;
  }
  return row(Array(spkCount(ep)).fill("spk"), 16);
}

/* ---------- advise ----------
   Suggestions-only (spec: advisor never blocks). With a catalog, emits full
   licensing picks per platform and typed port-budget checks; without one it
   keeps the legacy Savant hint so old callers behave identically. */

export function advise(job, ix = indexJob(job), catalog = null) {
  const out = { amps: [], notes: [], licensing: [], io: [] };
  const zones = job.house.zones;
  const videoZones = zones.filter(z => (z.endpoints || []).some(e => e.type === "display")).length;
  const audioZones = zones.filter(z => (z.endpoints || []).some(e => e.type === "speakers")).length;
  const zc = zones.length;

  for (const s of ix.solutions) {
    const sol = s.sol;
    const byAmp = {};
    for (const c of sol.connections || []) {
      if (c.signal === "speaker" && s.devices[c.from]) (byAmp[c.from] ||= []).push(c);
    }
    for (const [ampId, feeds] of Object.entries(byAmp)) {
      const amp = s.devices[ampId];
      const reserved = feeds.filter(f => (f.scope || "included") !== "included").length;
      const zonesTotal = amp?.zones ?? catalog?.devices?.[amp?.catalogRef]?.zones ?? null;
      const zonesUsed = feeds.reduce((n, f) => n + feedZones(f), 0);
      out.amps.push({
        solution: sol.id, amp: ampId, model: amp?.model,
        zonesUsed, zonesTotal, reserved,
        spare: zonesTotal != null ? zonesTotal - zonesUsed : null,
      });
      // a 2.1 is two powered channels + the zone's sub out (line level) to a
      // powered sub (Ryan 2026-09-29: "like on a MDX-16") — say so when the amp
      // has fewer sub outs than 2.1 zones (only where the catalog lists them)
      const subOuts = catalog?.devices?.[amp?.catalogRef]?.outputs?.sub;
      const subs = feeds.filter(f => ix.endpointsById[f.to]?.config === "2.1").length;
      if (typeof subOuts === "number" && subs > subOuts)
        out.notes.push({ solution: sol.id, code: "amp-sub-outs", ref: ampId, level: "w",
          msg: `${amp?.model || ampId}: ${subs} 2.1 zones but ${subOuts ? `only ${subOuts} sub out${subOuts > 1 ? "s" : ""}` : "no sub outs"} — move a 2.1 to an amp with a free sub out, or give its sub a line-out feed` });
    }

    /* -- typed port budgets from catalog refs -- */
    if (catalog?.devices) {
      for (const d of Object.values(s.devices)) {
        const cat = catalog.devices[d.catalogRef];
        if (!cat) continue;
        const inbound = (sol.connections || []).filter(c => c.to === d.id);
        // audio edges weigh their real run count (a module→amp trunk = 1 run per zone fed)
        const audioIn = inbound.filter(c => c.signal === "audio").reduce((n, c) => n + trunkCount(c, s), 0);
        // an eARC extender kit's RX lands on an HDMI input like a source
        const videoIn = inbound.filter(c => c.signal === "video" || (c.signal === "audioReturn" && c.earcKit)).length;
        const audioCap = (cat.inputs?.analog || 0) + (cat.inputs?.coax || 0) + (cat.inputs?.optical || 0) + (cat.inputs?.digitalCombo || 0);
        const videoCap = cat.inputs?.hdmi || 0;
        if (audioCap && audioIn > audioCap)
          out.io.push({ solution: sol.id, device: d.id, kind: "audio-in", used: audioIn, capacity: audioCap, over: true,
            msg: `${d.model || d.id}: ${audioIn} audio feeds into ${audioCap} inputs (${cat.model}) — needs another input path` });
        else if (audioCap && audioIn) out.io.push({ solution: sol.id, device: d.id, kind: "audio-in", used: audioIn, capacity: audioCap, over: false });
        // analog trunk runs vs dedicated analog inputs — the "enough inputs to feed the amp" check
        const analogRuns = inbound.filter(c => c.signal === "audio" && s.devices[c.from]?.type === "audioOutputModule")
          .reduce((n, c) => n + trunkCount(c, s), 0);
        if (analogRuns && cat.inputs?.analog != null)
          out.io.push({ solution: sol.id, device: d.id, kind: "analog-in", used: analogRuns, capacity: cat.inputs.analog,
            over: analogRuns > cat.inputs.analog,
            msg: analogRuns > cat.inputs.analog
              ? `${d.model || d.id}: ${analogRuns} analog runs into ${cat.inputs.analog} analog inputs (${cat.model}) — over capacity`
              : `${d.model || d.id}: ${analogRuns}/${cat.inputs.analog} analog inputs fed · ${cat.inputs.analog - analogRuns} spare` });
        // audio returns land on DIGITAL inputs (optical/coax/eARC) — budget them
        // (catalog key "earc"; older user-edited catalogs may still say "eArc")
        const earc = cat.inputs?.earc ?? cat.inputs?.eArc ?? 0;
        const retIn = inbound.filter(c => c.signal === "audioReturn" && !c.earcKit).length;
        const retCap = (cat.inputs?.optical || 0) + (cat.inputs?.coax || 0) + (cat.inputs?.digitalCombo || 0) + earc;
        if (retIn && retCap)
          out.io.push({ solution: sol.id, device: d.id, kind: "return-in", used: retIn, capacity: retCap,
            over: retIn > retCap,
            msg: retIn > retCap
              ? `${d.model || d.id}: ${retIn} audio returns into ${retCap} digital inputs (${cat.model}) — over capacity`
              : `${d.model || d.id}: ${retIn}/${retCap} digital return inputs used` });
        // audio feeds and returns share the digital jacks — each budget can pass
        // alone while the two together need more cables than the box has jacks
        const jacks = (cat.inputs?.analog || 0) + (cat.inputs?.coax || 0) + (cat.inputs?.optical || 0) + (cat.inputs?.digitalCombo || 0) + earc;
        if (jacks && audioIn <= audioCap && retIn <= retCap && audioIn + retIn > jacks)
          out.io.push({ solution: sol.id, device: d.id, kind: "jack-total", used: audioIn + retIn, capacity: jacks, over: true,
            msg: `${d.model || d.id}: ${audioIn} audio feeds + ${retIn} returns need ${audioIn + retIn} jacks — only ${jacks} inputs (${cat.model})` });
        // module side of the trunk: outputs consumed = runs leaving
        const outRuns = (sol.connections || []).filter(c => c.from === d.id && c.signal === "audio")
          .reduce((n, c) => n + trunkCount(c, s), 0);
        const outRunCap = cat.outputs?.analog || 0;
        if (outRunCap && d.type === "audioOutputModule")
          out.io.push({ solution: sol.id, device: d.id, kind: "audio-out", used: outRuns, capacity: outRunCap,
            over: outRuns > outRunCap,
            msg: outRuns > outRunCap
              ? `${d.model || d.id}: ${outRuns} output runs of ${outRunCap} available (${cat.model}) — over capacity`
              : `${d.model || d.id}: ${outRuns}/${outRunCap} outputs used · ${outRunCap - outRuns} spare` });
        if (videoCap && videoIn > videoCap)
          out.io.push({ solution: sol.id, device: d.id, kind: "video-in", used: videoIn, capacity: videoCap, over: true,
            msg: `${d.model || d.id}: ${videoIn} HDMI feeds into ${videoCap} HDMI inputs (${cat.model})` });
        const outbound = (sol.connections || []).filter(c => c.from === d.id && c.signal === "video").length;
        const outCap = cat.outputs?.hdmi ?? d.io?.out ?? 0;
        if (outCap && d.type === "videoMatrix" && outbound > outCap)
          out.io.push({ solution: sol.id, device: d.id, kind: "video-out", used: outbound, capacity: outCap, over: true,
            msg: `${d.model || d.id}: ${outbound} video outputs of ${outCap} available` });
        // bitstream arrives from TVs (optical returns / TV audio) — an analog
        // trunk from an output module never carries Dolby, so it can't trigger this
        if (cat.flags?.includes("pcmOnlyDigital") && inbound.some(c => c.signal === "audioReturn" || (c.signal === "audio" && ix.endpointsById[c.from])))
          out.notes.push({ code: "pcm-only", solution: sol.id, msg: `${d.model || d.id}: digital inputs are PCM-only — bitstream sources need a 2ch downmix (AC-AVDM-V3 / AVDM-EV2)` });
        if (cat.flags?.includes("controlLanOnly"))
          out.notes.push({ code: "control-lan-only", solution: sol.id, msg: `${d.model || d.id}: LAN is control/DSP only — no Dante/audio-over-IP on this box` });
      }
      // current-gen AVB/IP audio gear rides the network — and Savant makes no AVB switch of its own
      // …said only while the job has no AVB switch picked from the catalog (one typed in by name may not be certified)
      const avbSwitchPicked = Object.values(s.devices).some(d => d.type === "avbSwitch" && catalog.devices[d.catalogRef]);
      if (sol.audioNetwork !== "dante" && !avbSwitchPicked && Object.values(s.devices).some(d => d.type !== "avbSwitch" && catalog.devices[d.catalogRef]?.flags?.includes("avb")))
        out.notes.push({ code: "avb-switch", solution: sol.id,
          msg: "AVB/IP audio gear on this job — requires an Avnu-certified AVB switch (MOTU AVB Switch for small systems, Savant ESN-AVB12E or a Netgear M4250 AV Line for bigger ones); an uncertified switch breaks AVB stream sync silently" });
      // controllers: MXNet needs its control box; a Dante system needs AVPro's Dante controller
      const flagsOf = d => catalog.devices[d.catalogRef]?.flags || [];
      const rackAndLocal = [...Object.values(s.devices), ...Object.values(s.locals)];
      const mxnet = rackAndLocal.some(d => flagsOf(d).includes("mxnet") && d.type !== "controlBox") ||
        Object.values(s.companions).some(c => (c.type === "enc" || c.type === "dec") && (sol.connections || []).some(k => (k.from === c.id || k.to === c.id) && s.devices[k.from === c.id ? k.to : k.from]?.type === "avSwitch"));
      // a CBOX runs ONE mode: an MXNet CBOX and a Dante-mode CBOX are two boxes
      const danteCtl = d => flagsOf(d).includes("danteController") || /dante/i.test(d.model || "");
      if (mxnet && !rackAndLocal.some(d => d.type === "controlBox" && !danteCtl(d) && (flagsOf(d).includes("mxnet") || /mxnet|cbox/i.test(d.model || ""))))
        out.notes.push({ code: "mxnet-no-cbox", solution: sol.id,
          msg: "MXNet on this job but no MXNet control box — add an AC-MXNET-CBOX-HA (it runs the system and is what Savant/Control4 talk to)" });
      const danteGear = rackAndLocal.filter(d => flagsOf(d).includes("dante"));
      const danteJob = sol.audioNetwork === "dante" || danteGear.some(d => d.type === "danteBridge");
      if (danteJob && !rackAndLocal.some(d => d.type === "controlBox" && danteCtl(d)))
        out.notes.push({ code: "dante-no-controller", solution: sol.id,
          msg: mxnet
            ? "Dante system with no Dante controller — add a second CBOX-HA in Dante mode (a CBOX runs MXNet OR Dante, not both); it's what lets Savant/Control4 re-route Dante"
            : "Dante system with no Dante controller — add an AC-MXNET-CBOX-HA in Dante mode; it's what lets Savant/Control4 re-route Dante" });
      // a CBOX-HA runs ONE mode (1G / USP / 10G / Dante): one per MXNet platform on the job
      const gens = new Set(rackAndLocal.map(d => catalog.devices[d.catalogRef]?.gen).filter(Boolean).map(g => g.startsWith("1g") ? "1G" : g === "10g" ? "10G" : g.toUpperCase()));
      const mxCtl = rackAndLocal.filter(d => d.type === "controlBox" && !danteCtl(d) && (flagsOf(d).includes("mxnet") || /mxnet|cbox/i.test(d.model || ""))).length;
      if (gens.size > 1 && mxCtl < gens.size)
        out.notes.push({ code: "mxnet-cbox-per-platform", solution: sol.id,
          msg: `MXNet ${[...gens].join(" + ")} on one job — a CBOX-HA runs one platform at a time: needs ${gens.size} CBOX-HAs (has ${mxCtl})${danteJob ? ", plus the Dante-mode one" : ""}. 1G and 10G endpoints never route to each other.` });
      // Dante-enabled MXNet endpoints: what they carry, and where their Dante travels
      const ddec = Object.values(s.companions).filter(c => c.type === "dec" && c.dante);
      if (ddec.length) {
        out.notes.push({ code: "dante-dv2-audio", solution: sol.id,
          msg: `Dante decoders (DANTE-DV2) at ${ddec.length} TV${ddec.length > 1 ? "s" : ""}: they put the MXNet SOURCE's audio on Dante (audio follows video) — not the TV's own apps; add an AXIS2 where the client streams on the TV. They need DANTE-EV2 encoders on the sources.` });
        out.notes.push({ code: "dante-vlan99", solution: sol.id,
          msg: "Dante on the MXNet endpoints rides the video cable as VLAN 99 (MXNet on VLAN 100): trunk those switch ports and carry VLAN 99 over to the Dante switch" });
      }
      // TV-audio encoders
      if (Object.values(s.companions).some(c => c.type === "axis") || rackAndLocal.some(d => flagsOf(d).includes("pcmOnly2ch")))
        out.notes.push({ code: "axis2-pcm", solution: sol.id, msg: "AXIS2 at a TV: set that TV's audio output to stereo PCM — the AXIS2 doesn't decode Dolby/DTS (manual: bitstream = 'loud noises')" });
      // small Dante transmitters (AXIS2 / Ultimo encoders) reach 2 receivers by unicast
      for (const id of [...Object.values(s.companions).filter(c => c.type === "axis").map(c => c.id),
                        ...rackAndLocal.filter(d => flagsOf(d).includes("ultimo") || flagsOf(d).includes("pcmOnly2ch")).map(d => d.id)]) {
        const subs = new Set((sol.connections || []).filter(c => c.from === id && c.dante).map(c => c.to)).size;
        if (subs > 2) out.notes.push({ code: "dante-multicast", solution: sol.id, ref: id,
          msg: `${describeNode(job, sol, id).short} feeds ${subs} Dante receivers — set it to multicast (unicast reaches 2)` });
      }
      // one audio network per job: Dante OR Savant AVB (the control platform is separate)
      const avbOnly = rackAndLocal.filter(d => flagsOf(d).includes("avb") && ["audioInputModule", "audioOutputModule", "avbSwitch"].includes(d.type));
      const danteOnly = rackAndLocal.filter(d => d.type === "danteBridge");
      const names = list => list.map(d => d.model || d.id).join(", ");
      if (sol.audioNetwork === "dante" && avbOnly.length)
        out.notes.push({ code: "net-mismatch", solution: sol.id, msg: `AVB gear on a Dante job: ${names(avbOnly)} — swap for Dante encoders/decoders, or set the job's audio network to Savant AVB` });
      else if (sol.audioNetwork === "avb" && danteOnly.length)
        out.notes.push({ code: "net-mismatch", solution: sol.id, msg: `Dante gear on a Savant AVB job: ${names(danteOnly)} — one audio network per job` });
      else if (!sol.audioNetwork && avbOnly.length && danteOnly.length)
        out.notes.push({ code: "net-mixed", solution: sol.id, msg: `Both Dante (${names(danteOnly)}) and AVB (${names(avbOnly)}) gear — pick one audio network for the job (Paperwork → Audio network)` });
      // Dante on its own switch, set up for Dante (AVPro guidance; MXNet E-series ship this way)
      if (danteJob)
        out.notes.push({ code: "dante-switch", solution: sol.id,
          msg: "Dante switch (dedicated): Energy-Efficient Ethernet OFF · IGMP snooping on with a querier · QoS for Dante (clock CS7, audio EF) · clock leader = an always-on rack amp, never a TV encoder" });
      // Sonos distributes over the LAN — every player wants a wired drop where possible
      const allSolDevs = [...Object.values(s.devices), ...Object.values(s.locals)];
      if (allSolDevs.some(d => catalog.devices[d.catalogRef]?.flags?.includes("sonos")))
        out.notes.push({ code: "sonos-net", solution: sol.id,
          msg: "Sonos on the job — audio distributes over the LAN; hardwire every Sonos device where possible (Cat6 drop per device)" });
      // TV audio into a Sonos line-in (Port/Connect) buffers ≥75ms once grouped —
      // an installer-tuned delay, not a plug-and-play eARC replacement
      const sonosLineIn = id => { const c2 = catalog.devices[(s.locals[id] || s.devices[id])?.catalogRef];
        return c2?.flags?.includes("sonos") && c2.type === "source"; };
      if ((sol.connections || []).some(c => ix.endpointsById[c.from] && sonosLineIn(c.to)))
        out.notes.push({ code: "sonos-lipsync", solution: sol.id,
          msg: "TV audio encoded via Sonos line-in buffers ≥75ms when grouped — set Group Audio Delay per room (fw 10.6.2+); expect tuning, not plug-and-play" });
    }

    /* -- a surround room whose TV bypasses its receiver: the TV fed straight from the
       matrix, nothing bringing its sound back — the TV's own apps (and antenna) never
       reach the surround speakers (walkthrough 2026-09-30) -- */
    for (const z of job.house.zones || []) {
      if ((z.scope || "included") !== "included") continue;
      const tv = (z.endpoints || []).find(e => e.type === "display"), spk = (z.endpoints || []).find(e => e.type === "speakers");
      if (!tv || !/^surround/.test(spk?.config || "")) continue;
      if (tv.displayType === "projector") continue;           // a projector has no apps of its own — nothing to bring back
      const drive = (sol.connections || []).find(c => c.to === spk.id && c.signal === "speaker");
      const rcv = drive && s.devices[drive.from]?.type === "avr" ? drive.from : null;
      if (!rcv) continue;
      const vin = (sol.connections || []).find(c => c.signal === "video" && (c.to === tv.id || s.companions[c.to]?.serves === tv.id));
      const vsrc = vin && s.companions[vin.from] ? (sol.connections || []).find(c => c.to === vin.from && c.signal === "video")?.from : vin?.from;
      if (vsrc === rcv) continue;
      if ((sol.connections || []).some(c => c.from === tv.id && c.signal === "audioReturn" && c.to === rcv)) continue;
      out.notes.push({ code: "tv-apps-no-surround", solution: sol.id, ref: tv.id,
        msg: `${z.name}: the TV's own apps won't play on the ${SPEAKER_SETUP_SHORT(spk.config)} speakers — the TV is fed from ${describeNode(job, sol, vsrc || "?").short} and nothing brings its sound back to ${describeNode(job, sol, rcv).short}; feed the TV through the receiver, or add TV audio back (eARC kit or optical)` });
    }

    /* -- an audio input module with nothing plugged in: it's how the video sources' sound
       (the matrix's audio outs) reaches the audio-only rooms -- */
    for (const d of Object.values(s.devices)) {
      if (d.type !== "audioInputModule") continue;
      if ((sol.connections || []).some(c => c.to === d.id && c.signal !== "network")) continue;
      const mx = Object.values(s.devices).find(x => x.type === "videoMatrix");
      out.notes.push({ code: "input-module-idle", solution: sol.id, ref: d.id,
        msg: `${d.model || d.id}: nothing is plugged into it — it's how the TV sources reach the audio-only rooms${mx ? ` (the ${describeNode(job, sol, mx.id).short} audio outs into its inputs)` : ""}; connect them, or drop the module` });
    }

    /* -- eARC through an extender: HDBaseT / AV-over-IP gear often passes ARC at
       best, not eARC — say so unless the zone already has the optical backup -- */
    for (const c of sol.connections || []) {
      const comp = c.earc && c.signal === "video" ? s.companions[c.to] : null;
      if (!comp || !ix.endpointsById[comp.serves]) continue;
      if ((sol.connections || []).some(r => r.from === comp.serves && r.signal === "audioReturn")) continue;
      out.notes.push({ code: "earc-extender", solution: sol.id, ref: comp.serves,
        msg: comp.type === "balun"
          // the default balun (AVPro AC-EX70-444-KIT) carries no audio back at all
          ? `${describeNode(job, sol, comp.serves).short}: the HDBaseT balun (AVPro AC-EX70-444-KIT) doesn't carry ARC/eARC — for the TV's own apps to play through the receiver, set TV audio back to "eARC + optical backup" (an optical run)`
          : `${describeNode(job, sol, comp.serves).short}: eARC comes back through the ${adapterName(comp)} — confirm that model passes eARC (many only pass ARC), or add the optical backup` });
    }

    /* -- Bullet Train runs: sized by the room's distance; past 40 m there's no such
       cable, and past 10 m it carries ARC — an Atmos room with nothing else
       bringing the TV's sound back loses Atmos from the TV apps -- */
    for (const c of sol.connections || []) {
      if (c.signal !== "video" || c.run !== "bullet" || !ix.endpointsById[c.to]) continue;
      const z = ix.zonesById[ix.endpointZone[c.to]], b = bulletFor(z), tv = describeNode(job, sol, c.to).short;
      if (!b.m) out.notes.push({ code: "bullet-too-far", solution: sol.id, ref: c.to,
        msg: `${tv}: a Bullet Train tops out at 40 m and this run is ~${b.need} m — use the HDBaseT balun (70 m at 4K) or MXNet` });
      else if (c.earc && !b.earc && isAtmosRoom(z) && !(sol.connections || []).some(r => r.from === c.to && r.signal === "audioReturn"))
        out.notes.push({ code: "bullet-arc", solution: sol.id, ref: c.to,
          msg: `${tv}: a ${b.m} m Bullet Train carries ARC, not eARC (eARC only up to 10 m) — no Atmos from the TV apps; set TV audio back to "eARC extender kit"` });
    }

    /* -- run length vs what each run can do, only where the room's distance is known:
       copper HDMI ~10 m at 4K, the AVPro balun 70 m at 4K, Cat6 (MXNet / the eARC kit)
       100 m; a pulled Toslink past ~10 m is unreliable (reference — it's usually the backup) -- */
    for (const c of sol.connections || []) {
      const tvId = c.signal === "video" ? (ix.endpointsById[c.to] ? c.to : s.companions[c.to]?.serves) : c.signal === "audioReturn" ? c.from : null;
      if (!tvId || !ix.endpointsById[tvId] || !s.devices[c.signal === "video" ? c.from : c.to]) continue;
      if (c.signal === "video" && c.run === "bullet") continue;            // sized (and checked) above
      const z = ix.zonesById[ix.endpointZone[tvId]], m = knownRunM(z);
      if (m == null) continue;
      const comp = c.signal === "video" ? s.companions[c.to] : null;
      const kind = c.signal === "audioReturn" ? (c.earcKit ? "earcKit" : "optical") : comp ? comp.type : "direct";
      const lim = RUN_LIMIT_M[kind];
      if (!lim || m <= lim + 0.5) continue;
      const tv = describeNode(job, sol, tvId).short, how = z.runFt ? `${z.runFt} ft` : `${z.reach} (~${Math.round(m)} m)`;
      const fix = { direct: "use a Bullet Train (to 40 m) or the HDBaseT balun", balun: "the balun is rated 70 m at 4K (1080p to 100 m) — use MXNet, or a switch / repeater midway",
        dec: "Cat6 stops at 100 m — add a network switch midway or fiber", earcKit: "the eARC kit is rated 100 m on Cat6A — move the kit's RX closer or use MXNet audio",
        optical: "use the eARC extender kit (Cat6A, 100 m) instead of the optical run" }[kind];
      out.notes.push({ code: kind === "optical" ? "optical-long" : "run-too-long", solution: sol.id, ref: tvId,
        msg: `${tv}: ${{ direct: "direct HDMI", balun: "HDBaseT balun", dec: "MXNet Cat6", earcKit: "eARC kit", optical: "optical (Toslink) return" }[kind]} at ${how} is past its ~${lim} m reach — ${fix}` });
    }

    /* -- a surround room whose TV sound comes back on optical: optical tops out at
       Dolby Digital 5.1, so the TV apps' Atmos (DD+ / TrueHD) never reaches the
       receiver. The AVPro eARC extender kit carries it over one Cat6A (reference) -- */
    for (const r of sol.connections || []) {
      if (r.signal !== "audioReturn" || r.earcKit || s.devices[r.to]?.type !== "avr" || !ix.endpointsById[r.from]) continue;
      const z = ix.zonesById[ix.endpointZone[r.from]];
      if ((z?.scope || "included") !== "included") continue;
      if (!(z.endpoints || []).some(e => e.type === "speakers" && /^surround/.test(e.config || ""))) continue;
      out.notes.push({ code: "earc-kit-option", solution: sol.id, ref: r.from,
        msg: `${describeNode(job, sol, r.from).short}: its own apps come back on optical — Dolby Digital 5.1 at most, no Atmos. For Atmos from the TV apps, set TV audio back to "eARC extender kit" (AVPro AC-AEX-DEARC-KIT: one Cat6A in place of the optical, into a receiver HDMI input)` });
    }

    /* -- licensing advisor per platform -- */
    const platforms = sol.platforms || [];
    const aux = sol.auxCounts || {};
    const num = v => Math.max(0, +v || 0);   // imported counts may arrive as text ("4" + 3 = "43")
    const devEstimate = aux.devices != null ? num(aux.devices) : Math.round(zc * 3 + num(aux.cameras) + num(aux.controls));
    const voiceRooms = num(aux.voiceRooms);

    // a missing platform table (offline catalog fallback, old stored settings)
    // skips that platform's pick instead of throwing away the whole drawing
    if (catalog?.licensing) {
      if (platforms.includes("savant") && catalog.licensing.savant) {
        const L = catalog.licensing.savant;
        const pick = (L.hosts || []).find(h =>
          (h.maxZones == null || zc <= h.maxZones) &&
          (h.maxVideo == null || videoZones <= h.maxVideo) &&
          (h.maxAudio == null || audioZones <= h.maxAudio)) || (L.hosts || [])[(L.hosts || []).length - 1];
        const lines = [`${pick?.name} — runtime: ${pick?.runtime}`, L.essentials];
        const warns = [];
        if (pick?.maxIpAudio != null && audioZones > pick.maxIpAudio)
          warns.push(`${audioZones} audio zones exceeds the ${pick.maxIpAudio} IP-audio device ceiling`);
        out.licensing.push({ solution: sol.id, platform: "savant", pick: pick?.name, lines, warns, notes: L.notes || [] });
      }
      if (platforms.includes("josh") && catalog.licensing.josh) {
        const L = catalog.licensing.josh;
        const needMics = Math.max(voiceRooms, 0);
        const pick = (L.processors || []).find(p => devEstimate <= p.maxDevices && needMics <= (p.maxMics ?? 0)) ||
          (L.processors || [])[(L.processors || []).length - 1];
        const dual = pick && (devEstimate > pick.maxDevices || needMics > (pick.maxMics ?? 0));
        out.licensing.push({ solution: sol.id, platform: "josh", pick: dual ? `2× ${pick?.name}` : pick?.name,
          lines: [`~${devEstimate} devices · ${needMics} voice rooms → ${dual ? "dual " : ""}${pick?.name} (${pick?.plan})`],
          warns: dual ? ["over single-processor limits — dual Core / manufacturer review"] : [],
          notes: L.notes || [] });
      }
      if (platforms.includes("control4") && catalog.licensing.control4) {
        const L = catalog.licensing.control4;
        const pick = (L.controllers || []).find(c => devEstimate <= c.maxDevices && zc <= (c.rooms ?? 99)) ||
          (L.controllers || [])[(L.controllers || []).length - 1];
        const warns = [];
        if (pick && devEstimate > pick.maxDevices * 0.8) warns.push(`~${devEstimate} devices is within 20% of the ${pick.name} cap (${pick.maxDevices}) — consider the next tier`);
        out.licensing.push({ solution: sol.id, platform: "control4", pick: pick?.name,
          lines: [`~${devEstimate} devices / ${zc} rooms → ${pick?.name}`, L.connect], warns, notes: L.notes || [] });
      }
    } else if (platforms.includes("savant")) {
      // legacy catalog-less hint (kept for compatibility)
      if (zc > 16) out.notes.push({ code: "savant-host", solution: sol.id, msg: `${zc} zones exceeds Smart Host (16) — Pro Host class required` });
      else out.notes.push({ code: "savant-host", solution: sol.id, msg: `Smart Host OK (${zc}/16 zones) · Essentials subscription required` });
    }
  }
  /* -- switch ports: every box on a switch takes a port (the Network page prints the plan) -- */
  out.network = catalog?.devices ? networkPlan(job, ix, catalog) : [];
  for (const p of out.network) {
    if (p.over) out.notes.push({ code: "switch-ports-full", solution: p.solution, ref: p.switch, need: p.used,
      msg: `${p.model}: ${p.used} connections need ${p.used} ports — it has ${p.copper + p.sfp}; add a second switch or step up a size` });
    if (p.virtual) {
      const sug = suggestLanSwitch(catalog, p.used);
      out.notes.push({ code: "lan-no-switch", solution: p.solution, add: sug ? { type: "networkSwitch", ref: sug.ref } : null,
        msg: `No LAN switch on this job — ${p.used} Ethernet ports needed on the house network (every TV, the networked rack gear, the AV switch uplinks)${sug ? `; a ${sug.model} (${sug.ports} ports) covers it with spare` : ""}` });
    }
    // a switch the catalog doesn't know (an imported "Generic NetworkSwitch", a Savant driver profile) may well be PoE — ask, don't tell
    if (p.needsInjector) out.notes.push({ code: "switch-no-poe", solution: p.solution, ref: p.switch, ids: p.unpowered, unknown: !p.known,
      msg: p.known ? `${p.model} doesn't power PoE — ${p.needsInjector} PoE device${p.needsInjector > 1 ? "s" : ""} on it need${p.needsInjector > 1 ? "" : "s"} an injector or local power supply`
        : `${p.model} isn't in the catalog, so whether it powers PoE is unknown — ${p.needsInjector} PoE device${p.needsInjector > 1 ? "s" : ""} on it: pick the switch's model, or give ${p.needsInjector > 1 ? "them" : "it"} an injector or local power supply` });
  }
  /* -- rack space: the elevation's U count against the rack's size -- */
  out.racks = catalog?.devices ? rackPlans(job, ix, catalog) : [];
  for (const r of out.racks) {
    // locked to the space: it never grows — it's squeezed already, so what's left is a second rack beside it
    if (r.over && r.locked) out.notes.push({ code: "rack-full", solution: r.solution, ref: r.rack, rack: r.rack, tight: true, manual: r.manual, locked: true, bigger: null,
      msg: `${r.name}: ${r.over}U over in the ${r.size}U rack locked to the space${r.autoTight ? " — already squeezed (only the vents round amps kept)" : ""}; add a second rack beside it, or move gear` });
    else if (r.over && r.sizeMode === "auto") out.notes.push({ code: "rack-full", solution: r.solution, ref: r.rack, rack: r.rack, tight: r.tight, manual: r.manual, bigger: null,
      msg: `${r.name}: ${r.over}U over at the ${r.autoMax}U limit for one rack${r.manual ? " — arranged by hand, so it isn't split on its own" : ""}; a second rack beside it takes the receivers and amps` });
    else if (r.over) out.notes.push({ code: "rack-full", solution: r.solution, ref: r.rack, rack: r.rack, tight: r.tight, manual: r.manual,
      bigger: r.spaceFit ? (r.spaceFit.best && r.spaceFit.best.u > r.size ? r.spaceFit.best.part : null) : null,
      msg: `${r.name}: ${r.used}U of gear, shelves, vents and patch panels in a ${r.size}U rack — ${r.over}U over; ${r.spaceFit ? (r.spaceFit.best && r.spaceFit.best.u > r.size ? `a ${r.spaceFit.best.u}U rack still fits the space, ` : "it's the tallest that fits the space — ") : "a bigger rack, "}${r.tight ? "" : "squeeze the spacing, "}or move gear to a second rack` });
    if (r.autoTight && !r.over) out.notes.push({ code: "rack-squeezed", solution: r.solution, ref: r.rack, rack: r.rack,
      msg: `${r.name}: squeezed to fit the ${r.size}U rack locked to the space — only the vents round receivers and amps kept` });
    for (const t of r.tucks || []) out.notes.push({ code: "rack-tuck", solution: r.solution, rack: r.rack, msg: `${r.name}: ${t}` });
    // the space it has to go in (cabinet opening / door): the picked rack doesn't fit, or nothing does
    if (r.spaceFit && !r.spaceFit.ok && r.spaceFit.typed) out.notes.push({ code: "rack-space", solution: r.solution, ref: r.rack, rack: r.rack, best: r.spaceFit.best?.part || null,
      msg: `${r.name}: a ${r.size}U rack stands ${r.spaceFit.est.exact ? "" : "about "}${r.spaceFit.est.h}" ${r.casters ? "on casters" : "without casters"} — the space is ${r.space.h}" high${r.spaceFit.best ? `; the tallest that fits is the ${r.spaceFit.best.part} (${r.spaceFit.best.u}U)` : " — no Middle Atlantic or Strong floor rack fits it"}` });
    else if (r.spaceFit && !r.spaceFit.ok) out.notes.push({ code: "rack-space", solution: r.solution, ref: r.rack, rack: r.rack, best: r.spaceFit.best?.part || null,
      msg: `${r.name}: the ${r.model.part} (${r.casters ? `${r.model.hc}" tall on casters` : `${r.model.h}" tall without casters`}) doesn't fit the space (${[r.space.h && `${r.space.h}" high`, r.space.w && `${r.space.w}" wide`, r.space.d && `${r.space.d}" deep`].filter(Boolean).join(", ")})${r.spaceFit.best ? ` — the ${r.spaceFit.best.part} (${r.spaceFit.best.u}U) does` : " — no Middle Atlantic or Strong floor rack does"}` });
    if (r.belowMin) out.notes.push({ code: "rack-space", solution: r.solution, ref: r.rack, rack: r.rack,
      msg: `${r.name}: the space (${[r.space.w && `${r.space.w}" wide`, r.space.d && `${r.space.d}" deep`].filter(Boolean).join(", ")}) is under Synergy's minimum cabinet — at least 22" wide and 26" deep` });
    if (r.spaceFit && !r.spaceFit.count && r.spaceFit.ok) out.notes.push({ code: "rack-space", solution: r.solution, ref: r.rack, rack: r.rack,
      msg: `${r.name}: no Middle Atlantic or Strong floor rack fits the space — check the opening, or a wall-mount rack` });
    // gear deeper than the picked rack takes, or with no room behind it for cables
    if (r.depth?.over.length) out.notes.push({ code: "rack-depth", solution: r.solution, ref: r.rack, rack: r.rack,
      msg: `${r.name}: too deep for the ${r.model.part} (${r.depth.usable}" usable) — ${r.depth.over.map(x => `${x.label} ${x.d}"`).join(", ")}; pick a deeper rack` });
    else if (r.depth?.tight.length) out.notes.push({ code: "rack-depth", solution: r.solution, ref: r.rack, rack: r.rack,
      msg: `${r.name}: tight behind ${r.depth.tight.map(x => `${x.label} (${x.d}", ${x.left}" left)`).join(", ")} in the ${r.model.part} (${r.depth.usable}" usable) — leave about 3" for plugs and cables, or a deeper rack` });
    // arranged by hand on the rack page: a spacing rule the arrangement breaks (amp with no vent…)
    for (const w of r.spacing || []) out.notes.push({ code: "rack-spacing", solution: r.solution, rack: r.rack, msg: `${r.name}: ${w}` });
    if (r.unknown.length) out.notes.push({ code: "rack-unknown-u", solution: r.solution, ref: r.rack,
      msg: `${r.name}: rack height needs to be confirmed for ${r.unknown.join(", ")} — drawn as 1U on the elevation` });
  }

  /* -- rack outlets: every box needs one on the WattBox unless PoE powers it -- */
  out.power = catalog?.devices ? powerPlan(job, ix, catalog, out.network) : [];
  for (const p of out.power) {
    // a job with two racks says which one ("Pool House Rack power: …"); one rack reads as before
    const who = p.multi ? p.rackName : "Rack", R = { solution: p.solution, rack: p.rack };
    const pick = p.pick ? `${p.pick.qty > 1 ? `${p.pick.qty} × ` : ""}${p.pick.model} (${p.pick.outlets} outlets${p.pick.qty > 1 ? " each" : ""})` : "a WattBox";
    if (!p.units.length)
      out.notes.push({ code: "power-none", ...R, add: p.pick ? { type: "power", ref: p.pick.ref, qty: p.pick.qty } : null, msg: `${p.multi ? `${p.rackName}: ` : ""}${p.need} rack outlet${p.need === 1 ? "" : "s"} needed (${p.loads.length} boxes${p.poe.length ? `, ${p.poe.length} more on PoE` : ""}) — no power conditioner ${p.multi ? "in this rack" : "on the job"}; spec ${pick}` });
    else if (p.short)
      out.notes.push({ code: "power-short", ...R, add: p.pick ? { type: "power", ref: p.pick.ref, qty: p.pick.qty, swap: true } : null, msg: `${who} power: ${p.need} outlets needed, ${p.supply} on the power conditioner — ${p.short} short; step up to ${pick}` });
    else if (p.tight)
      out.notes.push({ code: "power-tight", ...R, msg: `${who} power: ${p.need} of ${p.supply} outlets used — under ${p.spare} spare for the ISP modem, router and add-ons` });
    if (p.cooling) out.notes.push({ code: "rack-heat", ...R,
      msg: p.cooling === "room"
        ? `${who} heat: ~${p.heatW} W (${p.btu.toLocaleString("en-US")} BTU/hr) at typical load — more than a closet sheds on its own; plan cooling for the room (HVAC supply + return, or a dedicated unit) plus rack fans`
        : `${who} heat: ~${p.heatW} W (${p.btu.toLocaleString("en-US")} BTU/hr) at typical load — plan active ventilation (a top-exhaust rack fan) and a vented door or closet` });
    if (p.typicalW > p.circuitW)
      out.notes.push({ code: "power-circuit", ...R,
        msg: `${who} power: ~${p.typicalW} W typical draw is over ${p.circuits > 1 ? `${p.circuits} × ${p.circuitA}A circuits'` : `the ${p.circuitA}A circuit's`} ${p.circuitW} W continuous — split the amps onto a second circuit + WattBox, or a WB-820 on a 20A circuit` });
    else if (p.maxW > p.circuitW)
      out.notes.push({ code: "power-peak", ...R,
        msg: `${who} power: ~${p.typicalW} W typical, up to ${p.maxW} W at full output — over ${p.circuits > 1 ? `${p.circuits} × ${p.circuitA}A circuits'` : `the ${p.circuitA}A circuit's`} ${p.circuitW} W continuous at peak; give the amps a dedicated 20A circuit` });
  }
  // source / TV audio settings (downres-the-source rule, audiochain.js)
  out.setup = ix.solutions.map((s, i) => ({ solution: s.sol.id, ...audioSetup(job, ix, catalog, i) }));
  for (const st of out.setup) for (const n of st.notes) out.notes.push({ ...n, solution: st.solution });
  // which jack each wire lands on (ports.js) — and the wires that have no free one
  out.ports = ix.solutions.map((s, i) => ({ solution: s.sol.id, map: assignPorts(job, ix, catalog, i) }));
  for (const { solution, map } of out.ports) map.forEach((m, i) => {
    const why = m.fromWhy || m.toWhy; if (!why) return;
    const c = ix.solutions.find(x => x.sol.id === solution).sol.connections[i];
    out.notes.push({ code: "no-port", solution, ref: m.fromWhy ? c.from : c.to, conn: i, msg: `${why} — ${describeNode(job, ix.solutions.find(x => x.sol.id === solution).sol, c.from).short} → ${describeNode(job, ix.solutions.find(x => x.sol.id === solution).sol, c.to).short} has no jack to land on (add a splitter / pick another box)` });
  });
  return out;
}

/* ---------- Auto racks: two side by side when one gets too tall (Ryan 2026-10-02) ----------
   A rack in Auto sizes itself to its gear (rack.js). Past the limit (job.job.autoRackMax, 42U) it
   becomes a two-wide: a second rack beside it (`autoOf` the first) takes the receivers and amps.
   When the gear shrinks back under the limit the second rack folds back in — unless either rack
   was arranged by hand on the rack page (then nothing moves on its own). Mutates `job`; returns
   what it did, in words, for a toast. Run after a change, before drawing. */
export function autoRacks(job, catalog) {
  const said = [];
  if (!catalog?.devices) return said;
  const HOTT = new Set(["avr", "amp"]);
  const limit = Math.min(60, Math.max(8, Math.floor(+job.job?.autoRackMax) || 42));
  const needOf = (j, si, rackId) => {
    try { const L = loadJob(structuredClone(j)); return rackPlans(L.job, L.ix, catalog).filter(p => p.solution === j.solutions[si].id).find(p => p.rack === rackId)?.need ?? 0; }
    catch { return 0; }
  };
  job.solutions.forEach((sol, si) => {
    for (const r of [...(sol.racks || [])]) {
      if (r.sizeMode !== "auto" || r.autoOf) continue;
      const partner = sol.racks.find(x => x.autoOf === r.id);
      const hand = x => x?.layout && Object.keys(x.layout).length > 0;
      if (hand(r) || hand(partner)) continue;
      if (partner) {
        // would it all fit one rack again?
        const trial = structuredClone(job), ts = trial.solutions[si], tr = ts.racks.find(x => x.id === r.id), tp = ts.racks.find(x => x.id === partner.id);
        tr.devices.push(...tp.devices); ts.racks = ts.racks.filter(x => x !== tp);
        if (needOf(trial, si, r.id) <= limit) {
          r.devices.push(...partner.devices); sol.racks = sol.racks.filter(x => x !== partner);
          said.push(`${r.name}: back to one rack — the gear fits ${limit}U again`); continue;
        }
        // still two-wide: receivers / amps added since go to the second rack too
        const late = r.devices.filter(d => HOTT.has(d.type));
        if (late.length) { r.devices = r.devices.filter(d => !late.includes(d)); partner.devices.push(...late); said.push(`${late.map(d => d.model || d.id).join(", ")} → ${partner.name}`); }
        continue;
      }
      if (needOf(job, si, r.id) <= limit) continue;
      const hot = r.devices.filter(d => HOTT.has(d.type));
      if (!hot.length) continue;                                    // nothing that moves would help — the note says it's over
      let id = `${r.id}-2`, n = 2; while (sol.racks.some(x => x.id === id)) id = `${r.id}-${++n}`;
      sol.racks.push({ id, name: `${r.name} 2`, devices: hot, beside: r.id, autoOf: r.id, sizeMode: "auto", ...(r.area ? { area: r.area } : {}), ...(r.casters === false ? { casters: false } : {}) });
      r.devices = r.devices.filter(d => !hot.includes(d));
      said.push(`${r.name} needs more than ${limit}U — a second rack beside it takes the receivers and amps`);
    }
  });
  return said;
}
