/* SignalPath importers — the one import door (spec §6).
   sniff() routes by content, each adapter maps a foreign export into the House
   model, and mergeHouse() refreshes an existing job in place (zones matched by
   name, Solutions kept). Lenient by design: unknown fields land in notes and
   the review list — never a hard failure. Pure module, no DOM. */

const uid = p => p + "-" + Math.random().toString(36).slice(2, 7);
const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || uid("z");
const today = () => new Date().toISOString().slice(0, 10);

/* Imported JSON is untrusted. Two defenses before anything touches app state:
   strip prototype-pollution key names everywhere, and require the skeleton a
   native file must have before it may replace a working job. */
const UNSAFE_KEYS = ["__proto__", "constructor", "prototype"];
export function stripUnsafe(v, depth = 0) {
  if (depth > 64 || !v || typeof v !== "object") return v;
  if (Array.isArray(v)) { for (const x of v) stripUnsafe(x, depth + 1); return v; }
  for (const k of Object.keys(v)) {
    if (UNSAFE_KEYS.includes(k)) delete v[k];
    else stripUnsafe(v[k], depth + 1);
  }
  return v;
}

export function assertJobShape(job) {
  const bad = m => { throw new Error("SignalPath file rejected: " + m); };
  if (job.schemaVersion !== 1) bad("unsupported schemaVersion " + job.schemaVersion);
  if (!job.job || typeof job.job !== "object") bad("missing job block");
  if (!job.house || !Array.isArray(job.house.zones)) bad("missing house.zones");
  if (!Array.isArray(job.solutions) || !job.solutions.length) bad("missing solutions");
  for (const z of job.house.zones) {
    if (!z || typeof z.id !== "string" || !z.id) bad("zone without id");
    if (!Array.isArray(z.endpoints)) z.endpoints = [];
    for (const e of z.endpoints) if (!e || typeof e.id !== "string" || !e.id) bad(`endpoint without id in zone ${z.id}`);
  }
  for (const sol of job.solutions) {
    if (!sol || typeof sol !== "object") bad("bad solution entry");
    if (!Array.isArray(sol.racks)) sol.racks = [];
    if (!Array.isArray(sol.connections)) sol.connections = [];
    if (!Array.isArray(sol.localDevices)) sol.localDevices = sol.localDevices == null ? [] : bad("localDevices is not a list");
    for (const r of sol.racks) if (!Array.isArray(r.devices)) r.devices = [];
    for (const c of sol.connections) if (!c || typeof c !== "object") bad("bad connection entry");
  }
  return job;
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
  const notes = [], warnings = [], unmapped = [];
  const job = skeletonJob(raw.client ? `${raw.client} Residence` : "Site Walk Import", raw.client, raw.address);
  const sol = job.solutions[0];

  // areas from floors (only when the walk recorded more than one)
  const floors = [...new Set((raw.rooms || []).map(r => (r.floor || "").trim()).filter(Boolean))];
  if (floors.length > 1) job.house.areas = floors.map(f => ({ id: "area-" + slug(f), name: f }));

  for (const r of raw.rooms || []) {
    const zname = (r.zoneName || r.name || "Zone").trim();
    const zid = "z-" + slug(zname);
    const zone = { id: zid, name: zname, scope: "included", endpoints: [] };
    if (floors.length > 1 && r.floor) zone.area = "area-" + slug(r.floor);
    const znotes = [];

    // speakers
    const audio = r.audio || "tv";
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
      if (r.videoFeed === "matrix") znotes.push("video: matrix feed");
      else if (r.videoFeed === "direct") znotes.push("video: direct rack feed");
      else if (r.videoFeed === "local" || (r.localSources || []).length) znotes.push("video: local source");
      for (const src of r.localSources || []) {
        sol.localDevices.push({ id: uid(zid + "-src"), type: "source", sourceType: "appletv",
          model: src, status: "new", zone: zid, location: (r.equipLoc || "").toLowerCase().includes("rack") ? "remote" : "at-display" });
      }
    }
    if (r.isTheater) znotes.push("theater room");
    if (r.wiring) znotes.push(`wiring: ${r.wiring}`);
    if (r.notes) znotes.push(r.notes);
    for (const k of ["mount", "bracket", "fireplace", "spkType", "subLoc"])
      if (r[k] && r[k] !== false) unmapped.push(`${zname}: ${k} = ${r[k]}`);
    if (znotes.length) zone.note = znotes.join(" · ");
    if (!zone.endpoints.length) { unmapped.push(`${zname}: no AV endpoints — skipped`); continue; }
    job.house.zones.push(zone);
  }

  // rack sources → starter devices
  for (const [name, count] of Object.entries(raw.rack?.sources || {})) {
    for (let i = 0; i < (count || 0); i++) {
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
  notes.push("Distribution gear and feeds are not part of a walk — add them in GEAR");

  return { kind: "sitewalk", job, notes, warnings, unmapped };
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
const BP_SIGNAL = { hdmi: "video", video: "video", audio: "audio", ethernet: "network", network: "network" };

export function importBlueprinted(raw) {
  const notes = [], warnings = [], unmapped = [];
  const job = skeletonJob(raw.client ? `${raw.client} — Upgrade` : "Blueprinted Import", raw.client, "");
  const sol = job.solutions[0];
  sol.platforms = ["savant"]; // it came off a Savant host
  notes.push(`Old system: ${raw.system?.hostModel || "unknown host"} · Blueprint ${raw.system?.blueprintVersion || "?"} · config saved ${raw.configSaved || "?"}`);
  for (const a of raw.system?.advisories || []) warnings.push(a);
  notes.push(raw.note || "Everything below is the OLD system as programmed — verify on the walk");

  for (const r of raw.rooms || []) {
    if (r.zoneType === "No AV endpoints") { unmapped.push(`${r.name}: no AV — skipped`); continue; }
    const zid = "z-" + slug(r.name);
    const zone = { id: zid, name: r.name, scope: "included", endpoints: [] };
    const znotes = [];
    const cfg = BP_ZONE_CFG[r.zoneType];
    if (cfg) {
      const ep = { id: zid + "-spk", type: "speakers", config: cfg, status: "ofe" };
      if (cfg === "stereo") ep.count = 2;
      zone.endpoints.push(ep);
      if (r.zoneType.includes("local")) znotes.push(r.zoneType.includes("Theater") ? "theater — local AVR" : "local amp/AVR in room");
    }
    if (r.tv) {
      const old = (r.oldTv || [])[0];
      const ep = { id: zid + "-tv", type: "display", displayType: "tv",
        brand: old?.make || "", size: old?.size || 65, status: "ofe" };
      if (!old?.size) ep.confirm = ["size"];
      zone.endpoints.push(ep);
      if (old) znotes.push(`old TV: ${[old.make, old.model].filter(Boolean).join(" ")}`);
      if (r.videoFeed === "matrix") znotes.push("was on video distribution");
    }
    for (const f of r.flags || []) warnings.push(`${r.name}: ${f}`);
    for (const a of r.avrs || []) znotes.push(`old AVR: ${a}`);
    for (const s of r.inRoomSources || []) znotes.push(`in-room source: ${s}`);
    if ((r.otherSystems || []).length) unmapped.push(`${r.name}: non-AV systems — ${r.otherSystems.join(", ")}`);
    if (znotes.length) zone.note = znotes.join(" · ");
    if (!zone.endpoints.length) { unmapped.push(`${r.name} (${r.zoneType}): nothing mappable — skipped`); continue; }
    job.house.zones.push(zone);
  }

  // rack components → devices (old gear = OFE until replaced)
  const nameToId = {};
  for (const c of raw.rack || []) {
    const type = BP_CATEGORY[c.category];
    if (type === null || type === undefined) {
      if (c.category && !["Lighting", "Display"].includes(c.category)) unmapped.push(`rack: ${c.component} (${c.category}) — unmapped category`);
      continue;
    }
    const t = type === "avSwitch" && /matrix|mx/i.test(c.model || c.component) ? "videoMatrix" : type;
    const d = { id: uid("dev"), type: t, model: [c.manufacturer, c.model].filter(Boolean).join(" ") || c.component, status: "ofe" };
    sol.racks[0].devices.push(d);
    nameToId[c.component] = d.id;
  }

  // programmed wiring graph → starter connections (rack-to-rack only; room ends need the walk)
  let mapped = 0, skipped = 0;
  for (const c of raw.connections || []) {
    const from = nameToId[c.source], to = nameToId[c.sink];
    const signal = BP_SIGNAL[String(c.signal || "").toLowerCase()];
    if (from && to && signal) { sol.connections.push({ from, to, signal }); mapped++; }
    else skipped++;
  }
  if (mapped) notes.push(`${mapped} rack connections carried over from the old config`);
  if (skipped) unmapped.push(`${skipped} connections skipped (room-side, control, or unmapped ends)`);
  if (raw.cameras?.length) sol.auxCounts = { cameras: raw.cameras.length };

  return { kind: "blueprinted", job, notes, warnings, unmapped };
}

/* ---------- the one door ---------- */
export function importAny(raw) {
  stripUnsafe(raw);
  const kind = sniff(raw);
  if (kind === "signalpath") return { kind, job: assertJobShape(raw), notes: [], warnings: [], unmapped: [] };
  if (kind === "sitewalk") return importSiteWalk(raw);
  if (kind === "blueprinted") return importBlueprinted(raw);
  throw new Error("Unrecognized file — expected SignalPath, SiteWalk/AVWalk, or Blueprinted JSON");
}

/* ---------- re-import: refresh an existing job's House in place ----------
   Zones matched by normalized name. Solutions are kept untouched; existing
   zones not present in the import are kept (reported, never deleted). */
export function mergeHouse(existingJob, importedJob) {
  const changes = [];
  const norm = s => String(s || "").trim().toLowerCase();
  const byName = new Map(existingJob.house.zones.map(z => [norm(z.name), z]));
  for (const inc of importedJob.house.zones) {
    const cur = byName.get(norm(inc.name));
    if (!cur) {
      existingJob.house.zones.push(inc);
      changes.push({ kind: "added", zone: inc.name });
      continue;
    }
    // refresh endpoints by type, keep ids stable so connections survive
    for (const ep of inc.endpoints) {
      const mine = (cur.endpoints || []).find(e => e.type === ep.type);
      if (!mine) { cur.endpoints.push(ep); changes.push({ kind: "endpoint-added", zone: cur.name, type: ep.type }); }
      else {
        const before = JSON.stringify({ ...mine, id: 0 });
        Object.assign(mine, { ...ep, id: mine.id });
        if (before !== JSON.stringify({ ...mine, id: 0 })) changes.push({ kind: "updated", zone: cur.name, type: ep.type });
      }
    }
    if (inc.note && inc.note !== cur.note) { cur.note = inc.note; }
    byName.delete(norm(inc.name));
  }
  for (const [, z] of byName) changes.push({ kind: "kept", zone: z.name, note: "not in import — left unchanged" });
  if (importedJob.house.areas?.length && !existingJob.house.areas?.length)
    existingJob.house.areas = importedJob.house.areas;
  return changes;
}
