/* SignalPath print pages 2–4 (spec §5, layouts per approved mock-pages.svg).
   Channel Map · Equipment & Takeoff · Wire Schedule — every row derived from
   the same job graph the schematic draws; no run or item exists here that
   is not on Sheet 1. Pure string builders, no DOM. */

import { expandChannels, effectiveJob, indexJob } from "./engine.js";
import { TYPE_NAME, PLATFORM_NAME, adapterName, describeNode } from "./names.js";
import { NET_ROLE_NAME, switchSetup } from "./network.js";
import { isAsBuilt, asBuiltChanges, installRows } from "./asbuilt.js";

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const W = 1632, H = 1056;

/* ---------- per-project page flags ---------- */
export function pageFlags(job) {
  const p = job.job?.pages || {};
  return { channelMap: p.channelMap !== false, equipment: p.equipment !== false,
           wireSchedule: p.wireSchedule === true, bomCompare: p.bomCompare === true, network: p.network !== false, labels: p.labels === true, elevation: p.elevation !== false };
}
export function sheetCount(job) {
  const f = pageFlags(job);
  return 1 + (f.channelMap ? 1 : 0) + (f.equipment ? 1 : 0) + (f.wireSchedule ? 1 : 0) + (f.network ? 1 : 0) + (f.labels ? 1 : 0) + (f.elevation ? 1 : 0) +
         (f.bomCompare && (job.solutions || []).length > 1 ? 1 : 0);
}

