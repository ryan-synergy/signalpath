/* SignalPath importers — the one import door (spec §6).
   sniff() routes by content, each adapter maps a foreign export into the House
   model, and mergeHouse() refreshes an existing job in place (zones matched by
   name, Solutions kept). Lenient by design: unknown fields land in notes and
   the review list — never a hard failure. Pure module, no DOM. */

import { productName } from "./names.js";
import { setVideo, setSpeakers, nextFreeOutputs, autoHookup, avrFor } from "./hookup.js";

const uid = p => p + "-" + Math.random().toString(36).slice(2, 7);
const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || uid("z");
const today = () => new Date().toISOString().slice(0, 10);

/* Imported JSON is untrusted. Two defenses before anything touches app state:
   strip prototype-pollution key names everywhere, and require the skeleton a
   native file must have before it may replace a working job. */
const UNSAFE_KEYS = ["__proto__", "constructor", "prototype"];
export function stripUnsafe(v, depth = 0) {
  if (!v || typeof v !== "object") return v;
  if (depth > 200) throw new Error("File rejected: nested too deeply");   // never leave a subtree unscanned
  if (Array.isArray(v)) { for (const x of v) stripUnsafe(x, depth + 1); return v; }
  for (const k of Object.keys(v)) {
    if (UNSAFE_KEYS.includes(k)) delete v[k];
    else stripUnsafe(v[k], depth + 1);
  }
  return v;
}

// ids flow into HTML attributes, CSS selectors and the "from→to" wire key —
// everything the app itself generates fits this set, so an imported id that
// doesn't is either corrupt or hostile
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,80}$/;

export function assertJobShape(job) {
  const bad = m => { throw new Error("SignalPath file rejected: " + m); };
  const list = (o, k, where) => { if (o[k] == null) o[k] = []; else if (!Array.isArray(o[k])) bad(`${where}${k} is not a list`); return o[k]; };
  const idOk = (x, what) => { if (!x || typeof x !== "object" || typeof x.id !== "string" || !SAFE_ID.test(x.id)) bad(`${what} has a missing or invalid id`); };
  if (job.generator !== "SignalPath") bad("not a SignalPath file");   // loadJob refuses it too — say so at the door
  if (job.schemaVersion !== 1) bad("unsupported schemaVersion " + job.schemaVersion);
  if (!job.job || typeof job.job !== "object") bad("missing job block");
  if (!job.house || !Array.isArray(job.house.zones)) bad("missing house.zones");
  if (!Array.isArray(job.solutions) || !job.solutions.length) bad("missing solutions");
  for (const a of list(job.house, "areas", "house.")) idOk(a, "area");
  for (const z of job.house.zones) {
    idOk(z, "zone");
    for (const e of list(z, "endpoints", "zone.")) idOk(e, `endpoint in zone ${z.id}`);
  }
  for (const sol of job.solutions) {
    if (!sol || typeof sol !== "object") bad("bad solution entry");
    for (const r of list(sol, "racks", "solution.")) { idOk(r, "rack"); for (const d of list(r, "devices", "rack.")) idOk(d, `device in rack ${r.id}`); }
    for (const d of list(sol, "localDevices", "solution.")) idOk(d, "local device");
    for (const c of list(sol, "companions", "solution.")) idOk(c, "companion");
    list(sol, "annotations", "solution.");
    for (const c of list(sol, "connections", "solution.")) {
      if (!c || typeof c !== "object" || !SAFE_ID.test(String(c.from)) || !SAFE_ID.test(String(c.to))) bad("bad connection entry");
    }
  }
  return job;
}

// adapters derive ids from room names — two "Bedroom"s must not collide
function idMaker() {
  const used = new Set();
  return base => { let id = base, n = 2; while (used.has(id)) id = `${base}-${n++}`; used.add(id); return id; };
}

/* ---------- sniffing ---------- */
export function sniff(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.generator === "SignalPath") return "signalpath";
  if (raw.generator === "Blueprinted") return "blueprinted";
  // SiteWalk/AVWalk exports carry no generator stamp — sniff the key shape
  if (Array.isArray(raw.rooms) && raw.rack && ("controlSystem" in raw || "jobType" in raw || raw.schema >= 1)) return "sitewalk";
  return null;
}

/* ---------- shared skeleton ---------- */
function skeletonJob(name, clientName, address) {
  const txt = v => typeof v === "string" || typeof v === "number" ? String(v) : "";   // a list/object here printed "[object Object]"
  name = txt(name); clientName = txt(clientName); address = txt(address);
  return {
    generator: "SignalPath", schemaVersion: 1,
    job: { name: name || "Imported Job", client: { name: clientName || "Customer Name", address: address || "" },
      stage: "proposal", drawnBy: "SignalPath",
      revisions: [{ rev: 1, date: today(), description: "Imported", by: "SP" }],
      catalogSnapshot: { asOf: today() } },
    house: { areas: [], zones: [] },
    solutions: [{ id: "sol-a", name: "Proposed System", videoDistribution: "hybrid", platforms: [], auxCounts: {},
      racks: [{ id: "rack-main", name: "Equipment Rack", devices: [] }],
      localDevices: [], companions: [], connections: [], annotations: [] }],
  };
}

