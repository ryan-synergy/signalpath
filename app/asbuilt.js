/* ---------- asbuilt.js — as-built mode ----------
   An as-built is a COPY of a job: startAsBuilt() takes the chosen solution (its
   per-solution overrides folded into the house), freezes that proposal as a
   baseline inside the copy, and stamps the copy AS-BUILT. The original job is
   never touched (Ryan 2026-09-28: "copy, keep proposal").
   asBuiltChanges() compares the copy with its baseline — rooms, their TVs and
   speakers, rack and in-room gear, adapters, and every wire — and numbers each
   difference. The same numbered list drives the △ deltas on the drawing
   (engine render, opts.changes), the As-Built Changes page and the JOB tab.
   installRows() is the install record (serial / MAC / IP / notes per box)
   that prints in the service packet.
   Pure module, no DOM. */

import { effectiveJob } from "./engine.js";
import { describeNode, SIGNAL_NAME, SPEAKER_SETUP, STATUS_NAME } from "./names.js";

const clone = o => JSON.parse(JSON.stringify(o));

export const isAsBuilt = job => !!job?.job?.asBuilt?.baseline;

export function startAsBuilt(job, solIndex = 0, today = new Date().toISOString().slice(0, 10)) {
  const eff = effectiveJob(job, solIndex);                 // the proposal exactly as it draws
  const sol = clone(eff.solutions[solIndex] || eff.solutions[0]);
  delete sol.overrides;                                    // folded into the house by effectiveJob
  const fromSolution = sol.name || sol.id;
  sol.name = "As-Built";                                   // the title block reads "AV Schematic — As-Built", not the proposal's option name
  const J = clone(job.job || {});
  const revs = J.revisions || [];
  const out = {
    ...clone(eff), solutions: [sol],
    job: { ...J, name: `${J.name || "Job"} — As-Built`, stage: "asBuilt",
      revisions: [...revs, { rev: revs.length + 1, date: today, description: "As-built started", by: String(J.drawnBy || "SP").slice(0, 2).toUpperCase() }],
      asBuilt: { fromName: J.name || "", fromSolution, started: today,
                 baseline: { house: clone(eff.house), solution: clone(sol) } } },
  };
  return out;
}

/* ---------- what changed ---------- */
const EP_FIELDS = ["type", "config", "count", "satCount", "buriedSub", "size", "displayType", "brand", "model", "status"];
const DEV_FIELDS = ["type", "model", "status", "catalogRef"];
const say = (ep, k, v) => {
  if (v == null || v === "") return "none";
  if (k === "size") return `${v}"`;
  if (k === "config") return SPEAKER_SETUP[v] || v;
  if (k === "status") return STATUS_NAME[v] || v;
  if (k === "catalogRef") return "catalog link";
  return String(v);
};
const epWhat = ep => ep.type === "display" ? (ep.displayType === "projector" ? "projector" : "TV") : ep.type === "speakers" ? "speakers" : ep.type || "endpoint";
const connKey = c => `${c.from}→${c.to}|${c.signal || ""}`;
const connDesc = c => [c.channels && `ch ${c.channels}`, c.count > 1 && `×${c.count}`, c.dante && "Dante", c.scope && c.scope !== "included" && c.scope].filter(Boolean).join(", ");