/* ---------- shared frame + footer (horizontal bar variant) ---------- */
function frame(title, subtitle, sheetLabel) {
  return `<rect width="${W}" height="${H}" fill="#fff"/>
<rect x="10" y="10" width="1612" height="1036" fill="none" stroke="#444" stroke-width="1.5"/>
<text x="40" y="64" font-size="26" font-weight="700" fill="#111">${esc(title)}</text>
<text x="40" y="90" font-size="13" fill="#666">${esc(subtitle)}</text>
<text x="1592" y="64" text-anchor="end" font-size="13" fill="#555">${esc(sheetLabel)}</text>`;
}
function footer(job, opts, sheetLabel) {
  const J = job.job || {};
  const co = { name: "SYNERGY", tagline: "AUDIO VIDEO SYSTEMS",
    info: "300 El Camino Real · Tustin, CA 92780 · P: 714-505-2003 · www.synergy.tv", ...(opts.company || {}) };
  const infoLines = String(co.info).split("·").map(s => s.trim());
  const revs = J.revisions || [];
  const last = revs[revs.length - 1] || {};
  const stage = (J.stage || "proposal") === "asBuilt" ? "AS-BUILT" : "PROPOSAL";
  return `<g transform="translate(0,940)">
<rect x="10" y="0" width="1612" height="86" fill="#fff" stroke="#444" stroke-width="1.2"/>
<line x1="360" y1="0" x2="360" y2="86" stroke="#444"/><line x1="700" y1="0" x2="700" y2="86" stroke="#444"/><line x1="1060" y1="0" x2="1060" y2="86" stroke="#444"/>
<text x="24" y="22" font-size="9" fill="#777">Project</text><text x="24" y="44" font-size="14" fill="#111">${esc(J.name)}</text>
<text x="24" y="66" font-size="11" fill="#555">AV Schematic Packet · ${stage}</text>
<text x="374" y="22" font-size="9" fill="#777">Customer</text><text x="374" y="44" font-size="14" fill="#111">${esc(J.client?.name)}</text>
<text x="374" y="66" font-size="11" fill="#555">${esc(J.client?.address)}</text>
<text x="714" y="22" font-size="9" fill="#777">Prepared By</text><text x="714" y="40" font-size="13" fill="#111">${esc(J.drawnBy || "SignalPath")}</text>
<text x="714" y="60" font-size="9" fill="#777">Date Prepared</text><text x="714" y="78" font-size="13" fill="#111">${esc(last.date || "")}</text>
<text x="880" y="22" font-size="9" fill="#777">Rev</text><text x="880" y="40" font-size="13" fill="#111">${esc(last.rev ?? 1)}</text>
<text x="1080" y="40" font-size="20" font-weight="700" letter-spacing="5" fill="#111">${esc(co.name)}</text>
<text x="1080" y="58" font-size="8" letter-spacing="2.4" fill="#444">${esc(co.tagline)}</text>
${infoLines.slice(0, 3).map((l, i) => `<text x="1400" y="${28 + i * 16}" font-size="9" fill="#666">${esc(l)}</text>`).join("")}
</g>
<text x="1590" y="1018" text-anchor="end" font-size="12" fill="#555">${esc(sheetLabel)}</text>`;
}
const openPage = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="'Avenir Next', Avenir, Futura, 'Helvetica Neue', sans-serif">`;

/* ---------- generic table ---------- */
function table(x, y, w, cols, rows, pitch = 28) {
  const out = [`<g font-size="${pitch < 28 ? 12 : 12.5}">`, `<rect x="${x}" y="${y}" width="${w}" height="30" fill="#16181c"/>`,
    `<g fill="#fff" font-weight="600">${cols.map(c => `<text x="${x + c.dx}" y="${y + 20}">${esc(c.label)}</text>`).join("")}</g>`];
  let ry = y + 30;
  rows.forEach((r, i) => {
    const fill = r.gray ? "#f0f0f2" : r.tint ? "#fff9ec" : i % 2 ? "#fff" : "#fbfbfc";
    out.push(`<rect x="${x}" y="${ry}" width="${w}" height="${pitch}" fill="${fill}"/>`);
    const color = r.gray ? "#8a8a8a" : r.spare ? "#9aa" : "#222";
    out.push(`<g fill="${color}">${r.cells.map((cell, ci) =>
      `<text x="${x + cols[ci].dx}" y="${ry + Math.round(pitch * 0.68)}"${cell?.color ? ` fill="${cell.color}"` : ""}${r.gray && cell?.bold ? ` font-weight="600"` : ""}>${esc(cell?.text ?? cell)}</text>`).join("")}</g>`);
    ry += pitch;
  });
  out.push(`<rect x="${x}" y="${y}" width="${w}" height="${ry - y}" fill="none" stroke="#c8ccd4"/></g>`);
  return { svg: out.join("\n"), bottom: ry };
}
const heading = (x, y, text, color = "#111") => `<text x="${x}" y="${y}" font-size="16" font-weight="700" fill="${color}">${esc(text)}</text>`;

/* ---------- pagination ----------
   Page bodies may not run below LIMIT (the footnote line sits at 920 and the
   footer bar at 940). Long tables split across columns/sheets under a
   "(cont.)" heading instead of running off the paper. */
const LIMIT = 900, TOP = 120;
// place as many rows as fit above LIMIT; returns the drawn part + leftovers
function tableFit(x, y, w, cols, rows, pitch = 28) {
  const fit = Math.max(0, Math.floor((LIMIT - (y + 30)) / pitch));
  const t = table(x, y, w, cols, rows.slice(0, fit), pitch);
  return { ...t, rest: rows.slice(fit), placed: Math.min(fit, rows.length) };
}
// wrap a page body in frame + footnote + footer; labels are per physical sheet
function assemble(job, opts, title, subtitle, bodies, label, footnote = () => "") {
  return bodies.map((b, k) => [openPage(), frame(k ? `${title} (cont.)` : title, subtitle, label(k)),
    ...b, footnote(k, bodies.length), footer(job, opts, label(k)), `</svg>`].join("\n"));
}
// soft-wrap a text line to a character budget (mini-cards have a fixed width)
const wrapText = (s, max) => {
  const lines = [];
  let cur = "";
  for (const w of String(s).split(" ")) {
    if (cur && (cur + " " + w).length > max) { lines.push(cur); cur = "    " + w; }
    else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
};
const devName = d => d?.model || d?.id || "?";

/* ---------- shared derivations ---------- */
const spkDescr = ep => {
  if (!ep) return "";
  const c = ep.config || "stereo";
  if (c === "mono") return "1× speaker";
  if (c.startsWith("surround")) return `${c.slice(9)} set`;
  if (c.startsWith("soundbar")) return c === "soundbar-sub" ? "soundbar + sub" : "soundbar";
  if (c === "landscape") return `landscape ${cnt(ep.satCount, 4)}${ep.buriedSub ? "+1" : ""}`;
  if (c === "2.1") return "2.1 set";
  return `${cnt(ep.count, 2)}× speaker${cnt(ep.count, 2) === 1 ? "" : "s"}`;
};
// imported / hand-typed counts: "4", -3, 1.5 → a sane positive integer
const cnt = (v, dflt) => Math.min(99, Math.max(1, Math.floor(+v) || dflt));
const statusLabel = (s, gray) => gray ? "PRE-WIRE" : s === "ofe" ? "OFE" : "New";
const zoneOf = (ix, epId) => ix.zonesById[ix.endpointZone[epId]];
// a connection can outlive its zone (dangling until validate's error is fixed) —
// print something a tech can act on instead of "undefined"
const zoneName = (ix, epId) => zoneOf(ix, epId)?.name || "(zone removed)";
// any connection end in words (names.js) — never print a raw id on paper
const nameOf = (job, s, id) => describeNode(job, s.sol, id).short;
const servesEp = (s, id) => { const c = s.companions[id]; return c && c.serves && !s.devices[c.serves] ? c : null; };

/* ============ PAGE: CHANNEL MAP ============ */
// zone-out numbers as compact runs: [3,5,6,8] → "3, 5–6, 8"
const runsOf = nums => {
  const out = [];
  for (const n of nums) { const last = out[out.length - 1]; if (last && n === last[1] + 1) last[1] = n; else out.push([n, n]); }
  return out.map(([a, b]) => a === b ? String(a) : `${a}–${b}`).join(", ");
};

function channelMapBlocks(job, ix, opts) {
  const s = ix.solutions[opts.solution ?? 0];
  const sol = s.sol;
  const blocks = [];   // {title, cols, rows} tables | {title, lines} mini-cards
  for (const r of sol.racks || []) for (const d of r.devices || []) {
    const inbound = (sol.connections || []).filter(c => c.to === d.id);
    const outbound = (sol.connections || []).filter(c => c.from === d.id);

    if (d.type === "amp") {
      const feeds = outbound.filter(c => c.signal === "speaker")
        .map(c => ({ c, ch: expandChannels(c.channels || "")[0] || 999 })).sort((a, b) => a.ch - b.ch);
      // trunk-fed amps get the per-run patch column: module output k → amp analog input k, in channel order
      const trunkSrc = inbound.find(c => c.signal === "audio" && s.devices[c.from]?.type === "audioOutputModule");
      const used = new Set();
      const rows = feeds.map(({ c }, i) => {
        const ep = ix.endpointsById[c.to];
        const gray = (c.scope || "included") !== "included";
        const chs = expandChannels(c.channels || "");
        for (const ch of chs) used.add(Math.ceil(ch / 2));   // "1-4" occupies zone-outs 1 AND 2
        return { gray, cells: [String(chs.length ? Math.ceil(chs[0] / 2) : "?"), chs.length > 1 ? `${chs[0]}–${chs[chs.length - 1]}` : String(chs[0] ?? "?"),
          ...(trunkSrc ? [`Out ${i + 1} → In ${i + 1}`] : []),
          zoneName(ix, c.to), gray ? `${spkDescr(ep)} (wire only)` : spkDescr(ep), { text: statusLabel(ep?.status, gray), bold: true }] };
      });
      const zones = Math.max(0, Math.floor(+d.zones) || 0);
      const spare = Array.from({ length: zones }, (_, i) => i + 1).filter(n => !used.has(n));
      if (spare.length) rows.push({ spare: true, cells: [runsOf(spare),
        runsOf(spare.flatMap(n => [n * 2 - 1, n * 2])), ...(trunkSrc ? [""] : []), "— spare —", "", ""] });
      const cols = trunkSrc
        ? [{ label: "Zone Out", dx: 14 }, { label: "Channels", dx: 100 }, { label: `Feed (${devName(s.devices[trunkSrc.from])})`, dx: 180 }, { label: "Zone", dx: 320 }, { label: "Speakers", dx: 470 }, { label: "Status", dx: 610 }]
        : [{ label: "Zone Out", dx: 14 }, { label: "Channels", dx: 110 }, { label: "Zone", dx: 210 }, { label: "Speakers", dx: 400 }, { label: "Status", dx: 580 }];
      blocks.push({ title: `${devName(d)} — Distributed Audio`, cols, rows });
    }

    else if (d.type === "videoMatrix" || d.type === "avSwitch") {
      const rows = [];
      inbound.filter(c => c.signal === "video").forEach((c, i) => {
        const src = s.devices[c.from];
        const enc = s.companions[c.from];
        // an ENC chip in front of the matrix is named for the rack source it serves
        const name = src ? devName(src) : enc && s.devices[enc.serves] ? `${devName(s.devices[enc.serves])} · ${adapterName(enc)}` : nameOf(job, s, c.from);
        rows.push({ cells: [`In ${c.matrixIn ?? i + 1}`, "Input", name, "HDMI"] });
      });
      outbound.filter(c => c.signal === "video").forEach((c, i) => {
        const comp = s.companions[c.to];
        const dest = comp ? (servesEp(s, c.to)
            ? `${zoneName(ix, comp.serves)} TV · ${adapterName(comp)}`
            : `${devName(s.devices[comp.serves])} · ${adapterName(comp)}`)
          : s.devices[c.to] ? devName(s.devices[c.to]) : ix.endpointsById[c.to] ? `${zoneName(ix, c.to)} TV` : nameOf(job, s, c.to);
        rows.push({ cells: [`Out ${c.matrixOut ?? i + 1}`, "Output", dest, comp && comp.type === "balun" ? "HDBaseT" : comp ? "MXNet" : "HDMI"] });
      });
      const io = d.io || {};
      const spareIn = (io.in || 0) - inbound.filter(c => c.signal === "video").length;
      const spareOut = (io.out || 0) - outbound.filter(c => c.signal === "video").length;
      if (spareIn > 0) rows.push({ spare: true, cells: [`In +${spareIn}`, "Input", "— spare —", ""] });
      if (spareOut > 0) rows.push({ spare: true, cells: [`Out +${spareOut}`, "Output", "— spare —", ""] });
      blocks.push({ title: `${devName(d)} — ${TYPE_NAME[d.type]}`,
        colsFor: w => [{ label: "Port", dx: 14 }, { label: "Direction", dx: 100 }, { label: "Connected To", dx: 220 }, { label: "Signal", dx: w - 100 }], rows });
    }

    else if (d.type === "audioInputModule") {
      const rows = inbound.filter(c => c.signal === "audio" || c.signal === "audioReturn").map((c, i) => {
        const ret = c.signal === "audioReturn";
        const src = s.devices[c.from];
        return { cells: [String(i + 1),
          ret ? { text: `${zoneName(ix, c.from)} TV — audio return`, color: "#a45a12" } : `${src ? devName(src) : nameOf(job, s, c.from)}${src?.status === "ofe" ? " (OFE)" : ""}`,
          ret ? "Optical" : "Analog stereo"] };
      });
      blocks.push({ title: `${devName(d)} — Audio Sources In`, cols: [{ label: "Input", dx: 14 }, { label: "Source", dx: 110 }, { label: "Connection", dx: 400 }], rows });
    }

    else if (d.type === "avr") {
      const vin = inbound.filter(c => c.signal === "video").map(c => s.devices[c.from] ? devName(s.devices[c.from]) : s.companions[c.from] ? adapterName(s.companions[c.from]) : nameOf(job, s, c.from)).join(" · ") || "—";
      const spk = outbound.filter(c => c.signal === "speaker").map(c => { const ep = ix.endpointsById[c.to]; return `${zoneName(ix, c.to)}: ${spkDescr(ep)} (${statusLabel(ep?.status)})`; }).join(" · ") || "—";
      const vout = outbound.filter(c => c.signal === "video").map(c => { const comp = s.companions[c.to]; const back = c.earc ? " (eARC back)" : "";
        return comp && servesEp(s, c.to) ? `${zoneName(ix, comp.serves)} TV via ${adapterName(comp)}${back}` : s.devices[c.to] ? devName(s.devices[c.to]) : `${nameOf(job, s, c.to)}${back}`; }).join(" · ") || "—";
      // TV audio coming home to this receiver: eARC on its own HDMI outs, optical runs in
      const aback = [...outbound.filter(c => c.signal === "video" && c.earc).map(c => { const comp = s.companions[c.to];
          return `${comp && servesEp(s, c.to) ? zoneName(ix, comp.serves) : zoneName(ix, c.to)} TV (eARC)`; }),
        ...inbound.filter(c => c.signal === "audioReturn").map(c => `${nameOf(job, s, c.from)} (optical${c.backup ? " backup" : ""})`)].join(" · ");
      const zname = outbound.filter(c => c.signal === "speaker").map(c => zoneOf(ix, c.to)?.name).filter(Boolean)[0];
      const platform = (sol.platforms || [])[0];
      blocks.push({ title: `${devName(d)}${zname ? ` — ${zname} Surround` : ""}`,
        text: [`Video in: ${vin}`, `Speakers: ${spk}`, `Video out: ${vout}`, ...(aback ? [`TV audio back: ${aback}`] : []), `Control: ${platform ? `IP (${PLATFORM_NAME[platform] || platform} driver)` : "IP / IR"}`] });
    }
  }
  return blocks;
}

function channelMapPages(job, ix, opts, label) {
  const colX = [40, 860], colW = [760, 700];
  const bodies = [[]];
  let colY = [TOP, TOP];
  const newSheet = () => { bodies.push([]); colY = [TOP, TOP]; };
  // shorter column first (balanced), the other column next, then a new sheet;
  // tables split across columns/sheets, mini-cards move whole
  for (const b of channelMapBlocks(job, ix, opts)) {
    let rows = b.rows ? [...b.rows] : null, first = true;
    for (let guard = 0; guard < 400; guard++) {
      const order = colY[0] <= colY[1] ? [0, 1] : [1, 0];
      let c = null, lines = null;
      if (rows) {
        const need = Math.min(3, rows.length) || 1;
        c = order.find(k => Math.floor((LIMIT - (colY[k] + 50)) / 28) >= need) ?? null;
      } else {
        const maxCh = Math.floor((colW[order[0]] - 28) / 7);
        lines = b.text.flatMap(t => wrapText(t, maxCh));
        c = order.find(k => colY[k] + 20 + lines.length * 24 + 24 <= LIMIT) ?? null;
      }
      if (c == null) { if (bodies[bodies.length - 1].length) { newSheet(); continue; } c = 0; }   // oversized mini-card: draw it anyway on a fresh sheet
      const x = colX[c], y = colY[c], w = colW[c];
      const title = first ? b.title : `${b.title} (cont.)`;
      if (rows) {
        const t = tableFit(x, y + 20, w, b.cols || b.colsFor(w), rows);
        bodies[bodies.length - 1].push(heading(x, y + 8, title) + t.svg);
        colY[c] = t.bottom + 46;
        rows = t.rest; first = false;
        if (!rows.length) break;
      } else {
        const h = lines.length * 24 + 24;
        bodies[bodies.length - 1].push(heading(x, y + 8, title) +
          `<g font-size="12.5" fill="#222"><rect x="${x}" y="${y + 20}" width="${w}" height="${h}" fill="#fbfbfc" stroke="#c8ccd4"/>` +
          lines.map((l, i) => `<text x="${x + 14}" y="${y + 46 + i * 24}" xml:space="preserve">${esc(l)}</text>`).join("") + `</g>`);
        colY[c] = y + 20 + h + 46;
        break;
      }
    }
  }
  return assemble(job, opts, "Channel Map", "Every amp, matrix and input assignment — technician reference", bodies, label,
    () => `<text x="40" y="920" font-size="11.5" font-style="italic" fill="#767676">Gray rows = pre-wire only, reserved for future. Spare ports shown so expansion capacity is visible at a glance.</text>`);
}
export function renderChannelMap(job, ix, opts = {}) {
  return channelMapPages(job, ix, opts, () => opts.sheetLabel || "")[0];
}

/* ============ PAGE: EQUIPMENT & TAKEOFF ============ */
export function takeoffItems(job, ix, opts = {}) {
  const s = ix.solutions[opts.solution ?? 0];
  const sol = s.sol;
  const items = []; // {label, status, where, confirm?}
  for (const r of sol.racks || []) for (const d of r.devices || [])
    items.push({ label: devName(d), status: d.status || "new", where: r.name || r.id });
  for (const d of sol.localDevices || [])
    items.push({ label: `${devName(d)} (in-zone)`, status: d.status || "new", where: ix.zonesById[d.zone]?.name || "(zone removed)" });
  const compGroups = {};
  for (const c of sol.companions || []) {
    const kind = `${adapterName(c)} (auto-added)`;
    const where = servesEp(s, c.id) ? zoneOf(ix, c.serves)?.name : s.devices[c.serves]?.model;
    (compGroups[kind] ||= []).push(where || "");
  }
  for (const [label, wheres] of Object.entries(compGroups))
    items.push({ label, status: "new", where: wheres.filter(Boolean).join(" · "), qty: wheres.length });
  for (const z of job.house.zones) {
    const gray = (z.scope || "included") !== "included";
    for (const ep of z.endpoints || []) {
      if (ep.type === "display") {
        items.push({ label: `${ep.brand || "TBD"} ${ep.size ? `${ep.size}"` : "size TBD"} ${ep.displayType === "projector" ? "Projector" : "TV"}${ep.confirm?.length && ep.size ? " — size unconfirmed" : ""}`,
          status: gray ? "prewire" : ep.status || "new", where: z.name, confirm: !!ep.confirm?.length });
      } else {
        items.push({ label: `Speakers, ${spkDescr(ep)}`, status: gray ? "prewire" : ep.status || "new", where: z.name });
      }
    }
  }
  // billable room remotes (Apple TV / factory remotes ship with the gear — drawn, never quoted)
  const REMOTE_BOM = { savant: "Savant Pro Remote", josh: "Josh Remote" };
  for (const z of job.house.zones) {
    const lbl = REMOTE_BOM[z.remote];
    if (lbl && (z.scope || "included") === "included") items.push({ label: lbl, status: "new", where: z.name });
  }
  // roll up identical label+status
  const rolled = [];
  for (const it of items) {
    const hit = rolled.find(r => r.label === it.label && r.status === it.status);
    if (hit) { hit.qty += it.qty || 1; hit.where += " · " + it.where; hit.confirm ||= it.confirm; }
    else rolled.push({ ...it, qty: it.qty || 1 });
  }
  return rolled;
}

export function takeoffCSV(job, ix, opts = {}) {
  const rows = takeoffItems(job, ix, opts);
  // quote + neutralize spreadsheet formula injection (a model named "=..." must open as text)
  const q = s => { let v = String(s ?? ""); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return `"${v.replace(/"/g, '""')}"`; };
  return ["Status,Qty,Item,Location"].concat(rows.map(r => [r.status.toUpperCase(), r.qty, q(r.label), q(r.where)].join(","))).join("\n");
}

