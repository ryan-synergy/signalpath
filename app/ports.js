/* ---------- ports.js — which jack each wire lands on ----------
   Every box has ports: a rear-panel label, a direction and a connector
   family (hdmi / hdbaset / analog / optical / coax / speaker / sub / dante).
   Audited gear carries its real list in the catalog (`ports`, from the
   2026-09-29 rear-panel audit); other catalog gear gets one made from its
   input/output counts; unlinked boxes get a plain one by type.
   assignPorts() lands each connection on a free, compatible port at both
   ends — a port the designer picked (conn.fromPort / conn.toPort) first,
   then the rest in order, with the preferences a tech would use: a
   receiver's eARC output for the TV it feeds, an amp zone's own speaker
   terminals for its channels, analog before digital into a PCM-only amp.
   A wire with no free compatible jack gets null and a reason ("Cable Box has
   one HDMI out, already used") — the picker grays it, the paper prints "—".
   Network (Cat6) wires are the switch-port plan's job (network.js).
   Pure: no DOM. */

import { describeNode } from "./names.js";
import { catalogFor } from "./network.js";   // an unlinked "Apple TV" still sizes (and jacks) as one

// connector families a signal can leave / land on
const FAMILIES = {
  video: ["hdmi", "hdbaset"],
  audio: ["analog", "optical", "coax"],
  audioReturn: ["optical", "coax", "hdmi", "analog"],   // analog last: a TV's L/R out into an analog-only module
  speaker: ["speaker"],
};
const FAM_NAME = { mxnet: "MXNet (Cat6)", hdmi: "HDMI", hdbaset: "HDBaseT", analog: "analog", optical: "optical", coax: "coax", speaker: "speaker", sub: "sub", dante: "Dante" };
export const familyName = f => FAM_NAME[f] || f;

// a port list from an entry's input/output counts (catalog gear without an audited list)
function fromCounts(c) {
  const out = [], I = c.inputs || {}, O = c.outputs || {};
  const add = (n, dir, conn, label) => { for (let i = 1; i <= (+n || 0); i++) out.push({ label: n > 1 ? `${label} ${i}` : label, dir, conn }); };
  add(I.hdmi, "in", "hdmi", "HDMI IN"); add(I.analog, "in", "analog", "ANALOG IN"); add(I.optical, "in", "optical", "OPTICAL IN");
  add(I.coax, "in", "coax", "COAX IN"); add(I.digitalCombo, "in", "optical", "DIGITAL IN");
  if (I.earc) out.push({ label: "eARC IN", dir: "in", conn: "hdmi", earc: true });
  add(O.hdmi, "out", "hdmi", "HDMI OUT"); add(O.analog, "out", "analog", "ANALOG OUT"); add(O.optical, "out", "optical", "OPTICAL OUT");
  add(O.coax, "out", "coax", "COAX OUT"); add(O.sub, "out", "sub", "SUB OUT");
  if (c.type === "amp") add(c.zones || 1, "out", "speaker", "ZONE");
  if (c.type === "avr") out.push({ label: "SPEAKER OUTPUTS", dir: "out", conn: "speaker" });
  return out.map(p => p.conn === "speaker" && c.type === "amp" ? { ...p, label: `${p.label} SPEAKER` } : p);
}

// unlinked gear: what a box of this type plainly has
const PLAIN = {
  source: [{ label: "HDMI OUT", dir: "out", conn: "hdmi" }, { label: "AUDIO OUT (analog)", dir: "out", conn: "analog" }, { label: "OPTICAL OUT", dir: "out", conn: "optical" }],
  avr: [...[1, 2, 3, 4, 5, 6].map(i => ({ label: `HDMI ${i}`, dir: "in", conn: "hdmi" })), { label: "HDMI OUT 1 (eARC)", dir: "out", conn: "hdmi", earc: true },
    { label: "HDMI OUT 2", dir: "out", conn: "hdmi" }, { label: "OPTICAL 1", dir: "in", conn: "optical" }, { label: "OPTICAL 2", dir: "in", conn: "optical" },
    { label: "ZONE 2 OUT L/R", dir: "out", conn: "analog" }, { label: "SPEAKER OUTPUTS", dir: "out", conn: "speaker" }],
};
// the adapters the app adds (baluns, MXNet encoders/decoders, AXIS)
const ADAPTER = {
  balun: [{ label: "TX: HDMI IN", dir: "in", conn: "hdmi" }, { label: "RX: HDMI OUT", dir: "out", conn: "hdmi" }],
  enc: [{ label: "HDMI IN", dir: "in", conn: "hdmi" }, { label: "HDMI LOOP OUT", dir: "out", conn: "hdmi" }, { label: "AUDIO OUT (5-pin)", dir: "out", conn: "analog" }],
  dec: [{ label: "HDMI OUT", dir: "out", conn: "hdmi" }, { label: "AUDIO OUT (5-pin)", dir: "out", conn: "analog" }],
  axis: [{ label: "eARC IN", dir: "in", conn: "hdmi", earc: true }, { label: "OPTICAL IN", dir: "in", conn: "optical" }],
  axis16: [{ label: "eARC IN", dir: "in", conn: "hdmi", earc: true }, { label: "OPTICAL IN", dir: "in", conn: "optical" }],
};