/* ---------- SiteWalk / AVWalk ---------- */
const SW_AUDIO = {
  "2.0": "stereo", "2.1": "2.1", "5.1": "surround-5.1", "5.1.2": "surround-5.1",
  "7.1": "surround-7.1", "7.1.4": "surround-7.1.4", "soundbar": "soundbar", "soundbar-sub": "soundbar-sub",
};
const swStatus = s => {
  const t = String(s || "New").toLowerCase();
  if (t.includes("keep")) return "ofe";
  return "new"; // New and Existing—replace both quote as new
};

export function importSiteWalk(raw) {
  const notes = [], warnings = [], unmapped = [], walk = {};
  const job = skeletonJob(typeof raw.client === "string" && raw.client ? `${raw.client} Residence` : "Site Walk Import", raw.client, raw.address);
  const sol = job.solutions[0];

  // areas from floors (only when the walk recorded more than one)
  const rooms = (Array.isArray(raw.rooms) ? raw.rooms : []).filter(r => r && typeof r === "object");
  const floorOf = r => String(r.floor ?? "").trim();
  const floors = [...new Set(rooms.map(floorOf).filter(Boolean))];
  if (floors.length > 1) job.house.areas = floors.map(f => ({ id: "area-" + slug(f), name: f }));
  const newId = idMaker();

  for (const r of rooms) {
    // the room is the zone; a walk's shared audio-zone label ("Main Level" over
    // Kitchen + Dining) means those rooms play together off one amp zone
    const str = v => typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
    const zname = str(r.name) || str(r.zoneName) || "Zone";
    const audioZone = str(r.zoneName);
    const zid = newId("z-" + slug(zname));
    const zone = { id: zid, name: zname, scope: "included", endpoints: [] };
    if (floors.length > 1 && floorOf(r)) zone.area = "area-" + slug(floorOf(r));
    const znotes = [];

    // speakers
    const audio = r.audio || "tv";
    if (!SW_AUDIO[audio] && audio !== "tv" && audio !== "none") unmapped.push(`${zname}: audio "${audio}" not recognized — no speakers added`);
    if (SW_AUDIO[audio]) {
      const ep = { id: zid + "-spk", type: "speakers", config: SW_AUDIO[audio], status: swStatus(r.audStatus) };
      if (SW_AUDIO[audio] === "stereo") ep.count = 2;
      if (audio === "5.1.2" || audio === "7.1.4") znotes.push(`${audio} Atmos as walked`);
      if (String(r.audStatus || "").toLowerCase().includes("replace")) znotes.push("replacing existing speakers");
      zone.endpoints.push(ep);
      if (r.audioFeed === "local") znotes.push("audio fed locally (not house amp)");
    } else if (audio === "tv") { /* TV speakers — no endpoint */ }
    if (r.landscape) {
      zone.endpoints.push({ id: zid + "-land", type: "speakers", config: "landscape",
        satCount: r.satCount || 8, buriedSub: !!r.buriedSub, status: "new" });
    }

    // display
    if (r.tv) {
      const projector = r.isTheater && r.thDisplay === "Projector";
      const size = projector ? parseInt(r.thScreen) || null : parseInt(r.tvSize) || null;
      const ep = { id: zid + "-tv", type: "display", displayType: projector ? "projector" : "tv",
        brand: "", size: size || 65, status: swStatus(r.tvStatus) };
      if (!size) { ep.confirm = ["size"]; warnings.push(`${zname}: TV size TBD`); }
      zone.endpoints.push(ep);
      if (r.videoFeed === "matrix") znotes.push("TV fed from the rack");
      else if (r.videoFeed === "direct") znotes.push("video: direct rack feed");
      else if (r.videoFeed === "local" || (r.localSources || []).length) znotes.push("TV fed by a source in the zone");
      for (const src of r.localSources || []) {
        sol.localDevices.push({ id: uid(zid + "-src"), type: "source", sourceType: "appletv",
          model: src, status: "new", zone: zid, location: (r.equipLoc || "").toLowerCase().includes("rack") ? "remote" : "at-display" });
      }
    }
    if (audioZone && audioZone !== zname) znotes.push(`audio zone: ${audioZone}`);
    if (r.isTheater) znotes.push("theater room");
    if (r.wiring) znotes.push(`wiring: ${r.wiring}`);
    if (r.notes) znotes.push(r.notes);
    for (const k of ["mount", "bracket", "fireplace", "spkType", "subLoc"])
      if (r[k] && r[k] !== false) unmapped.push(`${zname}: ${k} = ${r[k]}`);
    if (znotes.length) zone.note = znotes.join(" · ");
    if (!zone.endpoints.length) { unmapped.push(`${zname}: no AV endpoints — skipped`); continue; }
    job.house.zones.push(zone);
    // how the walk says this room is fed — drawFromWalk turns it into gear + wiring
    walk[zid] = { video: r.tv ? r.videoFeed || "none" : "none", audioFeed: r.audioFeed || "house",
      passiveBar: /^soundbar/.test(audio) && r.barType === "passive", audioZone,
      local: /behind|cabinet|room|local/i.test(String(r.equipLoc || "")) };
  }

  // rack sources → starter devices
  const srcList = raw.rack?.sources && typeof raw.rack.sources === "object" && !Array.isArray(raw.rack.sources) ? raw.rack.sources : {};
  for (const [name, n] of Object.entries(srcList)) {
    // a count is 0–16 per kind; anything else is a typo, not ten million Apple TVs
    const count = Math.min(16, Math.max(0, Math.floor(+n) || 0));
    if (+n > 16) warnings.push(`Rack sources: "${name}" count ${n} capped at 16 — check the walk`);
    for (let i = 0; i < count; i++) {
      sol.racks[0].devices.push({ id: uid("src"), type: "source",
        sourceType: name.toLowerCase().includes("apple") ? "appletv" : "generic",
        model: count > 1 ? `${name} ${i + 1}` : name, status: "new" });
    }
  }
  if (raw.rack?.sourcesTBD) warnings.push("Rack sources marked TBD on the walk — confirm encoder count");
  if (raw.rack?.location) notes.push(`Rack location: ${raw.rack.location}`);

  // control platform + aux counts for the license advisor
  const cs = String(raw.controlSystem || "").toLowerCase();
  if (cs.includes("savant")) sol.platforms = ["savant"];
  else if (cs.includes("control4") || cs.includes("c4")) sol.platforms = ["control4"];
  else if (cs.includes("josh")) sol.platforms = ["josh"];
  sol.auxCounts = { cameras: (raw.cameras || []).length, waps: raw.network?.waps || 0 };
  if (raw.network?.waps) notes.push(`${raw.network.waps} WAPs, ${raw.network.drops || 0} drops`);
  if (raw.notes) notes.push(raw.notes);

  return { kind: "sitewalk", job, notes, warnings, unmapped, walk };
}