function takeoffPages(job, ix, adviseResult, opts, label) {
  const rolled = takeoffItems(job, ix, opts);
  const s = ix.solutions[opts.solution ?? 0];
  const solId = s.sol.id;
  const mine = e => !e.solution || e.solution === solId;   // print only THIS solution's advice
  const cells = r => ({ cells: [String(r.qty), r.label, r.where.length > 44 ? r.where.slice(0, 42) + "…" : r.where], tint: r.confirm });
  const newRows = rolled.filter(r => r.status === "new").map(cells);
  const ofeRows = rolled.filter(r => r.status === "ofe").map(cells);
  const bodies = [[]];
  const sheet = k => { while (bodies.length <= k) bodies.push([]); return bodies[k]; };

  // left column: the NEW table, continued onto further sheets as needed
  {
    let rows = newRows, k = 0;
    do {
      sheet(k).push(heading(40, 138, k ? "NEW — Supplied & Installed (cont.)" : "NEW — Supplied & Installed", "#1a6fb5"));
      const t = tableFit(40, 150, 900, [{ label: "Qty", dx: 14 }, { label: "Item", dx: 80 }, { label: "Location / Zones", dx: 520 }], rows);
      sheet(k).push(t.svg);
      rows = t.rest; k++;
    } while (rows.length);
  }

  // right column: OFE table, then the note boxes — one flowing column
  let rk = 0, ry = 138;
  const nextSheet = () => { rk++; ry = 138; };
  {
    let rows = ofeRows.length ? ofeRows : [{ spare: true, cells: ["", "— none —", ""] }], first = true;
    for (;;) {
      if (ry + 12 + 30 + 28 > LIMIT) { nextSheet(); continue; }
      sheet(rk).push(heading(1000, ry, first ? "OWNER FURNISHED (OFE)" : "OWNER FURNISHED (cont.)", "#4a7040"));
      const t = tableFit(1000, ry + 12, 560, [{ label: "Qty", dx: 14 }, { label: "Item", dx: 80 }, { label: "Zones", dx: 360 }], rows);
      sheet(rk).push(t.svg);
      ry = t.bottom + 44; rows = t.rest; first = false;
      if (!rows.length) break;
      nextSheet();
    }
  }
  const box = (title, titleColor, lines, st) => {
    let rest = lines.length ? lines : [null], first = true;
    for (;;) {
      const fit = Math.floor((LIMIT - (ry + 12 + 16)) / st.pitch);
      if (fit < 1) { nextSheet(); continue; }
      const chunk = rest.slice(0, fit); rest = rest.slice(fit);
      const h = Math.max(36, chunk.length * st.pitch + 16);
      sheet(rk).push(heading(1000, ry, first ? title : `${title} (cont.)`, titleColor) +
        `<g font-size="12.5"><rect x="1000" y="${ry + 12}" width="560" height="${h}" fill="${st.fill}" stroke="${st.stroke}"/>` +
        chunk.map((l, i) => `<text x="1014" y="${ry + st.first + i * st.pitch}" fill="${l == null ? "#999" : st.colorOf(l)}" xml:space="preserve">${esc(l ?? st.empty)}</text>`).join("") + `</g>`);
      ry += 12 + h + 44; first = false;
      if (!rest.length) break;
      nextSheet();
    }
  };

  const reserved = [];
  for (const c of s.sol.connections || []) if ((c.scope || "included") !== "included" && c.signal === "speaker") {
    const chs = expandChannels(c.channels || "");
    reserved.push(`${s.devices[c.from] ? devName(s.devices[c.from]) : nameOf(job, s, c.from)} ${chs.length ? `ch ${chs[0]}–${chs[chs.length - 1]}` : ""} reserved`);
  }
  const pre = rolled.filter(r => r.status === "prewire");
  box("PRE-WIRE ONLY", "#8a8a8a",
    [...pre.map(r => `${r.where} — ${r.label.replace("Speakers, ", "")}, wire only`), ...reserved].flatMap(l => wrapText(l, 76)),
    { pitch: 20, first: 34, fill: "#f0f0f2", stroke: "#c8ccd4", colorOf: () => "#666", empty: "— none —" });

  const confirms = [];
  for (const z of job.house.zones) for (const ep of z.endpoints || [])
    if (ep.confirm?.length) confirms.push(`${z.name} ${ep.type === "display" ? "TV" : "speakers"} ${ep.confirm.join("/")} — drawn as ${ep.size ? ep.size + '"' : "?"}, verify before ordering`);
  box("NEEDS CONFIRMATION", "#b32017", confirms.flatMap(l => wrapText(l, 76)),
    { pitch: 20, first: 34, fill: "#fff9ec", stroke: "#e2c78a", colorOf: () => "#7a5a12", empty: "— none —" });

  const licLines = [];
  for (const lic of (adviseResult?.licensing || []).filter(mine)) {
    licLines.push(`${lic.platform}: ${lic.pick}`);
    for (const l of lic.lines || []) if (l) licLines.push(l.length > 66 ? l.slice(0, 64) + "…" : l);
  }
  for (const n of (adviseResult?.notes || []).filter(n => n.code === "savant-host" && mine(n))) licLines.push(n.msg);
  if (job.job?.catalogSnapshot?.asOf) licLines.push(`Prices dealer-gated; catalog as of ${job.job.catalogSnapshot.asOf}`);
  box("LICENSING & RECURRING", "#111", licLines,
    { pitch: 22, first: 36, fill: "#fbfbfc", stroke: "#c8ccd4", colorOf: l => l.startsWith("Prices") ? "#888" : "#222", empty: "No control platform selected" });

  return assemble(job, opts, "Equipment & Takeoff", "Rolled-up quantities by procurement status — quote reference (CSV export available)", bodies, label,
    k => k ? "" : `<text x="40" y="920" font-size="11.5" font-style="italic" fill="#767676">Quantities are rolled up from the schematic — every icon and run on Sheet 1 appears here exactly once.</text>`);
}
export function renderTakeoff(job, ix, adviseResult, opts = {}) {
  return takeoffPages(job, ix, adviseResult, opts, () => opts.sheetLabel || "")[0];
}