/* a node's ports: { known, ports } — known = the list comes from the catalog
   (audited or counted), not guessed; endpoints (TVs, speakers) have none */
export function portsOf(nodeKind, obj, catEntry) {
  if (nodeKind === "companion") {
    const list = [...(catEntry?.ports || ADAPTER[obj.type] || [])];
    // MXNet encoders/decoders: the stream (and Dante, on the Dante models) rides the one LAN jack
    if (obj.type === "enc" || obj.type === "dec") list.push({ label: "LAN (MXNet)", dir: obj.type === "enc" ? "out" : "in", conn: "mxnet" });
    if ((obj.dante || /dante/.test(catEntry?.model || "")) && !list.some(p => p.conn === "dante")) list.push({ label: "LAN (Dante)", dir: "out", conn: "dante" });
    return { known: true, ports: withIds(list) };
  }
  if (nodeKind !== "device") return { known: false, ports: [] };
  if (catEntry?.ports?.length) {
    const list = [...catEntry.ports];
    if ((catEntry.flags || []).includes("dante") && !list.some(p => p.conn === "dante")) list.push({ label: "DANTE", dir: "in", conn: "dante" });
    return { known: true, ports: withIds(list) };
  }
  if (catEntry && (catEntry.inputs || catEntry.outputs)) return { known: true, ports: withIds(fromCounts(catEntry)) };
  if (obj.type === "amp") return { known: false, ports: withIds(fromCounts({ type: "amp", zones: obj.zones || 8, inputs: { analog: obj.zones || 8 } })) };
  return { known: false, ports: withIds(PLAIN[obj.type] || []) };
}
const withIds = list => list.map(p => ({ ...p, id: p.label }));

// the adapter's catalog product (mirrors network.js companionRef)
export function adapterRef(c, tenG = false) {
  if (c.type === "axis") return "avpro-acp-axis2";
  if (c.type === "axis16") return "avpro-acp-axis16";
  if (c.type === "enc") return tenG ? "avpro-mxnet-10g-tcvr" : c.dante ? "avpro-mxnet-1g-dante-ev2" : "avpro-mxnet-1g-ev2";
  if (c.type === "dec") return tenG ? "avpro-mxnet-10g-tcvr" : c.dante ? "avpro-mxnet-1g-dante-dv2" : "avpro-mxnet-1g-dv2";
  if (c.type === "balun") return "avpro-ac-ex70-444-kit";
  return null;
}