/* ---------- drawing the rack from a walk ----------
   A walk records rooms, not boxes. The field rules turn it into a first draft:
   TVs "on system" → MXNet (an encoder per rack source, a decoder per TV);
   house-fed speaker zones → multi-zone amps (8 zones each), behind Savant AVB
   on a Savant job; 5.1/7.1 rooms and passive soundbars → a receiver per room.
   Everything it adds is ordinary gear + hookup, editable like anything drawn
   by hand. Mutates res.job; returns lines for the review screen. */
export function drawFromWalk(res, catalog) {
  const job = res.job, sol = job.solutions[0], rack = sol.racks[0], walk = res.walk || {};
  const said = [], warn = [];
  const taken = new Set([...job.house.zones.flatMap(z => [z.id, ...z.endpoints.map(e => e.id)]),
    ...rack.devices.map(d => d.id), ...sol.localDevices.map(d => d.id)]);
  const freeId = base => { let id = base, n = 2; while (taken.has(id)) id = `${base}-${n++}`; taken.add(id); return id; };
  const add = (base, type, ref, extra = {}) => {
    const c = catalog?.devices?.[ref];
    const d = { id: freeId(base), type, ...(c ? { catalogRef: ref } : {}), model: c ? productName(c) : base, status: "new", ...extra };
    rack.devices.push(d); return d.id;
  };
  const conn = (from, to, signal) => sol.connections.push({ from, to, signal });
  const epOf = z => ({ tv: z.endpoints.find(e => e.type === "display"), spk: z.endpoints.find(e => e.type === "speakers" && e.config !== "landscape"),
    land: z.endpoints.find(e => e.config === "landscape") });
  const zones = job.house.zones, w = z => walk[z.id] || { video: "none", audioFeed: "house" };
  const sources = rack.devices.filter(d => d.type === "source");
  const wantsAvr = z => { const { spk } = epOf(z); return /^surround/.test(spk?.config || "") || w(z).passiveBar; };
  const ampSet = s => s && !/^surround|^soundbar/.test(s.config || "");

  // video distribution: MXNet when any TV is on the system
  const onSystem = zones.filter(z => epOf(z).tv && w(z).video === "matrix");
  let sw = null;
  if (onSystem.length) {
    const ports = sources.length + onSystem.length + zones.filter(wantsAvr).length + 1;
    sw = add("sw", "avSwitch", ports <= 12 ? "avpro-mxnet-sw12" : "avpro-mxnet-sw24p");
    const cbx = add("cbx", "controlBox", "avpro-mxnet-cbox-ha");
    conn(cbx, sw, "network");
    for (const s of sources) {
      const enc = freeId("enc-" + s.id);
      sol.companions.push({ id: enc, type: "enc", serves: s.id, auto: true });
      conn(s.id, enc, "video"); conn(enc, sw, "video");
    }
    said.push(`MXNet: ${sources.length} encoder${sources.length === 1 ? "" : "s"}, ${onSystem.length} decoder${onSystem.length === 1 ? "" : "s"} on the ${rack.devices.find(d => d.id === sw).model}`);
    if (ports > 24) warn.push(`${ports} MXNet ports — more than one 24-port switch; add a second switch`);
    if (!sources.length) warn.push("TVs are on the system but the walk listed no rack sources — add them in GEAR");
  }

  // house audio: multi-zone amps, fed by Savant AVB on a Savant job
  const ampZones = zones.filter(z => (ampSet(epOf(z).spk) && w(z).audioFeed !== "local") || epOf(z).land);
  const amps = [];
  if (ampZones.length) {
    const blocks = ampZones.reduce((n, z) => n + (ampSet(epOf(z).spk) && w(z).audioFeed !== "local" ? 1 : 0) + (epOf(z).land ? 1 : 0), 0);
    for (let i = 0; i < Math.ceil(blocks / 8); i++) amps.push(add("amp", "amp", "anthem-mdx-16", { zones: 8 }));
    if (sol.platforms.includes("savant")) {
      const music = add("music", "source", "savant-pav-sms2001");
      const sin = add("sav-in", "audioInputModule", "savant-avb-input-module");
      const sout = add("sav-out", "audioOutputModule", "savant-avb-output-module");
      const avb = add("avb", "avbSwitch", null, { model: "AVB switch (Avnu-certified)" });
      conn(music, sin, "audio"); conn(avb, sin, "network"); conn(avb, sout, "network");
      for (const a of amps) conn(sout, a, "audio");
      said.push(`House audio: ${amps.length} multi-zone amp${amps.length === 1 ? "" : "s"} on Savant AVB`);
    } else said.push(`House audio: ${amps.length} multi-zone amp${amps.length === 1 ? "" : "s"} (pick their audio source in GEAR)`);
  }

  // room by room
  const avrs = [], shared = {};
  for (const z of zones) {
    const { tv, spk, land } = epOf(z), v = w(z).video;
    if (wantsAvr(z)) {
      const avr = add("avr", "avr", null, { model: `AV receiver — ${z.name}` });
      avrs.push(avr);
      if (spk) setSpeakers(job, sol, z, avr);
      if (tv && v === "matrix" && sw) {
        setVideo(job, sol, z, sw);                     // the TV off its decoder…
        conn(sw, avr, "video");                         // …and the receiver off the system for sound
      } else if (tv) setVideo(job, sol, z, avr, "balun", true);   // receiver drives the TV, eARC back
      if (w(z).local) warn.push(`${z.name}: receiver drawn in the rack — the walk put gear in the room; move it if it stays there`);
    } else if (tv) {
      if (v === "matrix" && sw) setVideo(job, sol, z, sw);
      else if (v === "local") {
        const here = sol.localDevices.find(d => d.zone === z.id);
        if (here) setVideo(job, sol, z, here.id);
      } else if (v === "direct" && sources[0]) {
        setVideo(job, sol, z, sources[0].id, "balun");
        warn.push(`${z.name}: direct rack feed drawn from ${sources[0].model} — confirm the source`);
      } else if (v === "none") warn.push(`${z.name}: the walk has no video feed for this TV — add one, or it stays flagged`);
    }
    if (ampSet(spk) && w(z).audioFeed !== "local" && !wantsAvr(z)) {
      // rooms sharing a walk audio zone get their own outputs on the SAME amp
      // (grouped in the control system; one output per room, never paralleled)
      const mate = w(z).audioZone && shared[w(z).audioZone];
      const room = a => sol.connections.filter(c => c.from === a && c.signal === "speaker").length < 8;
      const amp = (mate && room(mate) ? mate : null) || amps.find(room);
      if (amp) setSpeakers(job, sol, z, amp);
      if (amp && w(z).audioZone) shared[w(z).audioZone] ||= amp;
    }
    if (tv && /^soundbar/.test(spk?.config || "") && !wantsAvr(z))
      sol.connections.push({ from: tv.id, to: spk.id, signal: "audioReturn" });   // powered bar off the TV's eARC
    if (ampSet(spk) && w(z).audioFeed === "local" && !wantsAvr(z)) {
      // "local feed" on the walk = a small amp in the room (Sonos Amp class)
      const la = freeId(`amp-${z.id}`);
      sol.localDevices.push({ id: la, type: "amp", model: `Local amp — ${z.name}`, status: "new", zone: z.id, location: "at-display", zones: 1 });
      sol.connections.push({ from: la, to: spk.id, signal: "speaker" });
      warn.push(`${z.name}: speakers on a local amp in the room — pick the model`);
    }
    if (land) {
      const amp = amps.find(a => sol.connections.filter(c => c.from === a && c.signal === "speaker").length < 8);
      if (amp) sol.connections.push({ from: amp, to: land.id, signal: "speaker", channels: nextFreeOutputs(sol, amp, 2) });
    }
  }
  // receivers off the system still need sources: one receiver can take them all
  const unfed = avrs.filter(a => !sol.connections.some(c => c.to === a && c.signal === "video"));
  if (sw) for (const a of unfed) conn(sw, a, "video");                  // off the system, like any TV
  else if (unfed.length === 1) for (const s of sources) conn(s.id, unfed[0], "video");
  else if (unfed.length > 1) warn.push(`${unfed.length} receivers share the rack sources — add a matrix or pick sources per receiver in GEAR`);
  if (avrs.length) said.push(`${avrs.length} AV receiver${avrs.length === 1 ? "" : "s"} for surround / passive-soundbar rooms`);
  if (!said.length) said.push("Nothing on the walk needs rack gear — add distribution in GEAR");
  job.job.drawnFrom = "walk";
  return { notes: said, warnings: warn };
}