/* ============ PAGE: WIRE SCHEDULE ============ */
export function wireRuns(job, ix, opts = {}) {
  const s = ix.solutions[opts.solution ?? 0];
  const sol = s.sol;
  const rackName = (sol.racks || [])[0]?.name || "Equipment Rack";
  const runs = []; // {prefix, cable, from, to, carries, carriesColor, term, count, gray}
  const spkCable = ep => {
    const c = ep?.config || "stereo";
    if (c === "landscape") return "14/2 DB";
    if (c.startsWith("surround")) return "14/2";
    return "16/2";
  };
  for (const c of sol.connections || []) {
    const gray = (c.scope || "included") !== "included";
    const toComp = servesEp(s, c.to);
    const toEp = ix.endpointsById[c.to];
    const fromEp = ix.endpointsById[c.from];
    if (s.locals[c.from]) continue;                      // in-room link, not a pull
    if (c.dante) {                                       // Dante: a network drop, not an audio pull
      const comp = s.companions[c.from];
      if (comp && (comp.type === "axis" || comp.type === "axis16") && !runs.some(r => r.danteFrom === comp.id)) {
        const dsw = Object.values(s.devices).find(d => d.danteSwitch);
        runs.push({ prefix: "N", cable: "Cat6", from: `${zoneName(ix, comp.serves)} — TV location`, to: dsw ? devName(dsw) : rackName,
          carries: `Dante audio (${adapterName(comp)})`, color: "#2b6cb8", term: "RJ45 (PoE) at the AXIS", count: 1, gray, danteFrom: comp.id });
      }
      continue;                                          // DANTE-DV2 rides its video cable (VLAN 99); rack Dante gear is patched in the rack
    }
    if (c.signal === "audioReturn" && s.companions[c.to]) continue;   // TV eARC into its AXIS — an HDMI at the TV
    if (c.signal === "video" && toComp) {                // rack video feed to a display chip
      runs.push({ prefix: "V", cable: "Cat6", from: rackName, to: `${zoneName(ix, toComp.serves)} — TV location`,
        carries: `${toComp.type === "balun" ? "Video (HDBaseT)" : "Video (MXNet)"}${toComp.dante ? " + Dante (VLAN 99)" : ""}${c.earc ? " + eARC back" : ""}`, color: "#b32017",
        term: `${adapterName(toComp)} at TV`, count: 1, gray });
    } else if (c.signal === "video" && toEp && s.devices[c.from]) {   // direct rack → display (no extender chip drawn)
      runs.push({ prefix: "V", cable: "HDMI / extender", from: rackName, to: `${zoneName(ix, c.to)} — TV location`,
        carries: `Video (direct)${c.earc ? " + eARC back" : ""}`, color: "#b32017", term: "TV input — verify run length", count: 1, gray });
    } else if (c.signal === "speaker" && toEp) {
      const ep = toEp;
      // "surround-7.1.4" = 7 bed + 4 heights; the ".1" sub rides its own RG6 run
      const sm = String(ep.config || "").match(/^surround-(\d+)\.1(?:\.(\d+))?$/);
      const n = ep.config === "mono" ? 1 : sm ? +sm[1] + (+sm[2] || 0) :
        ep.config === "landscape" ? cnt(ep.satCount, 4) : ep.config?.startsWith("soundbar") ? 0 : cnt(ep.count, 2);
      const amp = s.devices[c.from];
      const chs = expandChannels(c.channels || "");
      if (n > 0) runs.push({ prefix: "S", legs: speakerLegs(ep, n, sm), zone: zoneName(ix, c.to), cable: `${spkCable(ep)} ×${n}`, from: rackName,
        to: `${zoneName(ix, c.to)} — ${ep.config === "landscape" ? "landscape array" : n > 2 ? "speaker set" : "ceiling pair"}`,
        carries: gray ? "PRE-WIRE — coil & label" : "Speaker level", color: gray ? null : "#1a5fa0",
        term: `${amp?.model || nameOf(job, s, c.from)}${chs.length ? ` ch ${chs[0]}–${chs[chs.length - 1]}` : ""}${gray ? " (reserved)" : ""}`, count: n, gray });
      // subs: surround + 2.1 take an RG6/LFE home run; a landscape buried sub
      // is amp-powered on its own speaker pair; a soundbar's sub is wireless
      if (sm || ep.config === "2.1" || ep.config === "stereo-2.1")
        runs.push({ prefix: "S", cable: "RG6 / LFE", from: rackName, to: `${zoneName(ix, c.to)} — sub location`,
          carries: gray ? "PRE-WIRE — coil & label" : "Sub feed", color: gray ? null : "#1a5fa0",
          term: `${amp ? devName(amp) : nameOf(job, s, c.from)} sub out`, count: 1, gray });
      else if (ep.config === "landscape" && ep.buriedSub)
        runs.push({ prefix: "S", cable: "14/2 DB", from: rackName, to: `${zoneName(ix, c.to)} — buried sub`,
          carries: gray ? "PRE-WIRE — coil & label" : "Sub (speaker level)", color: gray ? null : "#1a5fa0",
          term: `${amp ? devName(amp) : nameOf(job, s, c.from)}${chs.length ? ` ch ${chs[0]}–${chs[chs.length - 1]}` : ""}`, count: 1, gray });
    } else if (c.signal === "audioReturn" && fromEp) {
      if (s.locals[c.to] || ix.endpointsById[c.to]) continue;   // handled at the TV (local encoder / soundbar) — no pull
      runs.push({ prefix: "R", cable: "Optical (Toslink)", from: `${zoneName(ix, c.from)} — TV location`, to: rackName,
        carries: c.backup ? "Audio return — optical backup to eARC" : "Audio return", color: "#a45a12", term: s.devices[c.to]?.model || nameOf(job, s, c.to), count: 1, gray });
    } else if (c.signal === "network" && (toEp || servesEp(s, c.to))) {
      runs.push({ prefix: "N", cable: "Cat6", from: rackName, to: zoneName(ix, toEp ? c.to : s.companions[c.to].serves), carries: "Network", color: "#2f9e44", term: "RJ45", count: 1, gray });
    }
  }
  // every TV takes an Ethernet drop of its own (smart-TV apps, control, updates)
  for (const z of job.house?.zones || []) {
    if ((z.scope || "included") === "future") continue;
    for (const e of z.endpoints || []) if (e.type === "display")
      runs.push({ prefix: "N", cable: "Cat6", from: rackName, to: `${z.name} — TV location`,
        carries: `Network (${e.displayType === "projector" ? "projector" : "TV"})`, color: "#2f9e44", term: "RJ45 at TV", count: 1,
        gray: (z.scope || "included") !== "included" });
  }
  // local streaming devices always need a network drop at the display
  for (const d of sol.localDevices || []) {
    if (d.location !== "at-display") continue;
    const z = ix.zonesById[d.zone];
    runs.push({ prefix: "N", cable: "Cat6", from: rackName, to: `${z?.name || "(zone removed)"} — TV location`,
      carries: `Network (${devName(d)})`, color: "#2f9e44", term: "RJ45 at TV", count: 1,
      gray: (z?.scope || "included") !== "included" });   // a puck in a pre-wire room is a pre-wire drop
  }
  // deterministic numbering per prefix, non-gray first within prefix order V,N,R,S
  const order = { V: 0, N: 1, R: 2, S: 3 };
  runs.sort((a, b) => order[a.prefix] - order[b.prefix] || (a.gray ? 1 : 0) - (b.gray ? 1 : 0));
  const counters = {};
  for (const r of runs) {
    const start = (counters[r.prefix] || 0) + 1;
    counters[r.prefix] = start + r.count - 1;
    r.first = start;
    r.id = r.count > 1 ? `${r.prefix}-${String(start).padStart(2, "0")}…${String(counters[r.prefix]).padStart(2, "0")}`
                       : `${r.prefix}-${String(start).padStart(2, "0")}`;
  }
  return runs;
}

