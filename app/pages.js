/* SignalPath print pages 2–4 (spec §5, layouts per approved mock-pages.svg).
   Channel Map · Equipment & Takeoff · Wire Schedule — every row derived from
   the same job graph the schematic draws; no run or item exists here that
   is not on Sheet 1. Pure string builders, no DOM. */

import { expandChannels, effectiveJob, indexJob } from "./engine.js";

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const W = 1632, H = 1056;

/* ---------- per-project page flags ---------- */
export function pageFlags(job) {
  const p = job.job?.pages || {};
  return { channelMap: p.channelMap !== false, equipment: p.equipment !== false,
           wireSchedule: p.wireSchedule === true, bomCompare: p.bomCompare === true };
}
export function sheetCount(job) {
  const f = pageFlags(job);
  return 1 + (f.channelMap ? 1 : 0) + (f.equipment ? 1 : 0) + (f.wireSchedule ? 1 : 0) +
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
function table(x, y, w, cols, rows) {
  const out = [`<g font-size="12.5">`, `<rect x="${x}" y="${y}" width="${w}" height="30" fill="#16181c"/>`,
    `<g fill="#fff" font-weight="600">${cols.map(c => `<text x="${x + c.dx}" y="${y + 20}">${esc(c.label)}</text>`).join("")}</g>`];
  let ry = y + 30;
  rows.forEach((r, i) => {
    const fill = r.gray ? "#f0f0f2" : r.tint ? "#fff9ec" : i % 2 ? "#fff" : "#fbfbfc";
    out.push(`<rect x="${x}" y="${ry}" width="${w}" height="28" fill="${fill}"/>`);
    const color = r.gray ? "#8a8a8a" : r.spare ? "#9aa" : "#222";
    out.push(`<g fill="${color}">${r.cells.map((cell, ci) =>
      `<text x="${x + cols[ci].dx}" y="${ry + 19}"${cell?.color ? ` fill="${cell.color}"` : ""}${r.gray && cell?.bold ? ` font-weight="600"` : ""}>${esc(cell?.text ?? cell)}</text>`).join("")}</g>`);
    ry += 28;
  });
  out.push(`<rect x="${x}" y="${y}" width="${w}" height="${ry - y}" fill="none" stroke="#c8ccd4"/></g>`);
  return { svg: out.join("\n"), bottom: ry };
}
const heading = (x, y, text, color = "#111") => `<text x="${x}" y="${y}" font-size="16" font-weight="700" fill="${color}">${esc(text)}</text>`;

/* ---------- shared derivations ---------- */
const spkDescr = ep => {
  if (!ep) return "";
  const c = ep.config || "stereo";
  if (c === "mono") return "1× speaker";
  if (c.startsWith("surround")) return `${c.slice(9)} set`;
  if (c.startsWith("soundbar")) return c === "soundbar-sub" ? "soundbar + sub" : "soundbar";
  if (c === "landscape") return `landscape ${ep.satCount || 4}${ep.buriedSub ? "+1" : ""}`;
  if (c === "2.1") return "2.1 set";
  return `${ep.count || 2}× pair`;
};
const statusLabel = (s, gray) => gray ? "PRE-WIRE" : s === "ofe" ? "OFE" : "New";
const zoneOf = (ix, epId) => ix.zonesById[ix.endpointZone[epId]];
const servesEp = (s, id) => { const c = s.companions[id]; return c && c.serves && !s.devices[c.serves] ? c : null; };

/* ============ PAGE: CHANNEL MAP ============ */
export function renderChannelMap(job, ix, opts = {}) {
  const s = ix.solutions[opts.solution ?? 0];
  const sol = s.sol;
  const out = [openPage(), frame("Channel Map", "Every amp, matrix and input assignment — technician reference", opts.sheetLabel || "")];
  const colX = [40, 860], colW = [760, 700];
  const colY = [120, 120];
  const put = block => { const c = colY[0] <= colY[1] ? 0 : 1; const r = block(colX[c], colY[c], colW[c]); out.push(r.svg); colY[c] = r.bottom + 46; };

  for (const r of sol.racks || []) for (const d of r.devices || []) {
    const inbound = (sol.connections || []).filter(c => c.to === d.id);
    const outbound = (sol.connections || []).filter(c => c.from === d.id);

    if (d.type === "amp") put((x, y, w) => {
      const feeds = outbound.filter(c => c.signal === "speaker")
        .map(c => ({ c, ch: expandChannels(c.channels || "")[0] || 999 })).sort((a, b) => a.ch - b.ch);
      // trunk-fed amps get the per-run patch column: module output k → amp analog input k, in channel order
      const trunkSrc = inbound.find(c => c.signal === "audio" && s.devices[c.from]?.type === "audioOutputModule");
      const rows = feeds.map(({ c }, i) => {
        const ep = ix.endpointsById[c.to], z = zoneOf(ix, c.to);
        const gray = (c.scope || "included") !== "included";
        const chs = expandChannels(c.channels || "");
        return { gray, cells: [String(chs.length ? Math.ceil(chs[0] / 2) : "?"), chs.length > 1 ? `${chs[0]}–${chs[chs.length - 1]}` : String(chs[0] ?? "?"),
          ...(trunkSrc ? [`Out ${i + 1} → In ${i + 1}`] : []),
          z?.name || c.to, gray ? `${spkDescr(ep)} (wire only)` : spkDescr(ep), { text: statusLabel(ep?.status, gray), bold: true }] };
      });
      const zones = d.zones || 0;
      const used = new Set(rows.map(r => +r.cells[0]));
      const spare = zones ? Array.from({ length: zones }, (_, i) => i + 1).filter(n => !used.has(n)) : [];
      if (spare.length) rows.push({ spare: true, cells: [spare.length > 1 ? `${spare[0]}–${spare[spare.length - 1]}` : String(spare[0]),
        `${spare[0] * 2 - 1}–${spare[spare.length - 1] * 2}`, ...(trunkSrc ? [""] : []), "— spare —", "", ""] });
      const cols = trunkSrc
        ? [{ label: "Zone Out", dx: 14 }, { label: "Channels", dx: 100 }, { label: `Feed (${s.devices[trunkSrc.from]?.model || "module"})`, dx: 180 }, { label: "Zone", dx: 320 }, { label: "Speakers", dx: 470 }, { label: "Status", dx: 610 }]
        : [{ label: "Zone Out", dx: 14 }, { label: "Channels", dx: 110 }, { label: "Zone", dx: 210 }, { label: "Speakers", dx: 400 }, { label: "Status", dx: 580 }];
      const t = table(x, y + 20, w, cols, rows);
      return { svg: heading(x, y + 8, `${d.model} — Distributed Audio`) + t.svg, bottom: t.bottom };
    });

    else if (d.type === "videoMatrix" || d.type === "avSwitch") put((x, y, w) => {
      const rows = [];
      inbound.filter(c => c.signal === "video").forEach((c, i) => {
        const src = s.devices[c.from] || s.companions[c.from];
        rows.push({ cells: [`In ${c.matrixIn ?? i + 1}`, "Input", src?.model || (servesEp(s, c.from) ? `${s.devices[s.companions[c.from].serves]?.model} · ENC` : c.from), "HDMI"] });
      });
      outbound.filter(c => c.signal === "video").forEach((c, i) => {
        const comp = s.companions[c.to];
        const dest = comp ? (servesEp(s, c.to)
            ? `${zoneOf(ix, comp.serves)?.name} TV · ${comp.type === "dec" ? "DEC" : "Balun"}`
            : `${s.devices[comp.serves]?.model} · ${comp.type.toUpperCase()}`)
          : s.devices[c.to]?.model || ix.zonesById[ix.endpointZone[c.to]]?.name || c.to;
        rows.push({ cells: [`Out ${c.matrixOut ?? i + 1}`, "Output", dest, comp && comp.type === "balun" ? "HDBaseT" : comp ? "MXNet" : "HDMI"] });
      });
      const io = d.io || {};
      const spareIn = (io.in || 0) - inbound.filter(c => c.signal === "video").length;
      const spareOut = (io.out || 0) - outbound.filter(c => c.signal === "video").length;
      if (spareIn > 0) rows.push({ spare: true, cells: [`In +${spareIn}`, "Input", "— spare —", ""] });
      if (spareOut > 0) rows.push({ spare: true, cells: [`Out +${spareOut}`, "Output", "— spare —", ""] });
      const t = table(x, y + 20, w, [{ label: "Port", dx: 14 }, { label: "Direction", dx: 100 }, { label: "Connected To", dx: 220 }, { label: "Signal", dx: w - 100 }], rows);
      return { svg: heading(x, y + 8, `${d.model} — ${d.type === "avSwitch" ? "AV Switch" : "Video Matrix"}`) + t.svg, bottom: t.bottom };
    });

    else if (d.type === "audioInputModule") put((x, y, w) => {
      const rows = inbound.filter(c => c.signal === "audio" || c.signal === "audioReturn").map((c, i) => {
        const ret = c.signal === "audioReturn";
        const src = s.devices[c.from];
        const zone = ret ? zoneOf(ix, c.from)?.name : null;
        return { cells: [String(i + 1),
          ret ? { text: `${zone} TV — audio return`, color: "#a45a12" } : `${src?.model || c.from}${src?.status === "ofe" ? " (OFE)" : ""}`,
          ret ? "Optical" : "Analog stereo"] };
      });
      const t = table(x, y + 20, w, [{ label: "Input", dx: 14 }, { label: "Source", dx: 110 }, { label: "Connection", dx: 400 }], rows);
      return { svg: heading(x, y + 8, `${d.model} — Audio Sources In`) + t.svg, bottom: t.bottom };
    });

    else if (d.type === "avr") put((x, y, w) => {
      const vin = inbound.filter(c => c.signal === "video").map(c => s.devices[c.from]?.model || c.from).join(" · ") || "—";
      const spk = outbound.filter(c => c.signal === "speaker").map(c => { const ep = ix.endpointsById[c.to]; const z = zoneOf(ix, c.to); return `${z?.name}: ${spkDescr(ep)} (${statusLabel(ep?.status)})`; }).join(" · ") || "—";
      const vout = outbound.filter(c => c.signal === "video").map(c => { const comp = s.companions[c.to]; return comp && servesEp(s, c.to) ? `${zoneOf(ix, comp.serves)?.name} TV via ${comp.type === "balun" ? "Balun" : "DEC"}` : s.devices[c.to]?.model || c.to; }).join(" · ") || "—";
      const zname = outbound.filter(c => c.signal === "speaker").map(c => zoneOf(ix, c.to)?.name)[0];
      const platform = (sol.platforms || [])[0];
      const lines = [`Video in: ${vin}`, `Speakers: ${spk}`, `Video out: ${vout}`, `Control: ${platform ? `IP (${platform} driver)` : "IP / IR"}`];
      const h = lines.length * 24 + 24;
      const svg = heading(x, y + 8, `${d.model}${zname ? ` — ${zname} Surround` : ""}`) +
        `<g font-size="12.5" fill="#222"><rect x="${x}" y="${y + 20}" width="${w}" height="${h}" fill="#fbfbfc" stroke="#c8ccd4"/>` +
        lines.map((l, i) => `<text x="${x + 14}" y="${y + 46 + i * 24}">${esc(l)}</text>`).join("") + `</g>`;
      return { svg, bottom: y + 20 + h };
    });
  }

  out.push(`<text x="40" y="920" font-size="11.5" font-style="italic" fill="#767676">Gray rows = pre-wire only, reserved for future. Spare ports shown so expansion capacity is visible at a glance.</text>`);
  out.push(footer(job, opts, opts.sheetLabel || ""), `</svg>`);
  return out.join("\n");
}

/* ============ PAGE: EQUIPMENT & TAKEOFF ============ */
export function takeoffItems(job, ix, opts = {}) {
  const s = ix.solutions[opts.solution ?? 0];
  const sol = s.sol;
  const items = []; // {label, status, where, confirm?}
  for (const r of sol.racks || []) for (const d of r.devices || [])
    items.push({ label: d.model || d.id, status: d.status || "new", where: r.name });
  for (const d of sol.localDevices || [])
    items.push({ label: `${d.model} (local)`, status: d.status || "new", where: ix.zonesById[d.zone]?.name || d.zone });
  const compGroups = {};
  for (const c of sol.companions || []) {
    const kind = c.type === "balun" ? "HDBaseT Balun (auto-added)" : c.type === "enc" ? "MXNet Encoder (auto-added)" : "MXNet Decoder (auto-added)";
    const where = servesEp(s, c.id) ? zoneOf(ix, c.serves)?.name : s.devices[c.serves]?.model;
    (compGroups[kind] ||= []).push(where || "");
  }
  for (const [label, wheres] of Object.entries(compGroups))
    items.push({ label, status: "new", where: wheres.filter(Boolean).join(" · "), qty: wheres.length });
  for (const z of job.house.zones) {
    const gray = (z.scope || "included") !== "included";
    for (const ep of z.endpoints || []) {
      if (ep.type === "display") {
        items.push({ label: `${ep.brand || "TBD"} ${ep.size}" ${ep.displayType === "projector" ? "Projector" : "Display"}${ep.confirm?.length ? " — size unconfirmed" : ""}`,
          status: gray ? "prewire" : ep.status || "new", where: z.name, confirm: !!ep.confirm?.length });
      } else {
        items.push({ label: `Speakers, ${spkDescr(ep)}`, status: gray ? "prewire" : ep.status || "new", where: z.name });
      }
    }
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
  const q = s => `"${String(s ?? "").replace(/"/g, '""')}"`;
  return ["Status,Qty,Item,Location"].concat(rows.map(r => [r.status.toUpperCase(), r.qty, q(r.label), q(r.where)].join(","))).join("\n");
}

export function renderTakeoff(job, ix, adviseResult, opts = {}) {
  const rolled = takeoffItems(job, ix, opts);
  const out = [openPage(), frame("Equipment & Takeoff", "Rolled-up quantities by procurement status — quote reference (CSV export available)", opts.sheetLabel || "")];
  const cells = r => ({ cells: [String(r.qty), r.label, r.where.length > 44 ? r.where.slice(0, 42) + "…" : r.where], tint: r.confirm });
  const newRows = rolled.filter(r => r.status === "new").map(cells);
  const ofeRows = rolled.filter(r => r.status === "ofe").map(cells);
  out.push(heading(40, 138, "NEW — Supplied & Installed", "#1a6fb5"));
  const tN = table(40, 150, 900, [{ label: "Qty", dx: 14 }, { label: "Item", dx: 80 }, { label: "Location / Zones", dx: 520 }], newRows);
  out.push(tN.svg);
  out.push(heading(1000, 138, "OWNER FURNISHED (OFE)", "#4a7040"));
  const tO = table(1000, 150, 560, [{ label: "Qty", dx: 14 }, { label: "Item", dx: 80 }, { label: "Zones", dx: 360 }], ofeRows.length ? ofeRows : [{ spare: true, cells: ["", "— none —", ""] }]);
  out.push(tO.svg);
  let ry = tO.bottom + 44;

  const pre = rolled.filter(r => r.status === "prewire");
  const reserved = [];
  const s = ix.solutions[opts.solution ?? 0];
  for (const c of s.sol.connections || []) if ((c.scope || "included") !== "included" && c.signal === "speaker") {
    const amp = s.devices[c.from]; const chs = expandChannels(c.channels || "");
    reserved.push(`${amp?.model || c.from} ${chs.length ? `ch ${chs[0]}–${chs[chs.length - 1]}` : ""} reserved`);
  }
  out.push(heading(1000, ry, "PRE-WIRE ONLY", "#8a8a8a"));
  const preLines = [...pre.map(r => `${r.where} — ${r.label.replace("Speakers, ", "")}, wire only`), ...reserved];
  const preH = Math.max(36, preLines.length * 20 + 16);
  out.push(`<g font-size="12.5"><rect x="1000" y="${ry + 12}" width="560" height="${preH}" fill="#f0f0f2" stroke="#c8ccd4"/>` +
    (preLines.length ? preLines.map((l, i) => `<text x="1014" y="${ry + 34 + i * 20}" fill="#666">${esc(l)}</text>`).join("") :
      `<text x="1014" y="${ry + 34}" fill="#999">— none —</text>`) + `</g>`);
  ry += preH + 56;

  const confirms = [];
  for (const z of job.house.zones) for (const ep of z.endpoints || [])
    if (ep.confirm?.length) confirms.push(`${z.name} ${ep.type === "display" ? "TV" : "speakers"} ${ep.confirm.join("/")} — drawn as ${ep.size ? ep.size + '"' : "?"}, verify before ordering`);
  out.push(heading(1000, ry, "NEEDS CONFIRMATION", "#b32017"));
  const cH = Math.max(36, confirms.length * 20 + 16);
  out.push(`<rect x="1000" y="${ry + 12}" width="560" height="${cH}" fill="#fff9ec" stroke="#e2c78a"/>` +
    (confirms.length ? confirms.map((l, i) => `<text x="1014" y="${ry + 34 + i * 20}" font-size="12.5" fill="#7a5a12">${esc(l)}</text>`).join("") :
      `<text x="1014" y="${ry + 34}" font-size="12.5" fill="#999">— none —</text>`));
  ry += cH + 56;

  const licLines = [];
  for (const lic of adviseResult?.licensing || []) {
    licLines.push(`${lic.platform}: ${lic.pick}`);
    for (const l of lic.lines || []) licLines.push(l.length > 66 ? l.slice(0, 64) + "…" : l);
  }
  for (const n of (adviseResult?.notes || []).filter(n => n.code === "savant-host")) licLines.push(n.msg);
  if (job.job?.catalogSnapshot?.asOf) licLines.push(`Prices dealer-gated; catalog as of ${job.job.catalogSnapshot.asOf}`);
  out.push(heading(1000, ry, "LICENSING & RECURRING"));
  const lH = Math.max(36, licLines.length * 22 + 16);
  out.push(`<g font-size="12.5" fill="#222"><rect x="1000" y="${ry + 12}" width="560" height="${lH}" fill="#fbfbfc" stroke="#c8ccd4"/>` +
    (licLines.length ? licLines.map((l, i) => `<text x="1014" y="${ry + 36 + i * 22}"${l.startsWith("Prices") ? ' fill="#888"' : ""}>${esc(l)}</text>`).join("") :
      `<text x="1014" y="${ry + 36}" fill="#999">No control platform selected</text>`) + `</g>`);

  out.push(`<text x="40" y="${Math.max(tN.bottom + 40, 520)}" font-size="11.5" font-style="italic" fill="#767676">Quantities are rolled up from the schematic — every icon and run on Sheet 1 appears here exactly once.</text>`);
  out.push(footer(job, opts, opts.sheetLabel || ""), `</svg>`);
  return out.join("\n");
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
    if (c.signal === "video" && toComp) {                // rack video feed to a display chip
      const z = zoneOf(ix, toComp.serves);
      runs.push({ prefix: "V", cable: "Cat6", from: rackName, to: `${z?.name} — TV location`,
        carries: toComp.type === "balun" ? "Video (HDBaseT)" : "Video (MXNet)", color: "#b32017",
        term: `${toComp.type === "balun" ? "Balun" : "DEC"} at display`, count: 1, gray });
    } else if (c.signal === "speaker" && toEp) {
      const z = zoneOf(ix, c.to);
      const ep = toEp;
      const n = ep.config === "mono" ? 1 : ep.config?.startsWith("surround") ? +(ep.config.slice(9, 10)) || 5 :
        ep.config === "landscape" ? (ep.satCount || 4) : ep.config?.startsWith("soundbar") ? 0 : (ep.count || 2);
      const amp = s.devices[c.from];
      const chs = expandChannels(c.channels || "");
      if (n > 0) runs.push({ prefix: "S", cable: `${spkCable(ep)} ×${n}`, from: rackName,
        to: `${z?.name} — ${ep.config === "landscape" ? "landscape array" : n > 2 ? "speaker set" : "ceiling pair"}`,
        carries: gray ? "PRE-WIRE — coil & label" : "Speaker level", color: gray ? null : "#1a5fa0",
        term: `${amp?.model || c.from}${chs.length ? ` ch ${chs[0]}–${chs[chs.length - 1]}` : ""}${gray ? " (reserved)" : ""}`, count: n, gray });
      const hasSub = ep.config?.includes(".1") || ep.config === "soundbar-sub" || (ep.config === "landscape" && ep.buriedSub);
      if (hasSub && ep.config?.startsWith("surround"))
        runs.push({ prefix: "S", cable: "RG6 / LFE", from: rackName, to: `${z?.name} — sub location`,
          carries: gray ? "PRE-WIRE — coil & label" : "Sub feed", color: gray ? null : "#1a5fa0",
          term: `${amp?.model || c.from} sub out`, count: 1, gray });
    } else if (c.signal === "audioReturn" && fromEp) {
      const z = zoneOf(ix, c.from);
      runs.push({ prefix: "R", cable: "Optical (Toslink)", from: `${z?.name} — TV location`, to: rackName,
        carries: "Audio return", color: "#a45a12", term: s.devices[c.to]?.model || c.to, count: 1, gray });
    } else if (c.signal === "network" && (toEp || servesEp(s, c.to))) {
      const z = zoneOf(ix, toEp ? c.to : s.companions[c.to].serves);
      runs.push({ prefix: "N", cable: "Cat6", from: rackName, to: `${z?.name}`, carries: "Network", color: "#2f9e44", term: "RJ45", count: 1, gray });
    }
  }
  // local streaming devices always need a network drop at the display
  for (const d of sol.localDevices || []) {
    if (d.location !== "at-display") continue;
    const z = ix.zonesById[d.zone];
    runs.push({ prefix: "N", cable: "Cat6", from: rackName, to: `${z?.name} — TV location`,
      carries: `Network (local ${d.model})`, color: "#2f9e44", term: "RJ45 at display", count: 1, gray: false });
  }
  // deterministic numbering per prefix, non-gray first within prefix order V,N,R,S
  const order = { V: 0, N: 1, R: 2, S: 3 };
  runs.sort((a, b) => order[a.prefix] - order[b.prefix] || (a.gray ? 1 : 0) - (b.gray ? 1 : 0));
  const counters = {};
  for (const r of runs) {
    const start = (counters[r.prefix] || 0) + 1;
    counters[r.prefix] = start + r.count - 1;
    r.id = r.count > 1 ? `${r.prefix}-${String(start).padStart(2, "0")}…${String(counters[r.prefix]).padStart(2, "0")}`
                       : `${r.prefix}-${String(start).padStart(2, "0")}`;
  }
  return runs;
}

export function renderWireSchedule(job, ix, opts = {}) {
  const runs = wireRuns(job, ix, opts);
  const out = [openPage(), frame("Wire Schedule", "Pull sheet — every home run, derived from the schematic. Check off as pulled.", opts.sheetLabel || "")];
  out.push(`<g font-size="12.5"><rect x="40" y="120" width="1520" height="30" fill="#16181c"/>
<g fill="#fff" font-weight="600"><text x="58" y="140">✓</text><text x="100" y="140">Run</text><text x="170" y="140">Cable</text><text x="330" y="140">From</text><text x="520" y="140">To</text><text x="900" y="140">Carries</text><text x="1200" y="140">Terminates</text></g>`);
  let ry = 150;
  runs.forEach((r, i) => {
    const fill = r.gray ? "#f0f0f2" : i % 2 ? "#fff" : "#fbfbfc";
    out.push(`<rect x="40" y="${ry}" width="1520" height="27" fill="${fill}"/>
<rect x="54" y="${ry + 6}" width="14" height="14" fill="none" stroke="#aab"/>
<g fill="${r.gray ? "#8a8a8a" : "#222"}">
<text x="100" y="${ry + 19}">${esc(r.id)}</text><text x="170" y="${ry + 19}">${esc(r.cable)}</text>
<text x="330" y="${ry + 19}">${esc(r.from)}</text><text x="520" y="${ry + 19}">${esc(r.to)}</text>
<text x="900" y="${ry + 19}"${r.color ? ` fill="${r.color}"` : ""}${r.gray ? ' font-weight="600"' : ""}>${esc(r.carries)}</text>
<text x="1200" y="${ry + 19}">${esc(r.term)}</text></g>`);
    ry += 27;
  });
  out.push(`<rect x="40" y="120" width="1520" height="${ry - 120}" fill="none" stroke="#c8ccd4"/></g>`);

  const byCable = {};
  let total = 0, grayCount = 0;
  for (const r of runs) { byCable[r.cable.split(" ×")[0]] = (byCable[r.cable.split(" ×")[0]] || 0) + r.count; total += r.count; if (r.gray) grayCount += r.count; }
  const totals = Object.entries(byCable).map(([c, n]) => `${c} ×${n}`).join(" · ");
  out.push(`<g font-size="12" fill="#555"><text x="40" y="${ry + 40}" font-weight="700">Totals:</text>
<text x="110" y="${ry + 40}">${esc(totals)} — ${total} home runs${grayCount ? ` (${grayCount} pre-wire)` : ""}</text></g>`);
  out.push(`<text x="40" y="${ry + 68}" font-size="11.5" font-style="italic" fill="#767676">Run IDs: V = video, N = network, R = audio return, S = speaker. Gray rows are pre-wire scope. Generated from the schematic — no run exists here that isn't drawn on Sheet 1.</text>`);
  out.push(footer(job, opts, opts.sheetLabel || ""), `</svg>`);
  return out.join("\n");
}

/* ---------- packet assembly (pages 2..N; page 1 comes from engine render) ---------- */
/* ============ PAGE: SOLUTION COMPARISON (BOM compare) ============
   Side-by-side equipment across the job's Solutions — the proposal-meeting
   page the House/Solution split was designed for. Each column runs through
   that solution's OWN effective house, so per-solution overrides (an 85"
   in Better where Good has a 75") appear as real line-item differences.
   Licensing rows come from adviseResult filtered by solution id. */
export function renderBomCompare(job, ix, adviseResult, opts = {}) {
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

  const out = [openPage(), frame("Solution Comparison",
    "Side-by-side equipment across proposed options — highlighted rows differ between solutions", opts.sheetLabel || "")];
  const x = 40, wLabel = 620, wCol = Math.min(240, (1552 - wLabel) / cols.length);
  const wTot = wLabel + wCol * cols.length;
  let y = 130;

  // header
  out.push(`<g font-size="12.5"><rect x="${x}" y="${y}" width="${wTot}" height="34" fill="#16181c"/>`);
  out.push(`<text x="${x + 14}" y="${y + 22}" fill="#fff" font-weight="600">Item</text>`);
  cols.forEach((c, i) => out.push(`<text x="${x + wLabel + i * wCol + wCol / 2}" y="${y + 22}" text-anchor="middle" fill="#fff" font-weight="600">${esc(c.sol.name || c.sol.id)}</text>`));
  out.push(`</g>`);
  y += 34;

  let lastStatus = null, diffs = 0;
  const SECT = { new: ["NEW — Supplied & Installed", "#1a6fb5"], ofe: ["OWNER FURNISHED", "#4a7040"], prewire: ["PRE-WIRE ONLY", "#8a8a8a"] };
  for (const key of keys) {
    if (key.status !== lastStatus) {
      lastStatus = key.status;
      const [t, col] = SECT[key.status] || [key.status, "#666"];
      out.push(`<rect x="${x}" y="${y}" width="${wTot}" height="24" fill="#eef0f4"/>` +
        `<text x="${x + 14}" y="${y + 17}" font-size="11" font-weight="700" letter-spacing="1" fill="${col}">${esc(t)}</text>`);
      y += 24;
    }
    const qtys = cols.map(c => qtyOf(c, key));
    const differs = new Set(qtys).size > 1;
    if (differs) diffs++;
    out.push(`<rect x="${x}" y="${y}" width="${wTot}" height="26" fill="${differs ? "#fff9ec" : "#fff"}"/>`);
    out.push(`<text x="${x + 14}" y="${y + 18}" font-size="12.5" fill="#222">${esc(key.label.length > 74 ? key.label.slice(0, 72) + "…" : key.label)}</text>`);
    qtys.forEach((q, i) => out.push(`<text x="${x + wLabel + i * wCol + wCol / 2}" y="${y + 18}" text-anchor="middle" font-size="12.5"` +
      `${differs ? ' font-weight="700"' : ""} fill="${q ? (differs ? "#a45a12" : "#222") : "#bbb"}">${q || "—"}</text>`));
    y += 26;
  }

  // summary block: zone scopes + licensing per column
  y += 10;
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
  out.push(`<g font-size="12.5"><rect x="${x}" y="${y}" width="${wTot}" height="${sumRows.length * 26 + 8}" fill="#fbfbfc" stroke="#c8ccd4"/>`);
  sumRows.forEach((rw, ri) => {
    out.push(`<text x="${x + 14}" y="${y + 22 + ri * 26}" fill="#555" font-weight="600">${esc(rw[0])}</text>`);
    const differs = new Set(rw.slice(1)).size > 1;
    rw.slice(1).forEach((v, i) => out.push(`<text x="${x + wLabel + i * wCol + wCol / 2}" y="${y + 22 + ri * 26}" text-anchor="middle"` +
      `${differs ? ' font-weight="700" fill="#a45a12"' : ' fill="#222"'}>${esc(v)}</text>`));
  });
  out.push(`</g>`);
  y += sumRows.length * 26 + 8;

  out.push(`<text x="${x}" y="${y + 34}" font-size="11.5" font-style="italic" fill="#767676">` +
    `${diffs ? `${diffs} line item${diffs > 1 ? "s" : ""} differ${diffs > 1 ? "" : "s"} between solutions (highlighted).` : "Solutions are currently identical."}` +
    `${(base.solutions || []).length > 4 ? ` Showing first 4 of ${base.solutions.length} solutions.` : ""}</text>`);
  out.push(footer(job, opts, opts.sheetLabel || ""), `</svg>`);
  return out.join("\n");
}

export function renderExtraPages(job, ix, adviseResult, opts = {}) {
  const flags = pageFlags(job);
  const n = sheetCount(job);
  const pages = [];
  let no = 2;
  if (flags.channelMap) pages.push({ title: "Channel Map", svg: renderChannelMap(job, ix, { ...opts, sheetLabel: `Sheet ${no++} of ${n}` }) });
  if (flags.equipment) pages.push({ title: "Equipment & Takeoff", svg: renderTakeoff(job, ix, adviseResult, { ...opts, sheetLabel: `Sheet ${no++} of ${n}` }) });
  if (flags.wireSchedule) pages.push({ title: "Wire Schedule", svg: renderWireSchedule(job, ix, { ...opts, sheetLabel: `Sheet ${no++} of ${n}` }) });
  if (flags.bomCompare && (job.solutions || []).length > 1)
    pages.push({ title: "Solution Comparison", svg: renderBomCompare(job, ix, adviseResult, { ...opts, sheetLabel: `Sheet ${no++} of ${n}` }) });
  return pages;
}