/* ---------- Blueprinted takeoff ---------- */
const BP_ZONE_CFG = {
  "Theater — 5.1 local": "surround-5.1",
  "Surround 5.1 — local": "surround-5.1",
  "2-ch — house amp": "stereo",
  "2-ch — local amp": "stereo",
};
const BP_CATEGORY = {
  Source: "source", Amplifier: "amp", Switching: "avSwitch", Control: "controlBox",
  Network: "networkSwitch", Lighting: null, Display: null,
};
const BP_SIGNAL = { hdmi: "video", video: "video", link: "video", audio: "audio", ethernet: "network", network: "network",
  preamp_stereo_captive_screw: "audio", rca_stereo: "audio", optical_digital: "audio" };
/* what a Savant component really is, read from its model (Ryan's real configs, 2026-10-02): the
   category alone filed MXNet encoders as matrices, Savant audio modules as AV switches and the AVB
   switch as a LAN switch. A rack component the model names is mapped to its real type — and to the
   catalog where it's in it; an MXNet encoder becomes the encoder chip on its source. */
const BP_MODEL = [
  [/MXNET[-\s]*\S*1G-T\b|MXNET[-\s]*\S*-E\b|AVDM|\bencoder\b/i, { enc: true }],
  [/MXNET[-\s]*\S*1G-R\b|\bdecoder\b/i, { dec: true }],
  [/PAV-AIM|\bAIM\b/i, { type: "audioInputModule", catalogRef: "savant-pav-aim7c" }],
  [/PAV-AOM|\bAOM\b/i, { type: "audioOutputModule", catalogRef: "savant-pav-aom8c" }],
  [/M4250|GSM4212P/i, { type: "avbSwitch", catalogRef: "netgear-m4250-10g2f-poe" }],
  [/ESN-AVB|\bAVB\b/i, { type: "avbSwitch" }],
  [/MXnet|MXNET-SW/i, { type: "avSwitch" }],
  [/MRX|receiver|\bAVR\b/i, { type: "avr" }],
];