// one name per speaker wire, the way a tech labels them at the rack
function speakerLegs(ep, n, sm) {
  if (sm) {
    const bed = { 5: ["FL", "FR", "C", "SL", "SR"], 7: ["FL", "FR", "C", "SL", "SR", "SBL", "SBR"] }[+sm[1]]
      || Array.from({ length: +sm[1] }, (_, i) => `CH ${i + 1}`);
    const tops = { 2: ["TFL", "TFR"], 4: ["TFL", "TFR", "TRL", "TRR"] }[+sm[2] || 0]
      || Array.from({ length: +sm[2] || 0 }, (_, i) => `HT ${i + 1}`);
    return [...bed, ...tops].slice(0, n);
  }
  if (ep.config === "landscape") return Array.from({ length: n }, (_, i) => `SAT ${i + 1}`);
  if (n === 1) return ["SPK"];
  if (n === 2) return ["L", "R"];
  return Array.from({ length: n }, (_, i) => `SPK ${i + 1}`);
}

/* ============ CABLE LABELS ============
   One label per wire, both ends (copies: 2): the wire schedule's run ids,
   speaker runs split per wire (S-05 FL … S-09 SR). The CSV imports into
   label-printer software (Brady Workstation, P-touch Editor database). */
export function cableLabels(job, ix, opts = {}) {
  const out = [];
  const pad = n => String(n).padStart(2, "0");
  const shortTo = t => String(t).replace(/ — TV location$/, " TV").replace(/ — (buried )?sub( location)?$/, (m, b) => b ? " BURIED SUB" : " SUB").replace(/ — /g, " · ");
  for (const r of wireRuns(job, ix, opts)) {
    const field = String(r.from).includes(" — ") ? r.from : r.to;   // the end that isn't the rack (returns run field → rack)
    const base = { cable: r.cable.split(" ×")[0], from: r.from, to: r.to, carries: r.carries, prewire: !!r.gray, copies: 2 };
    if (r.legs?.length) r.legs.forEach((leg, i) => out.push({ ...base, id: `${r.prefix}-${pad(r.first + i)}`, line1: `${r.zone} ${leg}`, line2: `${r.term.replace(/ ch \d+–\d+/, "")}` }));
    else if (r.count > 1) for (let i = 0; i < r.count; i++) out.push({ ...base, id: `${r.prefix}-${pad(r.first + i)}`, line1: shortTo(field), line2: `${r.carries} ${i + 1}/${r.count}` });
    else out.push({ ...base, id: r.id, line1: shortTo(field), line2: r.carries });
  }
  return out;
}
export function labelsCSV(job, ix, opts = {}) {
  const q = s => { let v = String(s ?? ""); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return `"${v.replace(/"/g, '""')}"`; };
  return ["Label,Line 1,Line 2,Cable,From,To,Copies,Pre-wire"].concat(cableLabels(job, ix, opts).map(l =>
    [q(l.id), q(l.line1), q(l.line2), q(l.cable), q(l.from), q(l.to), l.copies, l.prewire ? "yes" : ""].join(","))).join("\n");
}
function labelPages(job, ix, opts, label) {
  const labels = cableLabels(job, ix, opts);
  if (!labels.length) return [];
  // 4 across × 8 down per sheet; each wire prints twice (one per end), side by side
  const cw = 372, ch = 92, gx = 16, gy = 14, perRow = 4, rows = Math.floor((LIMIT - TOP) / (ch + gy));
  const cards = labels.flatMap(l => [l, l]);
  const bodies = [];
  for (let k = 0; k < cards.length; k += perRow * rows) {
    bodies.push(cards.slice(k, k + perRow * rows).map((l, i) => {
      const x = 40 + (i % perRow) * (cw + gx), y = TOP + Math.floor(i / perRow) * (ch + gy);
      const fit = (t, n) => String(t).length > n ? String(t).slice(0, n - 1) + "…" : String(t);
      return `<g><rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="6" fill="${l.prewire ? "#f4f4f6" : "#fff"}" stroke="#9aa" stroke-dasharray="4 3"/>
<text x="${x + 14}" y="${y + 34}" font-size="26" font-weight="700" fill="#111">${esc(l.id)}</text>
<text x="${x + cw - 14}" y="${y + 30}" text-anchor="end" font-size="11" fill="#666">${esc(fit(l.cable, 22))}</text>
<text x="${x + 14}" y="${y + 58}" font-size="14" fill="#222">${esc(fit(l.line1, 40))}</text>
<text x="${x + 14}" y="${y + 78}" font-size="11.5" fill="#666">${esc(fit(l.line2 + (l.prewire ? " · PRE-WIRE" : ""), 52))}</text></g>`;
    }));
  }
  return assemble(job, opts, "Cable Labels", "One label per wire, two copies — rack end and field end. Run IDs match the wire schedule.", bodies, label,
    () => `<text x="40" y="920" font-size="11.5" font-style="italic" fill="#767676">Cut on the dashed lines, or print the Labels CSV on a label printer (Brady Workstation / P-touch Editor import). Gray = pre-wire.</text>`);
}

function wireSchedulePages(job, ix, opts, label) {
  const runs = wireRuns(job, ix, opts);
  const HEAD = `<rect x="40" y="120" width="1520" height="30" fill="#16181c"/>
<g fill="#fff" font-weight="600"><text x="58" y="140">✓</text><text x="100" y="140">Run</text><text x="170" y="140">Cable</text><text x="330" y="140">From</text><text x="520" y="140">To</text><text x="900" y="140">Carries</text><text x="1200" y="140">Terminates</text></g>`;
  const bodies = [];
  let body = null, ry = 0;
  const open = () => { body = [`<g font-size="12.5">${HEAD}`]; bodies.push(body); ry = 150; };
  const close = () => body.push(`<rect x="40" y="120" width="1520" height="${ry - 120}" fill="none" stroke="#c8ccd4"/></g>`);
  open();
  runs.forEach((r, i) => {
    if (ry + 27 > LIMIT) { close(); open(); }
    const fill = r.gray ? "#f0f0f2" : i % 2 ? "#fff" : "#fbfbfc";
    body.push(`<rect x="40" y="${ry}" width="1520" height="27" fill="${fill}"/>
<rect x="54" y="${ry + 6}" width="14" height="14" fill="none" stroke="#aab"/>
<g fill="${r.gray ? "#8a8a8a" : "#222"}">
<text x="100" y="${ry + 19}">${esc(r.id)}</text><text x="170" y="${ry + 19}">${esc(r.cable)}</text>
<text x="330" y="${ry + 19}">${esc(r.from)}</text><text x="520" y="${ry + 19}">${esc(String(r.to).length > 52 ? String(r.to).slice(0, 50) + "…" : r.to)}</text>
<text x="900" y="${ry + 19}"${r.color ? ` fill="${r.color}"` : ""}${r.gray ? ' font-weight="600"' : ""}>${esc(r.carries)}</text>
<text x="1200" y="${ry + 19}">${esc(r.term)}</text></g>`);
    ry += 27;
  });
  close();

  const byCable = {};
  let total = 0, grayCount = 0;
  for (const r of runs) { byCable[r.cable.split(" ×")[0]] = (byCable[r.cable.split(" ×")[0]] || 0) + r.count; total += r.count; if (r.gray) grayCount += r.count; }
  const totals = Object.entries(byCable).map(([c, n]) => `${c} ×${n}`).join(" · ");
  // totals ride right under the last row; if the sheet is full they open the next one
  if (ry + 40 > LIMIT) { bodies.push([]); body = bodies[bodies.length - 1]; ry = TOP; }
  body.push(`<g font-size="12" fill="#555"><text x="40" y="${ry + 40}" font-weight="700">Totals:</text>
<text x="110" y="${ry + 40}">${esc(totals)} — ${total} home runs${grayCount ? ` (${grayCount} pre-wire)` : ""}</text></g>`);
  return assemble(job, opts, "Wire Schedule", "Pull sheet — every home run, derived from the schematic. Check off as pulled.", bodies, label,
    () => `<text x="40" y="920" font-size="11.5" font-style="italic" fill="#767676">Run IDs: V = video, N = network, R = audio return, S = speaker. Gray rows are pre-wire scope. Generated from the schematic — no run exists here that isn't drawn on Sheet 1.</text>`);
}
export function renderWireSchedule(job, ix, opts = {}) {
  return wireSchedulePages(job, ix, opts, () => opts.sheetLabel || "")[0];
}

/* ---------- packet assembly (pages 2..N; page 1 comes from engine render) ---------- */
/* ============ PAGE: SOLUTION COMPARISON (BOM compare) ============
   Side-by-side equipment across the job's Solutions — the proposal-meeting
   page the House/Solution split was designed for. Each column runs through
   that solution's OWN effective house, so per-solution overrides (an 85"
   in Better where Good has a 75") appear as real line-item differences.
   Licensing rows come from adviseResult filtered by solution id. */