/* the whole solution's port map: conns[i] → { from, to, fromWhy, toWhy } */
export function assignPorts(job, ix, catalog, solIndex = 0) {
  const s = ix.solutions[solIndex]; if (!s) return [];
  const sol = s.sol, conns = sol.connections || [];
  const cat = ref => ref ? catalog?.devices?.[ref] : null;
  const tenG = Object.values(s.devices).some(d => cat(d.catalogRef)?.gen === "10g");
  const node = id => {
    const d = s.devices[id] || s.locals[id];
    if (d) return { id, kind: "device", obj: d, ...portsOf("device", d, catalogFor(d, catalog)) };
    const c = s.companions[id];
    if (c) return { id, kind: "companion", obj: c, ...portsOf("companion", c, cat(adapterRef(c, tenG))) };
    return { id, kind: "endpoint", known: false, ports: [] };
  };
  const nodes = new Map(), N = id => nodes.get(id) ?? nodes.set(id, node(id)).get(id);
  const used = new Map();                                    // "id|dir|portId" → conn index
  const take = (id, dir, p, i) => used.set(`${id}|${dir}|${p.id}`, i);
  const isFree = (id, dir, p) => p.conn === "dante" || p.conn === "mxnet" || !used.has(`${id}|${dir}|${p.id}`);   // one Dante / MXNet jack carries many streams
  const name = id => describeNode(job, sol, id).short;
  const out = conns.map(() => ({ from: null, to: null }));

  // which families a connection may use at each end, in preference order
  const isSw = id => s.devices[id]?.type === "avSwitch";
  const famsFor = c => c.dante ? ["dante"] : (c.signal === "video" && (isSw(c.from) || isSw(c.to))) ? ["mxnet"]
    : c.earcKit ? ["hdmi"] : FAMILIES[c.signal] || [];   // the eARC kit: TV eARC port → … → a receiver HDMI input
  const pickOrder = (n, dir, c, fams) => {
    const list = n.ports.filter(p => (p.dir === dir || p.conn === "dante") && fams.includes(p.conn));
    const byFam = p => fams.indexOf(p.conn);
    const pref = p => {
      const L = p.label.toUpperCase();
      // a receiver's main out (the eARC one) goes to its TV — even when the TV's sound comes
      // back some other way (the eARC kit); it's left free only for another feed that needs eARC
      if (dir === "out" && c.signal === "video" && n.obj?.type === "avr") {
        const otherNeedsEarc = conns.some(k => k !== c && k.from === c.from && k.signal === "video" && k.earc);
        return (c.earc || !otherNeedsEarc ? (p.earc ? 0 : 2) : (p.earc ? 1 : 0)) + (/ZONE ?2/.test(L) ? 5 : 0);
      }
      if (dir === "out" && c.signal === "audio" && n.obj?.type === "avr") return /ZONE ?2/.test(L) ? 0 : 3;
      if (dir === "out" && c.signal === "speaker" && c.channels) {
        const z = Math.ceil(parseInt(c.channels, 10) / 2);
        return new RegExp(`\\bZONE ${z}\\b`).test(L) ? 0 : 1;
      }
      if (dir === "in" && c.signal === "audioReturn") return c.earc ? (p.earc ? 0 : 1) : (p.earc ? 2 : 0);
      if (dir === "in" && p.audio === "pcm2" && c.signal === "audio") return 1;   // analog before a PCM-only digital input
      return 0;
    };
    return list.sort((a, b) => pref(a) - pref(b) || byFam(a) - byFam(b));
  };
  // pick both ends together so an audio run is analog→analog or digital→digital
  const land = (c, i) => {
    const A = N(c.from), B = N(c.to);
    const fams = famsFor(c);
    if (!fams.length) return;                                // network, unknown: not ours
    const pin = (n, dir, want) => want ? n.ports.find(p => p.id === want && p.dir === dir) : null;
    const fa = pin(A, "out", c.fromPort), tb = pin(B, "in", c.toPort);
    const candA = fa ? [fa] : pickOrder(A, "out", c, fams).filter(p => isFree(A.id, "out", p));
    const candB = tb ? [tb] : pickOrder(B, "in", c, fams).filter(p => isFree(B.id, "in", p));
    const mx = fams[0] === "mxnet";
    const aHas = A.ports.length > 0 && !(mx && isSw(A.id)), bHas = B.ports.length > 0 && !(mx && isSw(B.id));
    const compat = (p, q) => !p || !q || p.conn === q.conn || (p.conn === "hdmi" && q.conn === "hdbaset") || (p.conn === "hdbaset" && q.conn === "hdmi")
      || (["optical", "coax"].includes(p.conn) && ["optical", "coax"].includes(q.conn) && p.conn === q.conn);
    let best = null;
    if (aHas && bHas) { for (const p of candA) { const q = candB.find(q => compat(p, q)); if (q) { best = [p, q]; break; } } }
    else if (aHas) best = candA.length ? [candA[0], null] : null;
    else if (bHas) best = candB.length ? [null, candB[0]] : null;
    else return;
    const why = (n, dir) => {
      const kinds = fams.map(familyName).join(" / ");
      const all = n.ports.filter(p => (p.dir === dir || p.conn === "dante") && fams.includes(p.conn));
      return all.length ? `${name(n.id)}: every ${kinds} ${dir === "out" ? "output" : "input"} is already used` : `${name(n.id)} has no ${kinds} ${dir === "out" ? "output" : "input"}`;
    };
    if (!best) {
      out[i] = { from: aHas && candA[0] && !bHas ? candA[0] : null, to: null,
                 fromWhy: aHas && !candA.length ? why(A, "out") : null, toWhy: bHas && !candB.length ? why(B, "in") : null };
      if (!out[i].fromWhy && !out[i].toWhy) out[i].fromWhy = `${name(A.id)} → ${name(B.id)}: no matching ${fams.map(familyName).join(" / ")} jacks`;
      return;
    }
    const [p, q] = best;
    if (p) take(A.id, "out", p, i);
    if (q) take(B.id, "in", q, i);
    out[i] = { from: p, to: q };
  };
  // pinned ends first, so an auto pick never takes a jack the designer chose
  const order = conns.map((c, i) => i).sort((x, y) => (!!(conns[y].fromPort || conns[y].toPort)) - (!!(conns[x].fromPort || conns[x].toPort)));
  for (const i of order) land(conns[i], i);
  return out;
}

