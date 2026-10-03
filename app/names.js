/* ---------- names.js — the one vocabulary ----------
   Every word a person reads for a piece of gear, a signal, a status or a
   connection end comes from here: the editor, the sheet, the print pages and
   the advisor all import it, so the same box can't be a "Video Matrix" on
   one page and an "HDMI matrix" on another. Stored values (videoMatrix,
   audioReturn, surround-5.1, node ids) never change — only what's shown.
   Voice: trade English — technical, not code. "Zone" is the place word
   (it's what the tabs, channel map and amp budgets say). */

export const TYPE_NAME = {
  source: "Source", avr: "AV receiver", amp: "Multi-zone amp", videoMatrix: "HDMI matrix",
  avSwitch: "AV-over-IP switch", avbSwitch: "AVB switch", audioInputModule: "Audio input module",
  audioOutputModule: "Audio output module", controlBox: "Control processor", splitter: "HDMI splitter", host: "Control host",
  networkSwitch: "Network switch", gateway: "Router / gateway", danteBridge: "Dante interface", power: "Power conditioner",
};

// adapters the app adds behind a TV (or at a source): full name + the tag drawn on the sheet chip
export const ADAPTER = {
  balun: { name: "HDBaseT balun", tag: "BALUN" },
  enc: { name: "MXNet encoder", tag: "ENC" },
  dec: { name: "MXNet decoder", tag: "DEC" },
  ddec: { name: "MXNet Dante decoder", tag: "DEC·D" },     // dec + dante:true (AC-MXNET-1G-DANTE-DV2)
  denc: { name: "MXNet Dante encoder", tag: "ENC·D" },     // enc + dante:true (AC-MXNET-1G-DANTE-EV2)
  aenc: { name: "MXNet audio-breakout encoder (AVDM)", tag: "ENC·A" },   // enc + avdm:true (AC-MXNET-1G-AVDM-EV2)
  axis: { name: "AXIS2 (TV audio → Dante)", tag: "AXIS" },
  axis16: { name: "AXIS16 (surround → Dante)", tag: "AX16" },
};
// takes a type string or the companion itself (a Dante decoder is a dec with dante:true)
const adapterKey = t => t && typeof t === "object" ? (t.avdm && t.type === "enc" ? "aenc" : t.dante && (t.type === "dec" || t.type === "enc") ? "d" + t.type : t.type) : t;
export const adapterName = t => ADAPTER[adapterKey(t)]?.name || String(adapterKey(t) || "adapter");
export const adapterTag = t => ADAPTER[adapterKey(t)]?.tag || String(adapterKey(t) || "").toUpperCase();

// what a connection carries (editor + tooltips); the sheet legend uses the short form
export const SIGNAL_NAME = {
  video: "Video (HDMI)", audio: "Audio (line level)", speaker: "Speaker level",
  network: "Network (Cat6)", audioReturn: "Audio return (optical, TV → rack)",
};
export const SIGNAL_SHORT = { video: "Video", audio: "Audio", speaker: "Speaker level", network: "Network", audioReturn: "Audio return", prewire: "Pre-wire" };
export const signalName = s => SIGNAL_NAME[s] || String(s);

export const STATUS_NAME = { new: "New", ofe: "Owner-furnished (OFE)", prewire: "Pre-wire only" };
// the audio network a job runs on — Dante OR Savant AVB, never both (the
// control platform is a separate choice: Savant can drive either)
export const AUDIO_NET_NAME = { "": "Not set", dante: "Dante", avb: "Savant AVB" };
// outdoor rooms: an explicit zone.outdoor wins; otherwise the name or landscape speakers say so
const OUTDOOR = /\b(patio|pool|yard|backyard|deck|garden|landscape|exterior|outdoor|outside|terrace|courtyard|lanai|spa|dock|balcony|porch|veranda|loggia|firepit|fire pit|cabana|driveway|lawn)\b/i;
export const isOutdoorZone = z => typeof z?.outdoor === "boolean" ? z.outdoor
  : OUTDOOR.test(z?.name || "") || (z?.endpoints || []).some(e => e.config === "landscape");