function bomComparePages(job, ix, adviseResult, opts, label) {
  // callers in the editor pass the active-solution-effective job; columns must
  // derive from the RAW job or the active solution's overrides would leak into
  // every column — opts.rawJob carries it when the two differ
  const base = opts.rawJob || job;
  const sols = (base.solutions || []).slice(0, 4);         // 4 columns max on 11×17
  const cols = sols.map((sol, i) => {
    const ej = effectiveJob(base, i);
    return { sol, ej, items: takeoffItems(ej, indexJob(ej), { solution: i }) };
  });
  // union of line items, grouped NEW → OFE → PRE-WIRE, in first-appearance order
  const order = { new: 0, ofe: 1, prewire: 2 };
  const keys = [], seen = new Set();
  for (const c of cols) for (const it of c.items) {
    const k = it.status + "|" + it.label;
    if (!seen.has(k)) { seen.add(k); keys.push({ k, label: it.label, status: it.status }); }
  }
  keys.sort((a, b) => order[a.status] - order[b.status]);
  const qtyOf = (c, key) => c.items.find(it => it.status + "|" + it.label === key.k)?.qty || 0;

  const x = 40, wLabel = 620, wCol = Math.min(240, (1552 - wLabel) / cols.length);
  const wTot = wLabel + wCol * cols.length;
  const bodies = [];
  let body = null, y = 0;
  // every sheet repeats the column header so a continuation page stands alone
  const open = () => {
    body = []; bodies.push(body); y = 130;
    body.push(`<g font-size="12.5"><rect x="${x}" y="${y}" width="${wTot}" height="34" fill="#16181c"/>`);
    body.push(`<text x="${x + 14}" y="${y + 22}" fill="#fff" font-weight="600">Item</text>`);
    cols.forEach((c, i) => body.push(`<text x="${x + wLabel + i * wCol + wCol / 2}" y="${y + 22}" text-anchor="middle" fill="#fff" font-weight="600">${esc(c.sol.name || c.sol.id)}</text>`));
    body.push(`</g>`);
    y += 34;
  };
  open();

  let lastStatus = null, diffs = 0;
  const SECT = { new: ["NEW — Supplied & Installed", "#1a6fb5"], ofe: ["OWNER FURNISHED", "#4a7040"], prewire: ["PRE-WIRE ONLY", "#8a8a8a"] };
  const section = status => {
    const [t, col] = SECT[status] || [status, "#666"];
    body.push(`<rect x="${x}" y="${y}" width="${wTot}" height="24" fill="#eef0f4"/>` +
      `<text x="${x + 14}" y="${y + 17}" font-size="11" font-weight="700" letter-spacing="1" fill="${col}">${esc(t)}</text>`);
    y += 24;
  };
  for (const key of keys) {
    const newSect = key.status !== lastStatus;
    if (y + (newSect ? 24 : 0) + 26 > LIMIT) { open(); if (!newSect) section(key.status); }   // continued section re-labels itself
    if (newSect) { lastStatus = key.status; section(key.status); }
    const qtys = cols.map(c => qtyOf(c, key));
    const differs = new Set(qtys).size > 1;
    if (differs) diffs++;
    body.push(`<rect x="${x}" y="${y}" width="${wTot}" height="26" fill="${differs ? "#fff9ec" : "#fff"}"/>`);
    body.push(`<text x="${x + 14}" y="${y + 18}" font-size="12.5" fill="#222">${esc(key.label.length > 74 ? key.label.slice(0, 72) + "…" : key.label)}</text>`);
    qtys.forEach((q, i) => body.push(`<text x="${x + wLabel + i * wCol + wCol / 2}" y="${y + 18}" text-anchor="middle" font-size="12.5"` +
      `${differs ? ' font-weight="700"' : ""} fill="${q ? (differs ? "#a45a12" : "#222") : "#bbb"}">${q || "—"}</text>`));
    y += 26;
  }

  // summary block: zone scopes + licensing per column
  const sumRows = [];
  sumRows.push(["Zones (included / pre-wire / future)", ...cols.map(c => {
    const n = { included: 0, prewire: 0, future: 0 };
    for (const z of c.ej.house.zones) n[z.scope || "included"] = (n[z.scope || "included"] || 0) + 1;
    return `${n.included} / ${n.prewire} / ${n.future}`;
  })]);
  const plats = [...new Set(cols.flatMap(c => c.sol.platforms || []))];
  for (const p of plats) sumRows.push([`Licensing — ${p}`, ...cols.map(c => {
    const lic = (adviseResult?.licensing || []).find(l => l.platform === p && (!l.solution || l.solution === c.sol.id));
    return (c.sol.platforms || []).includes(p) ? (lic?.pick || "—") : "—";
  })]);
  const sumH = sumRows.length * 26 + 8;
  if (y + 10 + sumH > LIMIT) open();
  y += 10;
  body.push(`<g font-size="12.5"><rect x="${x}" y="${y}" width="${wTot}" height="${sumH}" fill="#fbfbfc" stroke="#c8ccd4"/>`);
  sumRows.forEach((rw, ri) => {
    body.push(`<text x="${x + 14}" y="${y + 22 + ri * 26}" fill="#555" font-weight="600">${esc(rw[0])}</text>`);
    const differs = new Set(rw.slice(1)).size > 1;
    rw.slice(1).forEach((v, i) => body.push(`<text x="${x + wLabel + i * wCol + wCol / 2}" y="${y + 22 + ri * 26}" text-anchor="middle"` +
      `${differs ? ' font-weight="700" fill="#a45a12"' : ' fill="#222"'}>${esc(v)}</text>`));
  });
  body.push(`</g>`);

  const note = `${diffs ? `${diffs} line item${diffs > 1 ? "s" : ""} differ${diffs > 1 ? "" : "s"} between solutions (highlighted).` : "Solutions are currently identical."}` +
    `${(base.solutions || []).length > 4 ? ` Showing first 4 of ${base.solutions.length} solutions.` : ""}`;
  return assemble(job, opts, "Solution Comparison", "Side-by-side equipment across proposed options — highlighted rows differ between solutions", bodies, label,
    (k, n) => k === n - 1 ? `<text x="${x}" y="920" font-size="11.5" font-style="italic" fill="#767676">${esc(note)}</text>` : "");
}
export function renderBomCompare(job, ix, adviseResult, opts = {}) {
  return bomComparePages(job, ix, adviseResult, opts, () => opts.sheetLabel || "")[0];
}

/* ============ PAGE: RACK ============
   Everything about the rack on its own sheet (one per rack): the front
   elevation on the left; on the right the summary, the rack hardware the
   elevation implies (part numbers the job hasn't filled in print "?"), and —
   on the first rack — the power table: outlets, watts (typical / max, "?"
   where nobody has a figure yet), circuit load and heat. All of it comes from
   advise() (rack.js + power.js); the editor's RACK tab edits the same data. */