/* for a picker: every jack on a box in one direction, and what's on it */
export function jacksOf(job, ix, catalog, solIndex, id, dir, portMap) {
  const s = ix.solutions[solIndex], sol = s.sol, conns = sol.connections || [];
  const cat = ref => ref ? catalog?.devices?.[ref] : null;
  const d = s.devices[id] || s.locals[id], c = s.companions[id];
  const { ports } = d ? portsOf("device", d, catalogFor(d, catalog)) : c ? portsOf("companion", c, cat(adapterRef(c))) : { ports: [] };
  return ports.filter(p => p.dir === dir).map(p => {
    const i = conns.findIndex((k, j) => (dir === "out" ? k.from === id && portMap[j]?.from?.id === p.id : k.to === id && portMap[j]?.to?.id === p.id));
    return { ...p, usedBy: i >= 0 && p.conn !== "dante" ? i : null };
  });
}

/* "Plug something into X" / "Connect an output of X": every other box, with
   the jack pair a new wire would use — or grayed with the reason it can't
   (Ryan 2026-09-29: gray, don't hide). dir "in" = candidates that FEED id,
   "out" = candidates id feeds. Signal follows from the jacks: HDMI → video,
   analog / optical / coax → line audio, speaker terminals → speaker level,
   Dante → Dante; a TV feeding a box is its sound coming back. */