export function asBuiltChanges(job) {
  if (!isAsBuilt(job)) return [];
  const base = job.job.asBuilt.baseline;
  const bj = { job: job.job, house: base.house, solutions: [base.solution] };   // describeNode reads names from here for removed items
  const sol = job.solutions[0] || {}, bsol = base.solution || {};
  const out = [];
  const add = (kind, action, ref, text) => out.push({ n: out.length + 1, kind, action, ref, text });
  const name = (j, s, id) => describeNode(j, s, id).short;

  // rooms, and the TV / speakers in them — one delta per room
  const bz = new Map((base.house?.zones || []).map(z => [z.id, z]));
  const cz = new Map((job.house?.zones || []).map(z => [z.id, z]));
  for (const z of job.house?.zones || []) {
    const b = bz.get(z.id);
    if (!b) { add("zone", "added", { zone: z.id }, `Added room: ${z.name}`); continue; }
    const bits = [];
    if (b.name !== z.name) bits.push(`renamed from ${b.name}`);
    if ((b.scope || "included") !== (z.scope || "included")) bits.push(`scope ${b.scope || "included"} → ${z.scope || "included"}`);
    const be = new Map((b.endpoints || []).map(e => [e.id, e]));
    for (const e of z.endpoints || []) {
      const o = be.get(e.id);
      if (!o) { bits.push(`added ${epWhat(e)}`); continue; }
      for (const k of EP_FIELDS) if (JSON.stringify(o[k] ?? null) !== JSON.stringify(e[k] ?? null))
        bits.push(`${epWhat(e)} ${k === "config" || k === "size" || k === "status" ? "" : k + " "}${say(e, k, o[k])} → ${say(e, k, e[k])}`.replace(/  +/g, " "));
    }
    for (const o of b.endpoints || []) if (!(z.endpoints || []).some(e => e.id === o.id)) bits.push(`removed ${epWhat(o)}`);
    if (bits.length) add("zone", "changed", { zone: z.id }, `${z.name}: ${bits.join("; ")}`);
  }
  for (const b of base.house?.zones || []) if (!cz.has(b.id)) add("zone", "removed", { zone: b.id }, `Removed room: ${b.name}`);

  // rack and in-room gear
  const devs = s => [...(s.racks || []).flatMap(r => r.devices || []), ...(s.localDevices || [])];
  const bd = new Map(devs(bsol).map(d => [d.id, d])), cd = new Map(devs(sol).map(d => [d.id, d]));
  for (const d of devs(sol)) {
    const o = bd.get(d.id);
    if (!o) { add("device", "added", { device: d.id }, `Added ${name(job, sol, d.id)}`); continue; }
    const bits = DEV_FIELDS.filter(k => k !== "catalogRef" && JSON.stringify(o[k] ?? null) !== JSON.stringify(d[k] ?? null)).map(k => `${k} ${say(d, k, o[k])} → ${say(d, k, d[k])}`);
    if (bits.length) add("device", "changed", { device: d.id }, `${name(bj, bsol, d.id)}: ${bits.join("; ")}`);
  }
  for (const o of devs(bsol)) if (!cd.has(o.id)) add("device", "removed", { device: o.id }, `Removed ${name(bj, bsol, o.id)}`);

  // adapters (baluns, encoders, decoders, Dante)
  const bc = new Map((bsol.companions || []).map(c => [c.id, c])), cc = new Map((sol.companions || []).map(c => [c.id, c]));
  for (const c of sol.companions || []) {
    const o = bc.get(c.id);
    if (!o) add("chip", "added", { chip: c.id }, `Added ${name(job, sol, c.id)}`);
    else if (o.type !== c.type || o.serves !== c.serves) add("chip", "changed", { chip: c.id }, `${name(job, sol, c.id)}: was ${name(bj, bsol, c.id)}`);
  }
  for (const o of bsol.companions || []) if (!cc.has(o.id)) add("chip", "removed", { chip: o.id }, `Removed ${name(bj, bsol, o.id)}`);

  // wires
  const bw = new Map((bsol.connections || []).map(c => [connKey(c), c])), cw = new Map((sol.connections || []).map(c => [connKey(c), c]));
  const sig = c => SIGNAL_NAME[c.signal] || c.signal || "";
  for (const c of sol.connections || []) {
    const o = bw.get(connKey(c));
    const what = `${name(job, sol, c.from)} → ${name(job, sol, c.to)}`;
    if (!o) add("wire", "added", { wire: `${c.from}→${c.to}` }, `New run: ${what} (${sig(c)})`);
    else if (connDesc(o) !== connDesc(c)) add("wire", "changed", { wire: `${c.from}→${c.to}` }, `${what}: ${connDesc(o) || "—"} → ${connDesc(c) || "—"}`);
  }
  for (const o of bsol.connections || []) if (!cw.has(connKey(o)))
    add("wire", "removed", { wire: `${o.from}→${o.to}` }, `Removed run: ${name(bj, bsol, o.from)} → ${name(bj, bsol, o.to)} (${sig(o)})`);
  return out;
}

/* ---------- install record ----------
   What the tech writes down at the rack: serial, MAC, IP and a note per box,
   kept on the box itself (d.install) so it moves and deletes with it. It isn't
   a change from the proposal, so asBuiltChanges never lists it. Rack gear
   first (in rack order), then in-room gear by room. */
export const INSTALL_FIELDS = ["serial", "mac", "ip", "notes"];
const text = v => v == null || typeof v === "object" ? "" : String(v).trim();

// "001122aabbcc", "00-11-22-AA-BB-CC", "0011.22aa.bbcc" → "00:11:22:AA:BB:CC"; anything else is kept as typed
export function tidyMac(v) {
  const s = text(v), hex = s.replace(/[\s:.\-]/g, "");
  return /^[0-9a-f]{12}$/i.test(hex) ? hex.toUpperCase().match(/../g).join(":") : s;
}
const ipOk = s => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every(n => +n <= 255);
const macOk = s => /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(s);