const RACK_FILL = { patch: "#e8f0fb", vent: "#eceef1", shelf: "#f7f3e8" };
const TIER_FILL = ["#e8f0fb", "#e6f4ea", "#ecebf8", "#f7f3e8", "#f6e9e7", "#fdf0d2"];
const Q = { text: "?", color: "#a45a12" };
// the rack body: frame, U numbers, gear top-down, amps/power on the floor
function drawRack(r, rx, top, rw, uPx) {
  const out = [];
  const rows = Math.max(r.size, r.used), h = rows * uPx;
  out.push(`<rect x="${rx}" y="${top}" width="${rw}" height="${h}" fill="#f4f5f7" stroke="#333" stroke-width="2"/>`);
  if (r.over) out.push(`<rect x="${rx}" y="${top + r.size * uPx}" width="${rw}" height="${(rows - r.size) * uPx}" fill="#fbe3e1"/>
<line x1="${rx - 6}" y1="${top + r.size * uPx}" x2="${rx + rw + 6}" y2="${top + r.size * uPx}" stroke="#b32017" stroke-width="2"/>`);   // the rack floor; red below = doesn't fit
  for (let u = 0; u < rows; u++) {
    const y = top + u * uPx, n = r.size - u;
    out.push(`<line x1="${rx}" y1="${y}" x2="${rx + rw}" y2="${y}" stroke="#dde0e5" stroke-width="0.6"/>`);
    if (n >= 1 && (uPx >= 14 || n % 2 === 1)) out.push(`<text x="${rx - 8}" y="${y + uPx * 0.72}" text-anchor="end" font-size="${Math.min(10, uPx * 0.6)}" fill="#888">${n}</text>`);
  }
  // gear dresses the top; amps, receivers and power sit on the floor of the rack
  // (only when it all fits — an over-full rack just stacks in order)
  const low = r.over ? [] : r.items.filter(i => i.tier >= 4);
  const lowStart = top + (r.size - low.reduce((n, i) => n + i.u, 0)) * uPx;
  let y = top;
  for (const it of r.items) {
    if (it === low[0]) y = lowStart;
    const ih = it.u * uPx;
    const fill = RACK_FILL[it.kind] || TIER_FILL[it.tier] || "#fff";
    const fs = Math.max(7, Math.min(12, ih * 0.62));
    const maxCh = Math.floor((rw - 40) / (fs * 0.56));
    const text = it.label.length > maxCh ? it.label.slice(0, maxCh - 1) + "…" : it.label;
    out.push(`<rect x="${rx + 2}" y="${y + 1}" width="${rw - 4}" height="${ih - 2}" rx="2" fill="${fill}" stroke="${it.guess ? "#a45a12" : "#8a93a3"}"${it.guess ? ' stroke-dasharray="4 3"' : ""}/>` +
      (it.kind === "vent" ? `<g stroke="#b9bec7">${Array.from({ length: Math.floor((rw - 90) / 30) }, (_, i) => `<line x1="${rx + 60 + i * 30}" y1="${y + 4}" x2="${rx + 60 + i * 30}" y2="${y + ih - 4}"/>`).join("")}</g>` : "") +
      `<text x="${rx + 12}" y="${y + ih / 2 + fs * 0.36}" font-size="${fs}" fill="${it.kind === "vent" ? "#888" : "#222"}"${it.kind === "device" ? ' font-weight="600"' : ""}>${esc(text)}</text>` +
      `<text x="${rx + rw - 10}" y="${y + ih / 2 + 4}" text-anchor="end" font-size="${Math.min(10, fs)}" fill="${it.guess ? "#a45a12" : "#888"}">${it.guess ? "?U" : `${it.u}U`}</text>`);
    y += ih;
  }
  return out;
}
// a standalone front view for the editor's RACK tab
export function rackFrontSVG(r, rw = 300) {
  const uPx = 14, top = 6, rows = Math.max(r.size, r.used);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rw + 40} ${rows * uPx + 12}" width="100%" font-family="'Avenir Next', Avenir, 'Helvetica Neue', sans-serif">${drawRack(r, 30, top, rw, uPx).join("")}</svg>`;
}
export function rackData(adviseResult, solId) {
  return { racks: (adviseResult?.racks || []).filter(r => r.solution === solId && (r.items.length || r.rear.length)),
           power: (adviseResult?.power || []).find(p => p.solution === solId) || null };
}
function rackPages(job, ix, adviseResult, opts, label) {
  const s = ix.solutions[opts.solution ?? 0];
  const { racks, power } = rackData(adviseResult, s?.sol.id);
  if (!racks.length) return [];
  const clip = (v, n) => String(v).length > n ? String(v).slice(0, n - 1) + "…" : String(v);
  const bodies = [];
  const RX = 560, RW = 1000;                           // right column
  racks.forEach((r, k) => {
    let body = []; bodies.push(body);
    const top = TOP + 34, rw = 380;
    const uPx = Math.min(20, Math.floor((LIMIT - top - 10) / Math.max(r.size, r.used)));
    body.push(heading(40, TOP + 8, `${r.name} — ${r.size}U`), ...drawRack(r, 80, top, rw, uPx));
    let y = TOP;
    const more = () => { body = []; bodies.push(body); y = TOP; };
    const text = (lines) => {
      if (y + lines.length * 18 > LIMIT) more();
      body.push(`<g font-size="12.5">${lines.map(([t, c = "#333", b], i) => `<text x="${RX}" y="${y + 14 + i * 18}" fill="${c}"${b ? ' font-weight="700"' : ""} xml:space="preserve">${esc(t)}</text>`).join("")}</g>`);
      y += lines.length * 18 + 16;
    };
    const table = (title, sub, cols, rows) => {
      let rest = [...rows], first = true;
      while (rest.length) {
        if (y + 60 + Math.min(3, rest.length) * 22 > LIMIT) more();
        body.push(heading(RX, y + 8, first ? title : `${title} (cont.)`));
        if (first && sub) body.push(`<text x="${RX}" y="${y + 28}" font-size="12" fill="#555">${esc(sub)}</text>`);
        const t = tableFit(RX, y + (first && sub ? 38 : 20), RW, cols, rest, 22);   // compact rows: a typical rack fits one sheet
        body.push(t.svg); rest = t.rest; y = t.bottom + 26; first = false;
        if (rest.length) more();
      }
    };
    text([
      [`${r.used}U used · ${r.over ? `${r.over}U OVER` : `${r.spare}U spare`} of ${r.size}U`, r.over ? "#b32017" : "#111", true],
      [`Cat6 home runs: ${r.cat6}${r.cat6 ? ` → ${Math.ceil(r.cat6 / 24)} patch panel${Math.ceil(r.cat6 / 24) > 1 ? "s" : ""}` : ""}`],
      ...(r.rear.length ? [[`Rear rails (no U): ${r.rear.join(", ")}`]] : []),
      ...(r.unknown.length ? [[`Height unknown (?U, drawn 1U): ${clip(r.unknown.join(", "), 110)}`, "#a45a12"]] : []),
      ...r.items.filter(i => i.kind === "shelf").map((i, n) => [`${i.kit || `Shelf ${n + 1}`}: ${clip(i.members.join(", "), 110)}`, "#555"]),
    ]);
    table("Rack hardware", "What the elevation needs beyond the gear — ? = part number to fill in",
      [{ label: "Item", dx: 14 }, { label: "Qty", dx: 520 }, { label: "Part no.", dx: 600 }],
      r.hardware.map(h => ({ cells: [h.item, String(h.qty), h.partNo || Q] })));
    if (k === 0 && power) {
      const units = power.units.length ? power.units.map(u => `${u.model}${u.outlets != null ? ` (${u.outlets} outlets)` : ""}`).join(" + ") : "No power conditioner";
      const verdict = power.supply == null ? (power.units.length ? "outlet count ?" : `spec ${power.pick ? `${power.pick.qty > 1 ? power.pick.qty + " × " : ""}${power.pick.model}` : "a WattBox"}`)
        : power.short ? `${power.short} SHORT` : `${power.supply - power.need} spare${power.tight ? ` (aim for ${power.spare})` : ""}`;
      const W = v => v == null ? Q : String(v);
      const rows = power.loads.map(l => ({ cells: [clip(l.what, 60), String(l.outlets), W(l.typicalW), W(l.maxW), l.why] }));
      if (power.poe.length) rows.push({ gray: true, cells: [clip(`PoE-powered (no outlet): ${power.poe.map(p => p.what).join(", ")}`, 72), "0", "", "", "from its switch"] });
      table("Power & heat", `${units} · ${power.need} outlets · ${verdict} · ~${power.typicalW}${power.noWatts.length ? "+" : ""} W typ / ${power.maxW}${power.noWatts.length ? "+" : ""} W max of ${power.circuitW} W (${power.circuits > 1 ? `${power.circuits} × ` : ""}${power.circuitA}A) · ~${power.btu.toLocaleString("en-US")} BTU/hr`,
        [{ label: "Device", dx: 14 }, { label: "Outlets", dx: 520 }, { label: "Typ W", dx: 610 }, { label: "Max W", dx: 700 }, { label: "Note", dx: 790 }], rows);
      const notes = [];
      if (power.noWatts.length) notes.push([`? = no wattage on file for ${power.noWatts.length} box${power.noWatts.length > 1 ? "es" : ""} — totals are a floor until filled in (RACK tab)`, "#a45a12"]);
      if (power.cooling) notes.push([power.cooling === "room" ? "Heat: plan room cooling (HVAC supply + return or a dedicated unit) plus rack fans" : "Heat: plan a top-exhaust rack fan and a vented door or closet", "#a45a12", true]);
      if (notes.length) text(notes);
    }
  });
  return assemble(job, opts, "Rack", "Elevation, rack hardware, power and heat — ? = not known yet, fill in on the RACK tab", bodies, label,
    () => `<text x="40" y="920" font-size="11.5" font-style="italic" fill="#767676">Build order top to bottom: patch panels, network, control/processing, sources on shelves / rack kits, receivers + amps (1U vent under each), power. Typical W = 1/8 power or the maker's typical; heat = typical W × 3.412 BTU/hr.</text>`);
}

/* ============ PAGE: NETWORK ============
   The switch port plan (network.js), computed by advise(). Two columns; long
   tables continue under a "(cont.)" heading. (Power moved to the Rack page.) */