// a Blueprinted list field that isn't a list (hand-edited, or a future format) reads as empty
const arr = v => Array.isArray(v) ? v : [];
export function importBlueprinted(raw) {
  const notes = [], warnings = [], unmapped = [];
  const job = skeletonJob(typeof raw.client === "string" && raw.client ? `${raw.client} — Upgrade` : "Blueprinted Import", raw.client, "");
  const sol = job.solutions[0];
  sol.platforms = ["savant"]; // it came off a Savant host
  notes.push(`Old system: ${raw.system?.hostModel || "unknown host"} · Blueprint ${raw.system?.blueprintVersion || "?"} · config saved ${raw.configSaved || "?"}`);
  for (const a of arr(raw.system?.advisories)) warnings.push(String(a));
  notes.push(raw.note || "Everything below is the OLD system as programmed — verify on the walk");

  const newId = idMaker();
  for (const r of (Array.isArray(raw.rooms) ? raw.rooms : []).filter(r => r && typeof r === "object")) {
    const zname = String(typeof r.name === "string" ? r.name : "Zone").trim() || "Zone";
    if (r.zoneType === "No AV endpoints") { unmapped.push(`${zname}: no AV — skipped`); continue; }
    const zid = newId("z-" + slug(zname));
    const zone = { id: zid, name: zname, scope: "included", endpoints: [] };
    const znotes = [];
    const cfg = BP_ZONE_CFG[r.zoneType];
    if (cfg) {
      const ep = { id: zid + "-spk", type: "speakers", config: cfg, status: "ofe" };
      if (cfg === "stereo") ep.count = 2;
      zone.endpoints.push(ep);
      if (r.zoneType.includes("local")) znotes.push(r.zoneType.includes("Theater") ? "theater — local AVR" : "local amp/AVR in room");
    }
    if (r.tv) {
      const old = arr(r.oldTv).find(o => o && typeof o === "object");
      const ep = { id: zid + "-tv", type: "display", displayType: "tv",
        brand: typeof old?.make === "string" ? old.make : "", size: +old?.size > 0 ? +old.size : 65, status: "ofe" };
      if (!old?.size) ep.confirm = ["size"];
      zone.endpoints.push(ep);
      if (old) znotes.push(`old TV: ${[old.make, old.model].filter(Boolean).join(" ")}`);
      if (r.videoFeed === "matrix") znotes.push("was on video distribution");
    }
    for (const f of arr(r.flags)) warnings.push(`${zname}: ${f}`);
    for (const a of arr(r.avrs)) znotes.push(`old AVR: ${a}`);
    for (const s of arr(r.inRoomSources)) znotes.push(`in-room source: ${s}`);
    if (arr(r.otherSystems).length) unmapped.push(`${zname}: non-AV systems — ${arr(r.otherSystems).join(", ")}`);
    if (znotes.length) zone.note = znotes.join(" · ");
    if (!zone.endpoints.length) { unmapped.push(`${zname} (${r.zoneType}): nothing mappable — skipped`); continue; }
    job.house.zones.push(zone);
  }

  // rack components → devices (old gear = OFE until replaced); MXNet encoders → encoder chips on
  // their sources (found through the config's HDMI connections), after the sources exist
  const nameToId = {}, encoders = [];
  const conns = arr(raw.connections).filter(c => c && typeof c === "object");
  for (const c of arr(raw.rack).filter(c => c && typeof c === "object")) {
    const text = `${c.manufacturer || ""} ${c.model || ""} ${c.component || ""}`;
    const hit = BP_MODEL.find(([re]) => re.test(text))?.[1];
    if (hit?.enc) { encoders.push(c); continue; }
    if (hit?.dec) continue;                                           // a decoder lives at its TV — hookup puts it there
    const type = hit?.type || BP_CATEGORY[c.category];
    if (type === null || type === undefined) {
      if (c.category && !["Lighting", "Display"].includes(c.category)) unmapped.push(`rack: ${c.component} (${c.category}) — unmapped category`);
      continue;
    }
    const t = !hit && type === "avSwitch" && /matrix|mx/i.test(c.model || c.component) ? "videoMatrix" : type;
    // a placeholder amp named for its channels ("MDX 12") holds that many — not the generic 8 zones
    const ch = t === "amp" && /generic/i.test(c.manufacturer || "") && +(String(c.component || "").match(/(\d+)\s*$/) || [])[1];
    const d = { id: uid("dev"), type: t, model: [c.manufacturer, c.model].filter(Boolean).join(" ") || c.component, status: "ofe",
      ...(hit?.catalogRef ? { catalogRef: hit.catalogRef } : {}), ...(ch >= 4 && ch <= 32 && ch % 2 === 0 ? { zones: ch / 2 } : {}) };
    sol.racks[0].devices.push(d);
    nameToId[c.component] = d.id;
  }
  for (const c of encoders) {
    const feed = conns.find(k => k.sink === c.component && /hdmi|video/i.test(k.signal || "") && nameToId[k.source]);
    if (!feed) { unmapped.push(`rack: ${c.component} (MXNet encoder) — no source feeds it in the config`); continue; }
    const comp = { id: uid("enc"), type: "enc", serves: nameToId[feed.source], auto: true };
    // its analog audio out went to a Savant input module → the AVDM encoder, wired the same way
    if (conns.some(k => k.source === c.component && /preamp|rca|audio/i.test(k.signal || ""))) comp.avdm = true;
    (sol.companions ||= []).push(comp);
    nameToId[c.component] = comp.id;
  }
  // receivers that were in the rooms (with their own MXNet decoders) come in as receivers the
  // room's hookup can use; the room says where they were
  const roomAvr = {};
  for (const r of (Array.isArray(raw.rooms) ? raw.rooms : []).filter(r => r && typeof r === "object")) {
    const z = job.house.zones.find(z => z.name === String(r.name || "").trim());
    for (const m of arr(r.avrs).filter(m => typeof m === "string" && m.trim())) {
      if (!z) continue;
      const id = uid("avr");
      sol.racks[0].devices.push({ id, type: "avr", model: `${m.trim()} — ${z.name}`, status: "ofe" });
      roomAvr[z.id] = id;
      z.note = [z.note, "the receiver was in the room on the old system"].filter(Boolean).join(" · ");
    }
  }

  // programmed wiring graph → starter connections (rack-to-rack only; room ends need the walk)
  let mapped = 0, skipped = 0;
  for (const c of arr(raw.connections).filter(c => c && typeof c === "object")) {
    const from = nameToId[c.source], to = nameToId[c.sink];
    const signal = BP_SIGNAL[String(c.signal || "").toLowerCase()];
    if (from && to && signal) { sol.connections.push({ from, to, signal }); mapped++; }
    else skipped++;
  }
  if (mapped) notes.push(`${mapped} rack connections carried over from the old config`);
  if (skipped) unmapped.push(`${skipped} connections skipped (room-side, control, or unmapped ends)`);
  // the rooms wire themselves, the same way quick-add does: TVs off the MXNet switch / matrix,
  // a surround room on its receiver, stereo rooms on the next free amp zone
  // speakers the old config drove off a rack amp stay on that amp
  for (const k of conns.filter(k => /^speakers/.test(k.signal || "") && nameToId[k.source])) {
    const z = job.house.zones.find(z => z.name === String(k.sinkZone || "").trim());
    const amp = sol.racks[0].devices.find(d => d.id === nameToId[k.source] && d.type === "amp");
    if (z && amp) setSpeakers(job, sol, z, amp.id);
  }
  // powered-speaker placeholders fed line-level from the rack: their real amp isn't in the config
  for (const k of conns.filter(k => /rca|preamp/.test(k.signal || "") && / speakers$/i.test(k.sink || ""))) {
    const z = job.house.zones.find(z => z.name === String(k.sinkZone || "").trim());
    if (z && !/line-level/.test(z.note || "")) z.note = [z.note, `the old config fed these speakers line-level from ${k.source} — their amp isn't in it`].filter(Boolean).join(" · ");
  }
  let wired = 0;
  for (const z of job.house.zones) {
    try { autoHookup(job, sol, z, { avr: !!roomAvr[z.id] }); wired++; } catch (e) { warnings.push(`${z.name}: couldn't wire it automatically (${e.message})`); }
  }
  if (wired) notes.push(`Rooms wired from the rack the way quick-add would — check them against the walk`);
  // Blueprinted only sees what the Savant config models (Ryan 2026-10-02: "it doesn't have everything")
  warnings.push("A Savant config doesn't list everything (MXNet control box, PoE injectors, local power supplies, extra amps) — check the original quote or system design (✦ Ask AI → Check against the quote)");
  if (raw.cameras?.length) sol.auxCounts = { cameras: raw.cameras.length };

  return { kind: "blueprinted", job, notes, warnings, unmapped };
}