export function installRows(job, solIndex = 0) {
  const sol = job.solutions?.[solIndex] || {};
  const zones = job.house?.zones || [];
  const zname = id => zones.find(z => z.id === id)?.name || id || "";
  const row = (d, where) => {
    const r = { id: d.id, name: describeNode(job, sol, d.id).short, where };
    for (const k of INSTALL_FIELDS) r[k] = text(d.install?.[k]);
    return r;
  };
  const rows = (sol.racks || []).flatMap(r => (r.devices || []).map(d => row(d, r.name || r.id)));
  const order = new Map(zones.map((z, i) => [z.id, i]));
  const locals = [...(sol.localDevices || [])].sort((a, b) => (order.get(a.zone) ?? 1e9) - (order.get(b.zone) ?? 1e9));
  rows.push(...locals.map(d => row(d, zname(d.zone))));
  // flags: a malformed IP or MAC, or the same address on two boxes
  const seen = k => { const m = new Map(); for (const r of rows) if (r[k]) m.set(r[k].toLowerCase(), (m.get(r[k].toLowerCase()) || 0) + 1); return m; };
  const ips = seen("ip"), macs = seen("mac");
  for (const r of rows) {
    r.warn = [];
    if (r.ip && !ipOk(r.ip)) r.warn.push("IP isn't a v4 address");
    else if (r.ip && ips.get(r.ip.toLowerCase()) > 1) r.warn.push("same IP as another box");
    if (r.mac && !macOk(r.mac)) r.warn.push("MAC isn't 12 hex digits");
    else if (r.mac && macs.get(r.mac.toLowerCase()) > 1) r.warn.push("same MAC as another box");
    r.filled = INSTALL_FIELDS.some(k => r[k]);
  }
  return rows;
}

// the same record as a spreadsheet — for the network docs or a monitoring tool's import
export function installCSV(job, solIndex = 0) {
  const q = v => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };   // no spreadsheet formulas
  return ["Box,Where,Serial,MAC,IP,Notes,Check"].concat(installRows(job, solIndex).map(r =>
    [r.name, r.where, r.serial, r.mac, r.ip, r.notes, r.warn.join("; ")].map(q).join(","))).join("\n");
}

/* ---------- drawing: revision clouds + numbered deltas ----------
   Geometry comes from the placed sheet (P) and the routed wires (rt). A
   removed item isn't on the sheet any more — it's listed, not clouded. */
function cloudPath(x, y, w, h, r = 7) {
  const seg = (x1, y1, x2, y2) => {
    const len = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.round(len / (r * 2)));
    let d = "";
    for (let i = 1; i <= n; i++) {
      const px = x1 + (x2 - x1) * i / n, py = y1 + (y2 - y1) * i / n;
      d += ` A${(len / n / 2).toFixed(1)} ${(len / n / 2).toFixed(1)} 0 0 1 ${px.toFixed(1)} ${py.toFixed(1)}`;   // bumps bulge outward (clockwise path)
    }
    return d;
  };
  return `M${x} ${y}` + seg(x, y, x + w, y) + seg(x + w, y, x + w, y + h) + seg(x + w, y + h, x, y + h) + seg(x, y + h, x, y) + "Z";
}
const delta = (x, y, n, col) => `<g><path d="M${x} ${y - 11} L${x + 11} ${y + 8} L${x - 11} ${y + 8} Z" fill="#fff" stroke="${col}" stroke-width="1.6"/>` +
  `<text x="${x}" y="${y + 5.5}" text-anchor="middle" font-size="10" font-weight="700" fill="${col}">${n}</text></g>`;

export function changeMarks(changes, P, rt, { grayscale = false } = {}) {
  const col = grayscale ? "#111" : "#c2410c";
  const out = [];
  const devBox = id => { for (const r of P.racks || []) for (const d of r.devices || []) if (d.id === id) return d;
    for (const z of P.zones || []) for (const g of z.groups || []) for (const l of g.locals || (g.local ? [g.local] : []))
      if (l.deviceId === id) return { x: z.x + l.x, y: z.y + l.y, w: l.w, h: l.h };
    return null; };
  for (const c of changes) {
    if (c.action === "removed") continue;
    let b = null;
    if (c.ref.zone) b = (P.zones || []).find(z => z.id === c.ref.zone);
    else if (c.ref.device) b = devBox(c.ref.device);
    else if (c.ref.chip) b = (P.chips || []).find(k => k.id === c.ref.chip);
    else if (c.ref.wire) {
      const w = (rt?.wires || []).find(w => w.id === c.ref.wire);
      if (w?.pts?.length) {
        // cloud the wire's longest leg around its middle (a whole run would cloud half the sheet)
        let best = 0, bi = 0;
        for (let i = 1; i < w.pts.length; i++) { const l = Math.abs(w.pts[i][0] - w.pts[i - 1][0]) + Math.abs(w.pts[i][1] - w.pts[i - 1][1]); if (l > best) { best = l; bi = i; } }
        const [a, q] = [w.pts[bi - 1], w.pts[bi]], mx = (a[0] + q[0]) / 2, my = (a[1] + q[1]) / 2;
        b = { x: mx - 22, y: my - 16, w: 44, h: 32 };
      }
    }
    if (!b) continue;
    const pad = c.ref.wire ? 0 : 7;
    const x = b.x - pad, y = b.y - pad, w = b.w + pad * 2, h = b.h + pad * 2;
    out.push(`<path class="abcloud" data-change="${c.n}" d="${cloudPath(x, y, w, h)}" fill="none" stroke="${col}" stroke-width="1.4"/>`);
    out.push(delta(x + w + 4, y - 2, c.n, col));
  }
  return out.length ? `<g class="asbuilt-marks" pointer-events="none">${out.join("")}</g>` : "";   // never steals a tap from a wire or card
}