const NET_ONLY = new Set(["power", "networkSwitch", "gateway", "controlBox", "avbSwitch", "avSwitch", "host"]);
export function plugCandidates(job, ix, catalog, solIndex, id, dir) {
  const s = ix.solutions[solIndex], sol = s.sol, conns = sol.connections || [];
  const cat = ref => ref ? catalog?.devices?.[ref] : null;
  const map = assignPorts(job, ix, catalog, solIndex);
  const used = new Set();
  conns.forEach((c, i) => { if (map[i]?.from) used.add(`${c.from}|out|${map[i].from.id}`); if (map[i]?.to) used.add(`${c.to}|in|${map[i].to.id}`); });
  const info = nid => {
    const d = s.devices[nid] || s.locals[nid];
    if (d) return { kind: "device", type: d.type, ...portsOf("device", d, catalogFor(d, catalog)) };
    const c = s.companions[nid];
    if (c) return { kind: "companion", type: c.type, ...portsOf("companion", c, cat(adapterRef(c))) };
    const e = ix.endpointsById[nid];
    return e ? { kind: e.type === "display" ? "display" : "speakers", type: e.type, known: false, ports: [] } : null;
  };
  const free = (nid, n, d, conn) => n.ports.filter(p => (p.dir === d || p.conn === "dante") && p.conn === conn && (p.conn === "dante" || !used.has(`${nid}|${d}|${p.id}`)))
    .sort((a, b) => (/ZONE ?2/i.test(b.label) - /ZONE ?2/i.test(a.label)) || (/PRE ?OUT/i.test(a.label) - /PRE ?OUT/i.test(b.label)));
  const has = (n, d, conn) => n.ports.some(p => (p.dir === d || p.conn === "dante") && p.conn === conn);
  const name = nid => describeNode(job, sol, nid).short;
  const SIG = [["hdmi", "video"], ["analog", "audio"], ["optical", "audio"], ["coax", "audio"], ["dante", "audio"], ["speaker", "speaker"]];
  const me = info(id); if (!me) return [];
  const others = [...Object.keys(s.devices), ...Object.keys(s.locals), ...Object.keys(s.companions), ...Object.keys(ix.endpointsById)].filter(x => x !== id);
  const fed = new Set(conns.filter(c => c.signal === "speaker" || c.signal === "video").map(c => c.to));
  return others.map(oid => {
    const o = info(oid); if (!o) return null;
    const [src, snk, srcId, snkId] = dir === "in" ? [o, me, oid, id] : [me, o, id, oid];
    const base = { id: oid, name: name(oid), group: o.kind === "device" ? (s.locals[oid] ? "In the zones" : "In the rack") : o.kind === "companion" ? "Adapters" : "In the zones" };
    if (NET_ONLY.has(o.type)) return { ...base, disabled: true, reason: "network gear — its Cat6 is planned on the Network sheet" };
    if (src.kind === "speakers") return { ...base, disabled: true, reason: "speakers only take a signal, they don't send one" };
    // a TV's own sound back to a box (eARC / optical / analog)
    if (src.kind === "display") {
      if (snk.kind !== "device" && snk.kind !== "companion") return { ...base, disabled: true, reason: "a TV's sound goes to rack gear or an adapter" };
      for (const conn of ["optical", "hdmi", "coax", "analog"]) { const q = free(snkId, snk, "in", conn).find(p => conn !== "hdmi" || p.earc); if (q) return { ...base, signal: "audioReturn", fromPort: null, toPort: q.id, port: q.label, note: "the TV's sound back" }; }
      return { ...base, disabled: true, reason: `${name(snkId)} has no free input for a TV's sound (optical / eARC / analog)` };
    }
    // into a TV: video only (the app adds the balun / decoder)
    if (snk.kind === "display") {
      if (!has(src, "out", "hdmi")) return { ...base, disabled: true, reason: `${name(srcId)} has no HDMI output for a TV` };
      if (fed.has(snkId)) return { ...base, disabled: true, reason: "that TV already has a video feed — change it in its zone's HOOKUP" };
      const p = free(srcId, src, "out", "hdmi")[0];
      return p || !src.known ? { ...base, signal: "video", viaHookup: true, fromPort: p?.id || null, port: p?.label || "HDMI", note: "video (balun added if it's a run)" }
        : { ...base, disabled: true, reason: `every HDMI output on ${name(srcId)} is in use` };
    }
    if (snk.kind === "speakers") {
      if (!has(src, "out", "speaker")) return { ...base, disabled: true, reason: `${name(srcId)} has no speaker outputs — speakers need an amp or receiver` };
      if (fed.has(snkId)) return { ...base, disabled: true, reason: "those speakers are already driven — change it in their zone's HOOKUP" };
      return { ...base, signal: "speaker", viaHookup: true, port: free(srcId, src, "out", "speaker")[0]?.label || "speaker outputs", note: "speaker level" };
    }
    // box to box: the first connector family both sides have free
    let blocked = null;
    for (const [conn, signal] of SIG) {
      if (!has(src, "out", conn) || !has(snk, "in", conn)) continue;
      const p = free(srcId, src, "out", conn)[0], q = free(snkId, snk, "in", conn)[0];
      if (p && q) return { ...base, signal, dante: conn === "dante" || undefined, fromPort: p.id, toPort: q.id,
        port: dir === "in" ? p.label : q.label, other: dir === "in" ? q.label : p.label, note: familyName(conn) };
      blocked ||= !p ? `every ${familyName(conn)} output on ${name(srcId)} is in use` : `every ${familyName(conn)} input on ${name(snkId)} is in use`;
    }
    if (blocked) return { ...base, disabled: true, reason: blocked };
    if (!src.known && !snk.known) return { ...base, signal: "video", fromPort: null, toPort: null, port: "", note: "jacks unknown — link a catalog product to see them" };
    const outs = [...new Set(src.ports.filter(p => p.dir === "out").map(p => familyName(p.conn)))].join(" / ") || "no outputs";
    const ins = [...new Set(snk.ports.filter(p => p.dir === "in").map(p => familyName(p.conn)))].join(" / ") || "no inputs";
    return { ...base, disabled: true, reason: `no matching jacks — ${name(srcId)}: ${outs} out; ${name(snkId)}: ${ins} in` };
  }).filter(Boolean);
}