export function networkPowerData(adviseResult, solId) {
  return { net: (adviseResult?.network || []).filter(p => p.solution === solId),
           power: (adviseResult?.power || []).find(p => p.solution === solId) || null };
}
function networkPowerPages(job, ix, adviseResult, opts, label) {
  const s = ix.solutions[opts.solution ?? 0];
  const { net } = networkPowerData(adviseResult, s?.sol.id);
  if (!net.length) return [];
  // two columns like the channel map: a block goes in the shorter column; a
  // table that won't fit splits, and its rest continues under "(cont.)"
  const colX = [40, 820], W2 = 740;
  const bodies = [[]];
  let colY = [TOP, TOP];
  const newSheet = () => { bodies.push([]); colY = [TOP, TOP]; };
  const put = svg => bodies[bodies.length - 1].push(svg);
  const block = (title, sub, cols, rows, after = [], lead = "Set up:") => {
    let rest = [...rows], first = true;
    for (let guard = 0; guard < 200; guard++) {
      const subs = first && sub ? [].concat(sub) : [];
      const head = 20 + subs.length * 18;
      const order = colY[0] <= colY[1] ? [0, 1] : [1, 0];
      let c = order.find(k => Math.floor((LIMIT - (colY[k] + head + 30)) / 28) >= Math.min(3, rest.length || 1));
      if (c == null) { if (bodies[bodies.length - 1].length) { newSheet(); continue; } c = 0; }
      const x = colX[c], y = colY[c];
      put(heading(x, y + 8, first ? title : `${title} (cont.)`));
      subs.forEach((line, i) => put(`<text x="${x}" y="${y + 28 + i * 18}" font-size="12" fill="#555">${esc(line)}</text>`));
      const t = tableFit(x, y + head, W2, cols, rest);
      put(t.svg);
      colY[c] = t.bottom; rest = t.rest; first = false;
      if (!rest.length) {
        if (after.length && colY[c] + 10 + after.length * 18 <= LIMIT) {
          put(`<g font-size="12" fill="#444">${after.map((l, i) => `<text x="${x}" y="${colY[c] + 22 + i * 18}">${i ? "·" : lead} ${esc(l)}</text>`).join("")}</g>`);
          colY[c] += 10 + after.length * 18;
        }
        colY[c] += 46;
        break;
      }
      colY[c] = LIMIT;                                   // this column is full
    }
  };
  const short = w => String(w).replace(/ — TV location$/, " TV");
  const cols = [{ label: "Port", dx: 12 }, { label: "Device", dx: 92 }, { label: "Location", dx: 350 }, { label: "Network", dx: 500 }, { label: "Power", dx: 676 }];
  const clip = (v, n) => String(v).length > n ? String(v).slice(0, n - 1) + "…" : String(v);
  for (const p of net) {
    const cap = p.virtual ? `${p.used} Ethernet port${p.used === 1 ? "" : "s"} needed — add a LAN switch (see advisor)`
      : p.known ? `${p.copper ? `${p.copper} RJ45` : ""}${p.copper && p.sfp ? " + " : ""}${p.sfp ? `${p.sfp} SFP` : ""} · ${p.used} used · ${p.over ? `${p.over} SHORT` : `${p.spare} spare`}${p.poeBudgetW ? ` · PoE budget ${p.poeBudgetW} W (${p.poeCount} powered)` : ""}`
      : `${p.used} connection${p.used === 1 ? "" : "s"} · port count not in the catalog`;
    const rows = p.rows.map(r => ({ cells: [r.port == null ? { text: "NONE", color: "#b32017" } : clip(String(r.port).replace(" (RJ45 module)", "*"), 9),
      clip(r.what, 34), clip(short(r.where), 20), clip(r.net.replace("MXNet + Dante (VLAN 99)", "MXNet + VLAN 99"), 24),
      r.power === "PoE" ? "PoE" : r.power ? { text: "PSU", color: "#a45a12" } : ""], tint: r.port == null }));
    block(p.virtual ? "House network (LAN)" : clip(`${p.model} — ${NET_ROLE_NAME[p.role]}`, 60), cap, cols, rows, switchSetup(p));
  }
  if (!bodies[bodies.length - 1].length) bodies.pop();
  return assemble(job, opts, "Network", "Switch ports and networks — every TV and networked box, derived from the schematic", bodies, label,
    () => `<text x="40" y="920" font-size="11.5" font-style="italic" fill="#767676">Every TV and networked box takes an Ethernet port. Suggested assignment: rack gear low, TVs by zone, uplinks on the SFP cages (* = RJ45 SFP module). PoE gear draws from its switch; PSU = PoE device on a non-PoE switch.</text>`);
}

/* ---------- packet assembly (pages 2..N; page 1 comes from engine render) ----------
   Two passes: count every page group's physical sheets, then render with the
   true "Sheet k of N" — a long wire schedule adds sheets, and every label
   (including the main drawing's "1 of N") must agree. */
/* ---------- As-Built Changes ----------
   The numbered list the △ deltas on sheet 1 point to. Removed items have no
   cloud (they aren't drawn any more) — this page is where they're recorded. */
function asBuiltPages(job, ix, opts, label) {
  const raw = opts.rawJob || job;
  const changes = asBuiltChanges(raw);
  const ab = raw.job?.asBuilt || {};
  const ACTION = { added: "Added", removed: "Removed", changed: "Changed" };
  const KIND = { zone: "Room", device: "Gear", chip: "Adapter", wire: "Wire" };
  const rows = changes.length ? changes.map(c => ({ tint: c.action === "removed", cells: [
      { text: `△${c.n}`, color: "#c2410c" }, ACTION[c.action], KIND[c.kind] || c.kind, clipText(c.text, 150)] }))
    : [{ gray: true, cells: ["", "", "", "Built as proposed — no changes from the proposal."] }];
  const cols = [{ label: "△", dx: 14 }, { label: "Change", dx: 80 }, { label: "What", dx: 190 }, { label: "Detail", dx: 290 }];
  const bodies = [];
  let rest = rows;
  do {
    const t = tableFit(40, TOP + 10, 1552, cols, rest, 26);
    bodies.push([t.svg]); rest = t.rest;
  } while (rest.length);
  return assemble(job, opts, "As-Built Changes",
    `Differences from the proposal "${ab.fromName || ""}" (${ab.fromSolution || ""}) · as-built started ${ab.started || ""}`, bodies, label,
    () => `<text x="40" y="920" font-size="11.5" font-style="italic" fill="#767676">△ numbers match the revision clouds on sheet 1. Removed items are listed here only (shaded) — they are no longer on the drawing.</text>`);
}
/* ---------- Install Record ----------
   Serial / MAC / IP / notes per box, rack first then in-room gear. Blank
   cells print as blank so the sheet doubles as a write-in form on site. */
function installPages(job, ix, opts, label) {
  const raw = opts.rawJob || job;
  const recs = installRows(raw, 0);
  const rows = recs.map(r => ({ tint: r.warn.length > 0, cells: [clipText(r.name, 34), clipText(r.where, 22), clipText(r.serial, 24),
    r.mac, clipText(r.ip, 18), clipText([r.notes, ...r.warn.map(w => `⚠ ${w}`)].filter(Boolean).join(" · "), 70)] }));
  if (!rows.length) rows.push({ gray: true, cells: ["", "", "", "", "", "No gear on this job."] });
  const cols = [{ label: "Box", dx: 14 }, { label: "Where", dx: 330 }, { label: "Serial", dx: 520 }, { label: "MAC", dx: 740 }, { label: "IP", dx: 940 }, { label: "Notes", dx: 1090 }];
  const bodies = [];
  let rest = rows;
  do {
    const t = tableFit(40, TOP + 10, 1552, cols, rest, 30);
    bodies.push([t.svg]); rest = t.rest;
  } while (rest.length);
  return assemble(job, opts, "Install Record", `Serial numbers and network addresses as installed · ${recs.filter(r => r.filled).length} of ${recs.length} boxes recorded`, bodies, label,
    () => `<text x="40" y="920" font-size="11.5" font-style="italic" fill="#767676">Recorded on site in SignalPath (JOB → Install record). Blank rows can be filled in by hand. Shaded rows have an address to check.</text>`);
}
const clipText = (t, n) => String(t).length > n ? String(t).slice(0, n - 1) + "…" : String(t);

function pageGroups(job, ix, adviseResult, opts) {
  const flags = pageFlags(job);
  const g = [];
  // the CLIENT packet is a clean handover: the schematic, the equipment list and the rack — no
  // change list, ports, wire schedule or labels (Ryan 2026-09-28: two packets, service + client)
  if (opts.packet === "client") {
    if (flags.equipment) g.push(["Equipment & Takeoff", lbl => takeoffPages(job, ix, adviseResult, opts, lbl)]);
    if (flags.elevation) g.push(["Rack", lbl => rackPages(job, ix, adviseResult, opts, lbl)]);
    return g;
  }
  if (isAsBuilt(opts.rawJob || job)) g.push(["As-Built Changes", lbl => asBuiltPages(job, ix, opts, lbl)], ["Install Record", lbl => installPages(job, ix, opts, lbl)]);
  if (flags.channelMap) g.push(["Channel Map", lbl => channelMapPages(job, ix, opts, lbl)]);
  if (flags.equipment) g.push(["Equipment & Takeoff", lbl => takeoffPages(job, ix, adviseResult, opts, lbl)]);
  if (flags.wireSchedule) g.push(["Wire Schedule", lbl => wireSchedulePages(job, ix, opts, lbl)]);
  if (flags.elevation) g.push(["Rack", lbl => rackPages(job, ix, adviseResult, opts, lbl)]);
  if (flags.network) g.push(["Network", lbl => networkPowerPages(job, ix, adviseResult, opts, lbl)]);
  if (flags.bomCompare && (job.solutions || []).length > 1) g.push(["Solution Comparison", lbl => bomComparePages(job, ix, adviseResult, opts, lbl)]);
  if (flags.labels) g.push(["Cable Labels", lbl => labelPages(job, ix, opts, lbl)]);
  return g;
}
export function sheetTotal(job, ix, adviseResult, opts = {}) {
  return 1 + pageGroups(job, ix, adviseResult, opts).reduce((n, [, fn]) => n + fn(() => "").length, 0);
}
export function renderExtraPages(job, ix, adviseResult, opts = {}) {
  const groups = pageGroups(job, ix, adviseResult, opts);
  const counts = groups.map(([, fn]) => fn(() => "").length);
  const n = 1 + counts.reduce((a, b) => a + b, 0);
  const pages = [];
  let no = 2;
  groups.forEach(([title, fn], gi) => {
    const first = no;
    fn(k => `Sheet ${first + k} of ${n}`).forEach((svg, k) => pages.push({ title: k ? `${title} (cont.)` : title, svg }));
    no += counts[gi];
  });
  return pages;
}