/* ---------- AVWalk → SignalPath handoff link ----------
   AVWalk's "Send to SignalPath" opens …/signalpath/#avwalk=<payload>: the
   survey JSON, raw-DEFLATE compressed (Apple's .zlib = RFC 1951, no header),
   base64url. It rides in the #fragment, so it never reaches a server; the app
   strips it from the address bar on arrival. */
const b64u = {
  enc: bytes => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); },
  dec: str => { if (!/^[A-Za-z0-9_-]+$/.test(str)) throw new Error("the link is damaged (not base64url)");
    const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
    return Uint8Array.from(bin, ch => ch.charCodeAt(0)); },
};
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
export async function encodeHandoff(obj) {
  return b64u.enc(await pipe(new TextEncoder().encode(JSON.stringify(obj)), new CompressionStream("deflate-raw")));
}
/* null when the hash isn't a handoff; throws on a damaged one */
export async function decodeHandoff(hash) {
  const m = String(hash || "").match(/^#avwalk=(.*)$/s);
  if (!m) return null;
  let text;
  try { text = new TextDecoder().decode(await pipe(b64u.dec(m[1]), new DecompressionStream("deflate-raw"))); }
  catch (e) { throw new Error("AVWalk link is damaged or cut off — send it again (" + e.message + ")"); }
  return JSON.parse(text);
}

/* ---------- the one door ---------- */
/* A foreign survey is read field by field, and a field holding the wrong kind
   of value (a list where a room name goes, a number where a list goes) used to
   crash the adapter or print "[object Object]" on the drawing. This pass makes
   every field the adapters read the kind they expect — wrong kinds are dropped,
   the way a missing field is. */
const TEXT_KEYS = new Set(["name", "floor", "zoneName", "equipLoc", "audStatus", "tvStatus", "audio", "audioFeed", "videoFeed", "wiring", "barType",
  "thDisplay", "thScreen", "zoneType", "notes", "note", "make", "model", "manufacturer", "component", "category", "signal", "source", "sink",
  "client", "address", "controlSystem", "jobType", "location", "configSaved", "hostModel", "blueprintVersion", "tvSize"]);
const TEXT_LIST_KEYS = new Set(["avrs", "flags", "inRoomSources", "localSources", "otherSystems", "advisories", "habits"]);
const OBJ_LIST_KEYS = new Set(["rooms", "oldTv", "rack", "connections", "cameras"]);
export function tidySurvey(v, depth = 0) {
  if (!v || typeof v !== "object" || depth > 40) return v;
  if (Array.isArray(v)) { v.forEach(x => tidySurvey(x, depth + 1)); return v; }
  for (const [k, x] of Object.entries(v)) {
    if (TEXT_KEYS.has(k) && x != null && typeof x !== "string") { if (typeof x === "number" && Number.isFinite(x)) v[k] = String(x); else delete v[k]; }
    else if (TEXT_LIST_KEYS.has(k)) v[k] = Array.isArray(x) ? x.filter(e => typeof e === "string" || typeof e === "number") : [];
    else if (OBJ_LIST_KEYS.has(k) && x != null && !Array.isArray(x) && !(k === "rack" && typeof x === "object")) delete v[k];
    else if (OBJ_LIST_KEYS.has(k) && Array.isArray(x)) { v[k] = x.filter(e => e && typeof e === "object"); tidySurvey(v[k], depth + 1); }
    else tidySurvey(x, depth + 1);
  }
  return v;
}

export function importAny(raw) {
  stripUnsafe(raw);
  const kind = sniff(raw);
  if (kind === "signalpath") return { kind, job: assertJobShape(raw), notes: [], warnings: [], unmapped: [] };
  if (kind === "sitewalk") return importSiteWalk(tidySurvey(raw));
  if (kind === "blueprinted") return importBlueprinted(tidySurvey(raw));
  throw new Error("Unrecognized file — expected SignalPath, SiteWalk/AVWalk, or Blueprinted JSON");
}

/* ---------- re-import: refresh an existing job's House in place ----------
   Zones matched by normalized name. Solutions are kept untouched; existing
   zones not present in the import are kept (reported, never deleted). */
export function mergeHouse(existingJob, importedJob) {
  const changes = [];
  const norm = s => String(s || "").trim().toLowerCase();
  const house = existingJob.house;
  house.zones ||= [];
  const byName = new Map(house.zones.map(z => [norm(z.name), z]));
  // every id already in the job (zones, endpoints, and all solution gear) —
  // an added zone must not reuse one, or connections re-point silently
  const taken = new Set();
  for (const z of house.zones) { taken.add(z.id); for (const e of z.endpoints || []) taken.add(e.id); }
  for (const sol of existingJob.solutions || []) {
    for (const r of sol.racks || []) for (const d of r.devices || []) taken.add(d.id);
    for (const d of [...(sol.localDevices || []), ...(sol.companions || [])]) taken.add(d.id);
  }
  const freeId = base => { let id = base, n = 2; while (taken.has(id)) id = `${base}-${n++}`; taken.add(id); return id; };
  // speakers come in two kinds a walk records separately: the room's main
  // set and a landscape array — never let one overwrite the other
  const kind = e => e.type === "speakers" ? (e.config === "landscape" ? "landscape" : "speakers") : e.type;

  for (const inc of importedJob.house.zones) {
    const cur = byName.get(norm(inc.name));
    if (!cur) {
      const oldId = inc.id;
      inc.id = freeId(inc.id);
      for (const e of inc.endpoints || []) {
        const rebased = oldId !== inc.id && e.id.startsWith(oldId) ? inc.id + e.id.slice(oldId.length) : e.id;
        e.id = freeId(rebased);
      }
      house.zones.push(inc);
      changes.push({ kind: "added", zone: inc.name });
      continue;
    }
    // refresh endpoints by kind, one-to-one; ids stay stable so connections survive
    cur.endpoints ||= [];
    const claimed = new Set();
    for (const ep of inc.endpoints || []) {
      const mine = cur.endpoints.find(e => !claimed.has(e) && kind(e) === kind(ep));
      if (!mine) { ep.id = freeId(ep.id); cur.endpoints.push(ep); claimed.add(ep); changes.push({ kind: "endpoint-added", zone: cur.name, type: ep.type }); continue; }
      claimed.add(mine);
      const before = JSON.stringify({ ...mine, id: 0 });
      const patch = { ...ep };
      delete patch.id;
      // a walk only knows what it saw: blank brand and a TBD (defaulted) size
      // must not erase what the designer already entered
      if (!patch.brand) delete patch.brand;
      if (patch.confirm?.includes("size") && mine.size && !mine.confirm?.includes("size")) { delete patch.size; delete patch.confirm; }
      Object.assign(mine, patch);
      if (!ep.confirm?.length && !patch.confirm) delete mine.confirm;   // the import answered the open question
      if (mine.config !== "stereo" && mine.config) delete mine.count;   // stale pair count from an old stereo set
      if (before !== JSON.stringify({ ...mine, id: 0 })) changes.push({ kind: "updated", zone: cur.name, type: ep.type });
    }
    if (inc.note && inc.note !== cur.note) { cur.note = inc.note; }
    byName.delete(norm(inc.name));
  }
  for (const [, z] of byName) changes.push({ kind: "kept", zone: z.name, note: "not in import — left unchanged" });
  // areas: adopt the import's list when the job has none; otherwise add any the
  // new zones reference, so no zone points at an area that doesn't exist
  const incAreas = importedJob.house.areas || [];
  if (incAreas.length && !house.areas?.length) house.areas = incAreas;
  else if (incAreas.length) {
    const have = new Set(house.areas.map(a => a.id));
    for (const z of house.zones) if (z.area && !have.has(z.area)) {
      const a = incAreas.find(x => x.id === z.area);
      if (a) { house.areas.push(a); have.add(a.id); } else delete z.area;
    }
  }
  return changes;
}