// how the drawing groups zones (job.job.zoneGrouping)
export const ZONE_GROUPING_NAME = { type: "By type (surround + TV · TV + 2-ch · speakers only)", "type-outdoor": "By type, outdoor zones separate", order: "In the order I added them" };
export const SCOPE_NAME = { included: "Included", prewire: "Pre-wire only", future: "Future" };
export const SPEAKER_SETUP = {
  none: "None", mono: "Mono (1 speaker)", stereo: "Stereo pair", "2.1": "2.1 (pair + sub)",
  "surround-5.1": "5.1 surround", "surround-7.1": "7.1 surround", "surround-7.1.4": "7.1.4 Atmos", soundbar: "Soundbar",
  "soundbar-sub": "Soundbar + sub", landscape: "Landscape (in-ground)",
};
export const DISPLAY_NAME = { none: "None", tv: "TV", projector: "Projector" };
export const REMOTE_NAME = { none: "None", savant: "Savant remote", appletv: "Apple TV remote", josh: "Josh.ai", factory: "Factory remote" };
export const AUDIO_BACK_NAME = { earc: "eARC over the HDMI", "earc+optical": "eARC + optical backup", "earc-kit": "eARC extender kit — full Atmos", optical: "Optical only", none: "None" };
export const PLATFORM_NAME = { "": "—", savant: "Savant", josh: "Josh.ai", control4: "Control4" };

/* What a connection end IS, in words. Works on a raw or loaded job:
   { label: "Anthem MRX-540 (AV receiver)", short: "Anthem MRX-540",
     group: "In the rack", kind: "rack"|"display"|"speakers"|"adapter"|"local"|"missing" }
   Zones: "Family Room TV (75\")", "Family Room speakers (5.1 surround)".
   Adapters: "HDBaseT balun at Family Room TV". In-zone gear: "Apple TV in Patio". */
/* the rooms a receiver drives (Ryan 2026-10-02: "a bunch of receivers" in a picker can't be told apart —
   a theater's MRX 1140 and a loft's MRX 540 need the room they feed by name). Read from the wiring, so it's
   never stale: its speakers, or its TV's picture (straight, or through the decoder / balun at the TV). */
export function drivesRooms(job, sol, devId) {
  const zones = job?.house?.zones || [], conns = sol?.connections || [], comps = sol?.companions || [];
  const out = [];
  for (const z of zones) {
    const eps = new Set((z.endpoints || []).map(e => e.id));
    const via = new Set(comps.filter(k => eps.has(k.serves)).map(k => k.id));     // the adapter at the TV
    const fed = conns.some(c => c.from === devId && (c.signal === "speaker" || c.signal === "video") && (eps.has(c.to) || via.has(c.to)));
    if (fed && !out.includes(z.name)) out.push(z.name);
  }
  // the room whose speakers it drives first — that's the receiver's own room; TVs it only feeds come after
  const spkRoom = n => { const z = zones.find(x => x.name === n); return conns.some(c => c.from === devId && c.signal === "speaker" && (z.endpoints || []).some(e => e.id === c.to)); };
  return [...out.filter(spkRoom), ...out.filter(n => !spkRoom(n))];
}
// "Anthem MRX 540 — Family Room" (unless the name already says the room)
// one room only (2026-10-03: "Family Room, Master Bed, Patio +1" grew with every TV it fed — its own room names it)
export function withRooms(name, rooms) {
  const n = String(name || ""), add = rooms.filter(r => r && !n.toLowerCase().includes(String(r).toLowerCase()));
  return add.length && !rooms.some(r => n.toLowerCase().includes(String(r).toLowerCase())) ? `${n} — ${add[0]}` : n;
}
/* two boxes with the same name in one picker can't be told apart ("Sonos Amp" ×3, two MXNet switches):
   the room it drives, else its rack, else a number (2026-10-03 picker audit) */
function twinTag(job, sol, d) {
  const racks = sol?.racks || [], all = racks.flatMap(r => r.devices || []);
  const same = all.filter(x => (x.model || x.id) === (d.model || d.id));
  if (same.length < 2) return "";
  const rooms = drivesRooms(job, sol, d.id);
  if (rooms.length === 1) return ` — ${rooms[0]}`;            // a one-room box (a Sonos Amp) goes by its room; an 8-zone amp doesn't
  const rk = racks.find(r => (r.devices || []).includes(d));
  if (rk && same.some(x => !(rk.devices || []).includes(x))) return ` — ${rk.name || rk.id}`;
  return ` #${same.indexOf(d) + 1}`;
}

export function describeNode(job, sol, id) {
  const zones = job?.house?.zones || [];
  const zoneName = zid => zones.find(z => z.id === zid)?.name || zid;
  for (const r of sol?.racks || []) for (const d of r.devices || []) if (d.id === id) {
    const t = TYPE_NAME[d.type];
    let name = d.type === "avr" ? withRooms(d.model || id, drivesRooms(job, sol, d.id)) : d.model || id;
    if (name === (d.model || id)) name += twinTag(job, sol, d);
    return { group: "In the rack", kind: "rack", type: d.type, short: name,
             label: `${name}${t && d.type !== "source" && !String(d.model || "").toLowerCase().includes(t.toLowerCase()) ? ` (${t})` : ""}` };
  }
  for (const z of zones) for (const e of z.endpoints || []) if (e.id === id) {
    if (e.type === "display") {
      const what = e.displayType === "projector" ? "projector" : "TV";
      return { group: "In the rooms", kind: "display", short: `${z.name} ${what}`, label: `${z.name} ${what}${e.size ? ` (${e.size}")` : ""}` };
    }
    if (e.type === "speakers") {
      const setup = SPEAKER_SETUP[e.config || "stereo"] || e.config;
      return { group: "In the rooms", kind: "speakers", short: `${z.name} speakers`, label: `${z.name} speakers (${setup})` };
    }
    const t = e.type || "endpoint (no type)";
    return { group: "In the rooms", kind: e.type, short: `${z.name} ${t}`, label: `${z.name} ${t}` };
  }
  for (const c of sol?.companions || []) if (c.id === id) {
    const at = describeNode(job, sol, c.serves);
    const s = `${adapterName(c)} at ${at.kind === "missing" ? "(removed)" : at.short}`;
    return { group: "Adapters (baluns, encoders, decoders, Dante)", kind: "adapter", type: c.type, short: s, label: s };
  }
  for (const d of sol?.localDevices || []) if (d.id === id) {
    const s = `${d.model || id} in ${zoneName(d.zone)}`;
    return { group: "In-zone gear", kind: "local", short: s, label: s };
  }
  return { group: "Missing", kind: "missing", short: `${id} (removed)`, label: `${id} (removed)` };
}

// "Anthem MDX-16 → Kitchen speakers" for a wire id or any text holding "from→to" ids
export function connectionName(job, sol, from, to) {
  return `${describeNode(job, sol, from).short} → ${describeNode(job, sol, to).short}`;
}
export function humanizeWireIds(job, sol, text) {
  return String(text ?? "").replace(/([A-Za-z0-9_.:-]+)→([A-Za-z0-9_.:-]+)/g, (m, f, t) => connectionName(job, sol, f, t));
}

/* A catalog product's name — what a linked box is called on the drawing, in
   the editor and on paper. Brand + model, with a trailing part-number list
   ("(AIM-0A16-05 / AIM-BAL16-01)") moved out to productSku; descriptive
   parentheticals ("(Gen 2)", "(legacy)") stay. No doubled brand
   ("Savant Savant Music Server 2"). */
const SKU_PAREN = /\s*\(([^)]*\b[A-Z0-9]{2,}-[A-Z0-9][A-Z0-9-]*[^)]*)\)\s*$/;
export function productName(c) {
  if (!c) return "";
  const model = String(c.model || "").replace(SKU_PAREN, "").trim();
  const brand = String(c.brand || "").trim();
  return brand && !model.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${model}` : model;
}
export function productSku(c) {
  return String(c?.model || "").match(SKU_PAREN)?.[1] || "";
}
