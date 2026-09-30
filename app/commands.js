/* ---------- commands.js — edit a job by command ----------
   One small vocabulary for changing a job, used three ways: typed phrases in
   the quick-add box ("connect cable box to mrx"), a pasted list from Claude,
   and the built-in AI. Every command resolves plain names ("mrx", "amp 2",
   "master", "family room tv") against the job, runs on a COPY of the job,
   and reports what it did in words — so the caller can preview before
   anything changes, and an AI's mistakes stop at the preview. Commands go
   through the same functions as the editor (hookup.js, quickadd.js), so the
   editor's rules hold: outputs never land on sources, amps take their next
   free outputs, eARC defaults, pre-wire zones stay pre-wire.
   Pure functions over the raw job — no DOM. */

import { describeNode, productName, TYPE_NAME, SPEAKER_SETUP, SIGNAL_NAME, SCOPE_NAME, STATUS_NAME, REMOTE_NAME, AUDIO_BACK_NAME } from "./names.js";
import { readHookup, setVideo, setSpeakers, setAudioBack, addRackDevice, autoHookup, nextFreeOutputs, outputsNeeded, RUNS } from "./hookup.js";
import { parseQuick } from "./quickadd.js";

/* ---------- the vocabulary (also what the AI is told) ---------- */
export const OPS = {
  add_zones:   { args: "text", eg: `{"op":"add_zones","text":"theater 7.1 85 sony avr, kitchen stereo"}`,
                 about: "Add zones in quick-add shorthand: name + speaker setup (stereo, 2.1, 5.1, 7.1, soundbar, landscape 8) + TV size + brand; 'matrix' feeds the TV from the rack's matrix, 'avr' gives the zone its own receiver; 'ofe', 'prewire', 'future', 'no tv'. Comma = next zone. New zones are wired automatically where the rack allows." },
  set_zone:    { args: "zone, name?, speakers?, display?, tv_size?, brand?, scope?, speakers_status?, tv_status?, remote?, confirm_size?",
                 eg: `{"op":"set_zone","zone":"patio","tv_size":75,"tv_status":"ofe"}`,
                 about: "Change a zone. speakers: none|mono|stereo|2.1|5.1|7.1|7.1.4|soundbar|soundbar-sub|landscape. display: none|tv|projector. scope: included|prewire|future. statuses: new|ofe. remote: none|savant|appletv|josh|factory." },
  delete_zone: { args: "zone", eg: `{"op":"delete_zone","zone":"gym"}`, about: "Remove a zone and everything wired to it." },
  hookup:      { args: "zone, tv_from?, run?, speakers_from?, outputs?, audio_back?, audio_back_to?",
                 eg: `{"op":"hookup","zone":"family room","tv_from":"receiver","speakers_from":"receiver","audio_back":"earc"}`,
                 about: "What feeds a zone. tv_from / speakers_from: a box in the rack (or 'none'). run: balun|decoder|direct. outputs: amp outputs like '5-6' (default: next free). audio_back: earc|earc+optical|earc-kit|optical|none (earc-kit = AVPro eARC extender kit, full Atmos back over one Cat6A; audio_back_to for optical: a receiver or audio input module)." },
  connect:     { args: "from, to, signal?, outputs?, scope?", eg: `{"op":"connect","from":"cable box","to":"mrx"}`,
                 about: "Plug one thing into another. from/to: a box, or '<zone> tv' / '<zone> speakers'. signal (guessed if left out): video|audio|speaker|network|audioReturn." },
  disconnect:  { args: "from?, to, signal?", eg: `{"op":"disconnect","from":"mdx16","to":"kitchen speakers"}`,
                 about: "Remove the connection(s) between two things (or everything feeding 'to' when 'from' is left out)." },
  add_device:  { args: "product, name?, type?", eg: `{"op":"add_device","product":"Anthem MRX 1140 8K"}`,
                 about: "Add a box to the rack. product: a catalog product (fuzzy match), else a plain model with type: source|avr|amp|videoMatrix|avSwitch|avbSwitch|audioInputModule|audioOutputModule|controlBox|splitter|host." },
  set_device:  { args: "device, name?, product?, status?, zones?", eg: `{"op":"set_device","device":"amp","product":"Anthem MDX-16"}`,
                 about: "Change a box: rename, link to a catalog product, status new|ofe, amp zone count." },
  delete_device: { args: "device", eg: `{"op":"delete_device","device":"turn table"}`, about: "Remove a box and its connections." },
  set_job:     { args: "name?, client?, address?, drawn_by?", eg: `{"op":"set_job","client":"The Smiths"}`, about: "Job details for the title block." },
  add_revision: { args: "description", eg: `{"op":"add_revision","description":"Patio TV to 75\\""}`, about: "Log a revision on the title block." },
};

/* ---------- name resolution ---------- */
const norm = s => String(s ?? "").toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ").trim();
const compact = s => norm(s).replace(/[^a-z0-9]/g, "");
const rackDevices = sol => (sol.racks || []).flatMap(r => r.devices || []);
const ORDINAL = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4 };
const TYPE_WORDS = [
  [/^(av )?receivers?$|^avrs?$/, "avr"], [/^(multi ?zone )?amps?$|^amplifiers?$/, "amp"],
  [/^(hdmi |video )?matrix$|^matrices$/, "videoMatrix"], [/^(av over ip |mxnet |video )?switch$/, "avSwitch"],
  [/^avb( switch)?$|^network switch$/, "avbSwitch"], [/^(audio )?input module$/, "audioInputModule"],
  [/^(audio )?output module$/, "audioOutputModule"], [/^control( box| processor)?$/, "controlBox"],
  [/^splitter$/, "splitter"], [/^host$/, "host"],
];
const typeOfWords = w => TYPE_WORDS.find(([re]) => re.test(w))?.[1] || null;

export function findZone(job, text) {
  const t = norm(text).replace(/^the /, "");
  if (!t) return { error: "no zone named" };
  const zones = job.house.zones;
  const exact = zones.filter(z => norm(z.name) === t || z.id === text);
  if (exact.length === 1) return { zone: exact[0] };
  const pre = zones.filter(z => norm(z.name).startsWith(t) || compact(z.name).startsWith(compact(t)));
  if (pre.length === 1) return { zone: pre[0] };
  const inc = zones.filter(z => norm(z.name).includes(t));
  if (inc.length === 1) return { zone: inc[0] };
  const c = (pre.length ? pre : inc).map(z => z.name);
  return { error: c.length ? `"${text}" could be ${c.join(" or ")}` : `no zone called "${text}"`, candidates: c };
}

export function findDevice(job, sol, text) {
  let t = norm(text).replace(/^(the|a|an) /, "");
  if (!t) return { error: "no box named" };
  const devs = rackDevices(sol);
  const byId = devs.find(d => d.id === text || d.id === t); if (byId) return { device: byId };
  // "amp 2", "second receiver"
  let nth = null;
  const m1 = t.match(/^(.*?)\s*#?(\d)$/), m2 = t.match(/^(first|second|third|fourth|1st|2nd|3rd|4th) (.*)$/);
  if (m2) { nth = ORDINAL[m2[1]]; t = m2[2]; } else if (m1 && typeOfWords(m1[1])) { nth = +m1[2]; t = m1[1]; }
  const type = typeOfWords(t);
  if (type) {
    const list = devs.filter(d => d.type === type || (type === "avSwitch" && d.type === "avbSwitch"));
    if (nth) return list[nth - 1] ? { device: list[nth - 1] } : { error: `there's no ${TYPE_NAME[type] || type} #${nth}` };
    if (list.length === 1) return { device: list[0] };
    if (list.length > 1) return { error: `which ${TYPE_NAME[type].toLowerCase()} — ${list.map(d => d.model).join(" or ")}?`, candidates: list.map(d => d.model) };
  }
  const ct = compact(t);
  const exact = devs.filter(d => compact(d.model) === ct);
  if (exact.length === 1) return { device: exact[0] };
  const hits = devs.filter(d => compact(d.model).includes(ct) || compact(d.id).includes(ct) ||
    (ct.length >= 3 && compact(d.model).replace(/^(anthem|avproedge|savant|audiocontrol|sonance|sonos|ubiquiti)/, "").startsWith(ct)));
  if (hits.length === 1) return { device: hits[0] };
  if (hits.length > 1) {
    const whole = hits.filter(d => new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(norm(d.model)));
    if (whole.length === 1) return { device: whole[0] };
    return { error: `"${text}" could be ${hits.map(d => d.model).join(" or ")}`, candidates: hits.map(d => d.model) };
  }
  return { error: `no box called "${text}" in the rack` };
}

// any connection end: "<zone> tv", "<zone> speakers", a box, in-zone gear, an adapter
export function findNode(job, sol, text, hint = null) {
  const t = norm(text).replace(/^the /, "");
  const m = t.match(/^(.*?)'?s? (tv|television|display|projector|screen|speakers?|spk|audio)$/);
  if (m) {
    const z = findZone(job, m[1]);
    if (z.zone) {
      const want = /speak|spk|audio/.test(m[2]) ? "speakers" : "display";
      const ep = (z.zone.endpoints || []).find(e => e.type === want);
      return ep ? { id: ep.id } : { error: `${z.zone.name} has no ${want === "display" ? "TV" : "speakers"}` };
    }
  }
  for (const d of sol.localDevices || []) {
    const zn = job.house.zones.find(z => z.id === d.zone)?.name || "";
    if (norm(`${d.model} in ${zn}`) === t || norm(`${zn} ${d.model}`) === t) return { id: d.id };
  }
  const dv = findDevice(job, sol, text);
  if (dv.device) return { id: dv.device.id };
  // a bare zone: pick the end the other side implies (speakers for an amp, TV for video)
  const z = findZone(job, t);
  if (z.zone) {
    const eps = z.zone.endpoints || [];
    const want = hint === "speakers" ? "speakers" : hint === "display" ? "display" : eps.length === 1 ? eps[0].type : null;
    const ep = want && eps.find(e => e.type === want);
    if (ep) return { id: ep.id };
    return { error: `say "${z.zone.name} tv" or "${z.zone.name} speakers"` };
  }
  return { error: dv.error || `nothing called "${text}"` };
}

export function findProduct(catalog, text) {
  const ct = compact(text);
  if (!ct || !catalog?.devices) return null;
  const all = Object.entries(catalog.devices);
  // a product answers to its PlanQueue name, its SKU, and the names it had before (aliases: "Anthem MRX 1140 8K")
  const names = c => [productName(c), c.partNo, ...(c.aliases || []).flatMap(n => [n, `${c.brand || ""} ${n}`])].filter(Boolean).map(compact);
  const exact = all.filter(([id, c]) => names(c).includes(ct) || id === text);
  if (exact.length) return exact[0][0];
  const hits = all.filter(([, c]) => names(c).some(n => n.includes(ct)) || compact(c.model).includes(ct));
  if (!hits.length) return null;
  hits.sort((a, b) => productName(a[1]).length - productName(b[1]).length);   // "MDX-16" before "MDX-16 something"
  return hits[0][0];
}

/* ---------- running commands ---------- */
const SPK_IN = { none: "none", mono: "mono", stereo: "stereo", pair: "stereo", "2.1": "2.1", "5.1": "surround-5.1", "7.1": "surround-7.1", "7.1.4": "surround-7.1.4", atmos: "surround-7.1.4",
  "surround-5.1": "surround-5.1", "surround-7.1": "surround-7.1", "surround-7.1.4": "surround-7.1.4", soundbar: "soundbar", "soundbar-sub": "soundbar-sub", "bar + sub": "soundbar-sub", landscape: "landscape" };
const RUN_IN = { balun: "balun", hdbaset: "balun", decoder: "dec", dec: "dec", mxnet: "dec", direct: "direct", hdmi: "direct", "direct hdmi": "direct" };
const uid = p => p + "-" + Math.random().toString(36).slice(2, 7);
function freeId(job, sol, base) {
  const taken = new Set([...job.house.zones.flatMap(z => [z.id, ...(z.endpoints || []).map(e => e.id)]),
    ...rackDevices(sol).map(d => d.id), ...(sol.companions || []).map(c => c.id), ...(sol.localDevices || []).map(d => d.id)]);
  let id = base.replace(/[^A-Za-z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "") || "dev", n = 2;
  const b0 = id; while (taken.has(id)) id = `${b0}-${n++}`;
  return id;
}
const nm = (job, sol, id) => describeNode(job, sol, id).short;

// the signal two ends almost certainly carry (same rules as the editor's re-guess)
export function guessSignal(job, sol, from, to) {
  const f = describeNode(job, sol, from), t = describeNode(job, sol, to);
  if (t.kind === "speakers") return "speaker";
  if (f.kind === "display" || (f.kind === "local" && t.kind === "rack")) return "audioReturn";
  if (t.kind === "display" || t.kind === "adapter" || f.kind === "adapter") return "video";
  if (t.type === "avbSwitch" || f.type === "avbSwitch") return "network";
  if (t.type === "audioInputModule" || f.type === "audioOutputModule") return "audio";
  return "video";
}

function purgeZone(job, zone) {
  const eps = new Set((zone.endpoints || []).map(e => e.id));
  job.house.zones = job.house.zones.filter(z => z !== zone);
  for (const so of job.solutions) {
    const locals = new Set((so.localDevices || []).filter(d => d.zone === zone.id).map(d => d.id));
    const chips = new Set((so.companions || []).filter(c => eps.has(c.serves)).map(c => c.id));
    const gone = id => eps.has(id) || chips.has(id) || locals.has(id);
    so.connections = (so.connections || []).filter(c => !gone(c.from) && !gone(c.to));
    so.companions = (so.companions || []).filter(c => !chips.has(c.id));
    so.localDevices = (so.localDevices || []).filter(d => !locals.has(d.id));
    so.annotations = (so.annotations || []).filter(a => a.near !== zone.id);
    if (so.overrides?.zones) delete so.overrides.zones[zone.id];
    if (so.overrides?.endpoints) for (const e of eps) delete so.overrides.endpoints[e];
  }
}

const HANDLERS = {
  add_zones(job, sol, c) {
    const parses = parseQuick(c.text || "").filter(p => !p.empty);
    if (!parses.length) throw new Error(`couldn't read any zones from "${c.text}"`);
    const names = [];
    for (const p of parses) {
      const z = p.zone, hints = z._hints || {}; delete z._hints;
      const oldId = z.id;
      while (job.house.zones.some(x => x.id === z.id)) z.id += "b";
      if (z.id !== oldId) for (const ep of z.endpoints) ep.id = ep.id.replace(oldId, z.id);
      if (hints.local) (sol.localDevices ||= []).push({ id: freeId(job, sol, z.id + "-src"), type: "source", sourceType: "appletv",
        model: "Apple TV", status: "new", zone: z.id, location: "at-display" });
      job.house.zones.push(z);
      autoHookup(job, sol, z, hints);
      const h = readHookup(job, sol, z);
      const what = [(z.endpoints || []).find(e => e.type === "speakers") && SPEAKER_SETUP[(z.endpoints.find(e => e.type === "speakers").config) || "stereo"],
        h.tv && `${h.tv.size}" ${h.tv.displayType === "projector" ? "projector" : "TV"}`].filter(Boolean).join(" + ");
      const fed = [h.video && `TV ← ${nm(job, sol, h.video.from)}`, h.speakers && `speakers ← ${nm(job, sol, h.speakers.from)}`].filter(Boolean).join(", ");
      names.push(`${z.name}${what ? ` (${what})` : ""}${fed ? ` — ${fed}` : ""}`);
    }
    return `Add ${names.length > 1 ? "zones" : "zone"}: ${names.join("; ")}`;
  },

  set_zone(job, sol, c) {
    const f = findZone(job, c.zone); if (!f.zone) throw new Error(f.error);
    const z = f.zone, did = [];
    z.endpoints ||= [];
    const ep = t => z.endpoints.find(e => e.type === t);
    const was = z.name;
    if (c.name) { did.push(`rename to ${c.name}`); z.name = String(c.name); }
    if (c.speakers != null) {
      const cfg = SPK_IN[norm(c.speakers)]; if (!cfg) throw new Error(`unknown speaker setup "${c.speakers}"`);
      const spk = ep("speakers");
      if (cfg === "none") { if (spk) { purgeEndpoints(job, [spk.id]); z.endpoints = z.endpoints.filter(e => e !== spk); } }
      else if (spk) spk.config = cfg;
      else z.endpoints.unshift({ id: freeId(job, sol, z.id + "-spk"), type: "speakers", config: cfg, count: 2, status: "new" });
      did.push(`speakers → ${SPEAKER_SETUP[cfg] || cfg}`);
    }
    if (c.display != null) {
      const d = norm(c.display); if (!["none", "tv", "projector"].includes(d)) throw new Error(`display must be none, tv or projector`);
      const tv = ep("display");
      if (d === "none") { if (tv) { purgeEndpoints(job, [tv.id]); z.endpoints = z.endpoints.filter(e => e !== tv); } }
      else if (tv) tv.displayType = d;
      else z.endpoints.push({ id: freeId(job, sol, z.id + "-tv"), type: "display", displayType: d, brand: "", size: 65, status: "new" });
      did.push(`display → ${d === "none" ? "none" : d === "tv" ? "TV" : "projector"}`);
    }
    const tv = ep("display"), spk = ep("speakers");
    if (c.tv_size != null) { if (!tv) throw new Error(`${z.name} has no TV`); const n = Math.round(+String(c.tv_size).replace(/[^\d.]/g, ""));
      if (!(n >= 24 && n <= 220)) throw new Error(`TV size ${c.tv_size} is out of range`); tv.size = n; delete tv.confirm; did.push(`TV → ${n}"`); }
    if (c.brand != null) { if (!tv) throw new Error(`${z.name} has no TV`); tv.brand = String(c.brand); did.push(`brand → ${c.brand}`); }
    if (c.scope != null) { const s = norm(c.scope).replace("pre-wire", "prewire"); if (!SCOPE_NAME[s]) throw new Error(`scope must be included, prewire or future`);
      z.scope = s; for (const cn of sol.connections || []) if ((z.endpoints || []).some(e => e.id === cn.to)) { if (s === "included") delete cn.scope; else cn.scope = s; }
      did.push(`scope → ${SCOPE_NAME[s]}`); }
    for (const [k, e, label] of [["speakers_status", spk, "speakers"], ["tv_status", tv, "TV"]]) if (c[k] != null) {
      const s = norm(c[k]); if (!["new", "ofe"].includes(s)) throw new Error(`${k} must be new or ofe`);
      if (!e) throw new Error(`${z.name} has no ${label}`); e.status = s; did.push(`${label} → ${STATUS_NAME[s]}`); }
    if (c.remote != null) { const r = norm(c.remote); if (!REMOTE_NAME[r]) throw new Error(`unknown remote "${c.remote}"`);
      if (r === "none") delete z.remote; else z.remote = r; did.push(`remote → ${REMOTE_NAME[r]}`); }
    if (c.confirm_size != null) { if (!tv) throw new Error(`${z.name} has no TV`); if (c.confirm_size) tv.confirm = ["size"]; else delete tv.confirm;
      did.push(c.confirm_size ? "flag TV size to confirm" : "TV size confirmed"); }
    if (!did.length) throw new Error("nothing to change");
    return `${was}: ${did.join(", ")}`;
  },

  delete_zone(job, sol, c) {
    const f = findZone(job, c.zone); if (!f.zone) throw new Error(f.error);
    purgeZone(job, f.zone);
    return `Delete zone ${f.zone.name} (and everything wired to it)`;
  },

  hookup(job, sol, c) {
    const f = findZone(job, c.zone); if (!f.zone) throw new Error(f.error);
    const z = f.zone, did = [];
    const dev = v => { if (v == null) return undefined; if (/^(none|nothing|off)$/.test(norm(v))) return null;
      const r = findDevice(job, sol, v); if (!r.device) throw new Error(r.error); return r.device.id; };
    const tvFrom = dev(c.tv_from), spkFrom = dev(c.speakers_from);
    let h = readHookup(job, sol, z);
    if (tvFrom !== undefined || c.run != null) {
      if (!h.tv) throw new Error(`${z.name} has no TV`);
      const run = c.run != null ? RUN_IN[norm(c.run)] : undefined;
      if (c.run != null && !run) throw new Error(`run must be balun, decoder or direct`);
      const from = tvFrom !== undefined ? tvFrom : h.video?.from;
      if (!from && tvFrom !== null) throw new Error(`${z.name}'s TV isn't fed yet — say where it comes from`);
      setVideo(job, sol, z, from, run);
      h = readHookup(job, sol, z);
      did.push(from ? `TV ← ${nm(job, sol, from)} (${RUNS[h.video.run]})` : "disconnect the TV");
    }
    if (spkFrom !== undefined || c.outputs != null) {
      if (!h.spk) throw new Error(`${z.name} has no speakers`);
      const from = spkFrom !== undefined ? spkFrom : h.speakers?.from;
      if (!from && spkFrom !== null) throw new Error(`${z.name}'s speakers aren't fed yet — say where from`);
      setSpeakers(job, sol, z, from, c.outputs != null ? String(c.outputs) : undefined);
      h = readHookup(job, sol, z);
      did.push(from ? `speakers ← ${nm(job, sol, from)}${h.speakers.channels ? ` outputs ${h.speakers.channels}` : ""}` : "disconnect the speakers");
    }
    if (c.audio_back != null) {
      if (!h.tv) throw new Error(`${z.name} has no TV`);
      const mode = norm(c.audio_back).replace(/\s*\+\s*/, "+").replace("earc + optical", "earc+optical");
      if (!["earc", "earc+optical", "earc-kit", "optical", "none"].includes(mode)) throw new Error(`audio_back must be earc, earc+optical, earc-kit, optical or none`);
      const to = c.audio_back_to != null ? dev(c.audio_back_to) : undefined;
      if ((mode === "earc" || mode === "earc+optical" || (mode === "earc-kit" && !to)) && !rackDevices(sol).some(d => d.id === h.video?.from && d.type === "avr"))
        throw new Error(`eARC needs the TV fed from a receiver — ${z.name}'s isn't`);
      if (mode === "optical" && !to && !h.ret) throw new Error(`say where the optical goes (audio_back_to)`);
      setAudioBack(job, sol, z, mode, to || undefined);
      did.push(`TV audio back → ${AUDIO_BACK_NAME[mode]}${to ? ` to ${nm(job, sol, to)}` : ""}`);
    }
    if (!did.length) throw new Error("nothing to hook up — give tv_from, speakers_from, run, outputs or audio_back");
    return `${z.name}: ${did.join(", ")}`;
  },

  connect(job, sol, c) {
    const fr = findNode(job, sol, c.from); if (!fr.id) throw new Error(`from: ${fr.error}`);
    const fromDev = rackDevices(sol).find(d => d.id === fr.id);
    const hint = fromDev?.type === "amp" || c.signal === "speaker" ? "speakers" : "display";
    const to = findNode(job, sol, c.to, hint); if (!to.id) throw new Error(`to: ${to.error}`);
    if (fr.id === to.id) throw new Error("can't connect something to itself");
    if (describeNode(job, sol, to.id).type === "source") throw new Error(`${nm(job, sol, to.id)} is a source — it doesn't take an input`);
    const signal = c.signal ? String(c.signal) : guessSignal(job, sol, fr.id, to.id);
    if (!SIGNAL_NAME[signal]) throw new Error(`unknown signal "${c.signal}"`);
    if ((sol.connections || []).some(x => x.from === fr.id && x.to === to.id && x.signal === signal))
      return `${nm(job, sol, fr.id)} → ${nm(job, sol, to.id)} is already connected (no change)`;
    const conn = { from: fr.id, to: to.id, signal };
    let outputs = c.outputs != null ? String(c.outputs) : "";
    if (!outputs && fromDev?.type === "amp" && signal === "speaker") {
      const ep = job.house.zones.flatMap(z => z.endpoints || []).find(e => e.id === to.id);
      outputs = nextFreeOutputs(sol, fr.id, outputsNeeded(ep) || 2);
    }
    if (outputs) conn.channels = outputs;
    if (c.scope && c.scope !== "included") conn.scope = c.scope;
    (sol.connections ||= []).push(conn);
    return `Connect ${nm(job, sol, fr.id)} → ${nm(job, sol, to.id)} · ${SIGNAL_NAME[signal]}${outputs ? ` · outputs ${outputs}` : ""}`;
  },

  disconnect(job, sol, c) {
    const to = findNode(job, sol, c.to); if (!to.id) throw new Error(`to: ${to.error}`);
    let fromId = null;
    if (c.from) { const fr = findNode(job, sol, c.from); if (!fr.id) throw new Error(`from: ${fr.error}`); fromId = fr.id; }
    const hit = x => x.to === to.id && (!fromId || x.from === fromId) && (!c.signal || x.signal === c.signal);
    // a feed through an adapter (balun/decoder) goes with its adapter
    const viaAdapters = (sol.companions || []).filter(a => a.serves === to.id).map(a => a.id);
    const n0 = (sol.connections || []).length;
    const adapterFed = fromId && viaAdapters.some(a => (sol.connections || []).some(x => x.from === fromId && x.to === a));
    sol.connections = (sol.connections || []).filter(x => !hit(x) && !(adapterFed && (viaAdapters.includes(x.to) || viaAdapters.includes(x.from))));
    if (adapterFed) sol.companions = (sol.companions || []).filter(a => !viaAdapters.includes(a.id));
    const n = n0 - sol.connections.length;
    if (!n) throw new Error(`nothing connects ${fromId ? nm(job, sol, fromId) + " to " : "into "}${nm(job, sol, to.id)}`);
    return `Disconnect ${fromId ? nm(job, sol, fromId) + " → " : "everything into "}${nm(job, sol, to.id)} (${n} connection${n > 1 ? "s" : ""})`;
  },

  add_device(job, sol, c, catalog) {
    const ref = findProduct(catalog, c.product);
    const cat = ref ? catalog.devices[ref] : null;
    const type = cat?.type || (c.type && TYPE_NAME[c.type] ? c.type : typeOfWords(norm(c.product)) || "source");
    if (!cat && !c.type && !typeOfWords(norm(c.product)) && !/tv|cable|roku|music|turn ?table|streamer|player|sonos|apple/i.test(c.product))
      throw new Error(`"${c.product}" isn't in the catalog — give a type (receiver, amp, matrix, source…)`);
    const model = c.name || (cat ? productName(cat) : String(c.product));
    const id = addRackDevice(job, sol, type, model);
    const d = rackDevices(sol).find(x => x.id === id);
    if (ref) d.catalogRef = ref;
    if (type === "amp" && cat?.zones) d.zones = cat.zones;
    return `Add ${model} to the rack${cat ? "" : " (not in the catalog)"} · ${TYPE_NAME[type] || type}`;
  },

  set_device(job, sol, c, catalog) {
    const f = findDevice(job, sol, c.device); if (!f.device) throw new Error(f.error);
    const d = f.device, did = [], was = d.model;
    if (c.product) { const ref = findProduct(catalog, c.product); if (!ref) throw new Error(`no catalog product like "${c.product}"`);
      const cat = catalog.devices[ref]; d.catalogRef = ref; d.model = productName(cat); if (cat.type) d.type = cat.type; if (cat.zones && cat.type === "amp") d.zones = cat.zones;
      did.push(`product → ${d.model}`); }
    if (c.name) { d.model = String(c.name); did.push(`rename to ${d.model}`); }
    if (c.status) { const s = norm(c.status); if (!["new", "ofe"].includes(s)) throw new Error("status must be new or ofe"); d.status = s; did.push(STATUS_NAME[s]); }
    if (c.zones != null) { d.zones = Math.max(1, Math.min(32, Math.round(+c.zones))); did.push(`${d.zones} zones`); }
    if (!did.length) throw new Error("nothing to change");
    return `${was}: ${did.join(", ")}`;
  },

  delete_device(job, sol, c) {
    const f = findDevice(job, sol, c.device); if (!f.device) throw new Error(f.error);
    const d = f.device;
    for (const r of sol.racks) r.devices = r.devices.filter(x => x !== d);
    const gone = new Set([d.id, ...(sol.companions || []).filter(a => a.serves === d.id).map(a => a.id)]);
    const n = (sol.connections || []).filter(x => gone.has(x.from) || gone.has(x.to)).length;
    sol.connections = (sol.connections || []).filter(x => !gone.has(x.from) && !gone.has(x.to));
    sol.companions = (sol.companions || []).filter(a => !gone.has(a.id));
    for (const x of sol.connections) if (x.routeHint?.between?.includes?.(d.id)) delete x.routeHint;
    return `Delete ${d.model}${n ? ` and its ${n} connection${n > 1 ? "s" : ""}` : ""}`;
  },

  set_job(job, sol, c) {
    const did = [];
    if (c.name) { job.job.name = String(c.name); did.push(`name → ${c.name}`); }
    if (c.client) { (job.job.client ||= {}).name = String(c.client); did.push(`client → ${c.client}`); }
    if (c.address) { (job.job.client ||= {}).address = String(c.address); did.push(`address → ${c.address}`); }
    if (c.drawn_by) { job.job.drawnBy = String(c.drawn_by); did.push(`drawn by → ${c.drawn_by}`); }
    if (!did.length) throw new Error("nothing to change");
    return `Job: ${did.join(", ")}`;
  },

  add_revision(job, sol, c) {
    if (!c.description) throw new Error("a revision needs a description");
    const revs = (job.job.revisions ||= []);
    revs.push({ rev: revs.length + 1, date: new Date().toISOString().slice(0, 10), description: String(c.description).slice(0, 120),
                by: String(job.job.drawnBy || "SP").slice(0, 2).toUpperCase() });
    return `Revision ${revs.length}: ${c.description}`;
  },
};

function purgeEndpoints(job, ids) {
  const eps = new Set(ids);
  for (const so of job.solutions) {
    const chips = new Set((so.companions || []).filter(c => eps.has(c.serves)).map(c => c.id));
    so.connections = (so.connections || []).filter(c => !eps.has(c.from) && !eps.has(c.to) && !chips.has(c.from) && !chips.has(c.to));
    so.companions = (so.companions || []).filter(c => !chips.has(c.id));
  }
}

/* Run commands on a COPY: { job, steps: [{ ok, text, error, cmd }] }.
   A failed step changes nothing and the rest still run; the caller applies
   the returned job (preview first) or throws it away. */
export function planCommands(job, solIndex, commands, catalog) {
  const next = structuredClone(job);
  const solOf = () => next.solutions[solIndex] || next.solutions[0];   // re-read: a rollback replaces the arrays
  const steps = [];
  for (const raw of Array.isArray(commands) ? commands : []) {
    const cmd = raw && typeof raw === "object" ? raw : { op: String(raw) };
    const fn = HANDLERS[cmd.op];
    if (!fn) { steps.push({ ok: false, cmd, error: `unknown command "${cmd.op}"` }); continue; }
    const snap = structuredClone(next);               // a failing step must not leave half its change behind
    try { steps.push({ ok: true, cmd, text: fn(next, solOf(), cmd, catalog) }); }
    catch (e) {
      Object.keys(next).forEach(k => delete next[k]); Object.assign(next, snap);
      steps.push({ ok: false, cmd, error: e.message });
    }
  }
  return { job: next, steps };
}

/* ---------- typed phrases → commands (quick-add box, dictation) ----------
   Returns null when the text isn't a command, so the box falls back to
   adding zones. Several commands: separate with ";" or a new line. */
export function parseCommandText(text, job, sol) {
  const parts = String(text || "").split(/\s*(?:;|\n|\bthen\b)\s*/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const cmds = [];
  for (const p of parts) { const c = parseOne(p, job, sol); if (!c) return null; cmds.push(...c); }
  return cmds;
}

// the zone(s) a phrase starts with: "kitchen, office and dining ..." → names + the rest
function leadingZones(job, t) {
  const names = job.house.zones.map(z => ({ z, n: norm(z.name) })).sort((a, b) => b.n.length - a.n.length);
  const found = []; let rest = t;
  for (;;) {
    rest = rest.replace(/^(,|and|&)\s*/, "").trim();
    const hit = names.find(({ n }) => rest === n || rest.startsWith(n + " ") || rest.startsWith(n + ",")) ||
                names.find(({ n }) => { const w = n.split(" ")[0]; return w.length >= 3 && (rest.startsWith(w + " ") || rest.startsWith(w + ",")) &&
                  names.filter(x => x.n.split(" ")[0] === w).length === 1; });
    if (!hit) break;
    const len = rest.startsWith(hit.n) ? hit.n.length : hit.n.split(" ")[0].length;
    found.push(hit.z.name); rest = rest.slice(len).trim();
    if (!/^(,|and\b|&)/.test(rest)) break;
  }
  return found.length ? { zones: found, rest } : null;
}

function parseOne(p, job, sol) {
  const t = norm(p).replace(/[.!]+$/, "");
  let m;
  if ((m = t.match(/^(?:connect|plug|patch|run|wire)\s+(.+?)\s+(?:to|into|→|->)\s+(.+)$/))) return [{ op: "connect", from: m[1], to: m[2] }];
  if ((m = t.match(/^disconnect\s+(.+?)\s+from\s+(.+)$/))) return [{ op: "disconnect", from: m[1], to: m[2] }];
  if ((m = t.match(/^disconnect\s+(.+)$/))) return [{ op: "disconnect", to: m[1] }];
  if ((m = t.match(/^rename\s+(.+?)\s+to\s+(.+)$/))) {
    const z = findZone(job, m[1]); if (z.zone) return [{ op: "set_zone", zone: z.zone.name, name: p.match(/\bto\s+(.+)$/i)[1].trim() }];
    const d = findDevice(job, sol, m[1]); if (d.device) return [{ op: "set_device", device: d.device.model, name: p.match(/\bto\s+(.+)$/i)[1].trim() }];
    return null;
  }
  if ((m = t.match(/^(?:delete|remove)\s+(?:the\s+)?(zone\s+)?(.+)$/))) {
    const z = findZone(job, m[2]); if (z.zone && (m[1] || !findDevice(job, sol, m[2]).device)) return [{ op: "delete_zone", zone: z.zone.name }];
    const d = findDevice(job, sol, m[2]); if (d.device) return [{ op: "delete_device", device: d.device.model }];
    return null;
  }
  if ((m = t.match(/^add\s+(?:another\s+|a second\s+|one more\s+|an?\s+)?(.+)$/))) {
    const rest = m[1];
    if (typeOfWords(rest) || /^(mrx|mdx|ac-|avpro|savant|sonance|sonos|anthem|audiocontrol|ubiquiti|apple tv$|cable box$|roku)/.test(rest))
      return [{ op: "add_device", product: p.replace(/^add\s+(?:another\s+|a second\s+|one more\s+|an?\s+)?/i, "") }];
    return [{ op: "add_zones", text: p.replace(/^add\s+/i, "") }];
  }
  const lz = leadingZones(job, t);
  if (!lz) {
    // "<box> into/to <thing>" without a verb: both ends must resolve, or it's not a command
    if ((m = t.match(/^(.+?)\s+(?:into|to|→|->)\s+(.+)$/)) && findNode(job, sol, m[1]).id && findNode(job, sol, m[2], "speakers").id !== undefined)
      return [{ op: "connect", from: m[1], to: m[2] }];
    return null;
  }
  const { zones, rest } = lz;
  const each = fn => zones.map(fn);
  // "<zones> [tv|speakers] from/off/on/to <box>"
  if ((m = rest.match(/^(?:(tv|speakers?|audio)\s+)?(?:from|off|on|to)\s+(?:the\s+)?(.+)$/))) {
    const d = findDevice(job, sol, m[2]);
    if (!d.device) return null;
    const which = m[1] ? (/tv/.test(m[1]) ? "tv" : "speakers") : d.device.type === "amp" ? "speakers" : ["videoMatrix", "avSwitch", "splitter", "source"].includes(d.device.type) ? "tv" : "both";
    return each(z => {
      const c = { op: "hookup", zone: z };
      const ep = t2 => (job.house.zones.find(x => x.name === z)?.endpoints || []).some(e => e.type === t2);
      if ((which === "tv" || which === "both") && ep("display")) c.tv_from = d.device.model;
      if ((which === "speakers" || which === "both") && ep("speakers")) c.speakers_from = d.device.model;
      return c;
    });
  }
  // "<zone> [tv] direct hdmi | balun | decoder"
  if ((m = rest.match(/^(?:tv\s+)?(?:run\s+)?(direct hdmi|direct|hdmi|balun|hdbaset|decoder|mxnet)$/))) return each(z => ({ op: "hookup", zone: z, run: m[1] }));
  // "<zone> optical backup | earc | earc kit | optical [to X] | no audio back"
  if (/^(?:with\s+)?(?:an?\s+)?optical backup$|^earc \+ optical$|^add optical backup$/.test(rest)) return each(z => ({ op: "hookup", zone: z, audio_back: "earc+optical" }));
  if (/^(?:with\s+|add\s+)?(?:an?\s+)?earc (?:extender|kit|extender kit)$/.test(rest)) return each(z => ({ op: "hookup", zone: z, audio_back: "earc-kit" }));
  if (/^(?:audio back )?(?:over )?earc$/.test(rest)) return each(z => ({ op: "hookup", zone: z, audio_back: "earc" }));
  if ((m = rest.match(/^optical(?: only)?(?: (?:back )?to (.+))?$/))) return each(z => ({ op: "hookup", zone: z, audio_back: "optical", ...(m[1] ? { audio_back_to: m[1] } : {}) }));
  if (/^no audio back$|^no optical$/.test(rest)) return each(z => ({ op: "hookup", zone: z, audio_back: "none" }));
  if ((m = rest.match(/^outputs? (\d+(?:\s*-\s*\d+)?)$/))) return each(z => ({ op: "hookup", zone: z, outputs: m[1].replace(/\s/g, "") }));
  // modifiers: "patio 75 ofe", "gym prewire", "den 5.1 projector", "confirm size"
  const c = {}; let ok = true, feed = null;
  const BRAND = { sony: "Sony", samsung: "Samsung", lg: "LG", tcl: "TCL", vizio: "Vizio", hisense: "Hisense", panasonic: "Panasonic", sharp: "Sharp", seura: "Seura", sunbrite: "SunBrite" };
  for (const w of rest.split(/\s+/).filter(Boolean)) {
    if (BRAND[w]) { c.brand = BRAND[w]; continue; }
    if (w === "matrix" || w === "distributed") { feed = "matrix"; continue; }
    if (w === "avr" || w === "receiver") { feed = "avr"; continue; }
    if (/^\d{2,3}("|in|inch|inches)?$/.test(w)) c.tv_size = +w.replace(/\D/g, "");
    else if (/^(inch|inches|tv)$/.test(w)) continue;
    else if (w === "ofe" || w === "existing") c.tv_status = c.speakers_status = "ofe";
    else if (w === "new") c.tv_status = c.speakers_status = "new";
    else if (/^(prewire|pre-wire|future|included)$/.test(w)) c.scope = w.replace("pre-wire", "prewire");
    else if (SPK_IN[w] && w !== "none") c.speakers = w;
    else if (w === "projector") c.display = "projector";
    else if (w === "confirm" || w === "size" || w === "check") c.confirm_size = true;
    else { ok = false; break; }
  }
  if (!ok || (!Object.keys(c).length && !feed)) return null;
  const devs = rackDevices(sol);
  const matrix = devs.find(d => d.type === "videoMatrix") || devs.find(d => d.type === "avSwitch");
  const avr = devs.find(d => d.type === "avr");
  return zones.flatMap(z => {
    const zz = job.house.zones.find(x => x.name === z), has = t2 => (zz?.endpoints || []).some(e => e.type === t2);
    const out = [];
    if (Object.keys(c).length) {
      const sz = { op: "set_zone", zone: z, ...c };
      if (sz.tv_status && !has("display")) delete sz.tv_status;
      if (sz.speakers_status && !has("speakers")) delete sz.speakers_status;
      out.push(sz);
    }
    // an existing zone + "matrix" / "avr": re-feed it (a new zone would be a duplicate)
    if (feed === "matrix" && matrix) out.push({ op: "hookup", zone: z, tv_from: matrix.model });
    if (feed === "avr" && avr) out.push({ op: "hookup", zone: z, tv_from: avr.model, speakers_from: avr.model });
    if (feed && !out.some(x => x.op === "hookup")) out.push({ op: "hookup", zone: z, tv_from: feed === "matrix" ? "matrix" : "receiver" });   // errors plainly: no such box
    return out;
  });
}

/* the vocabulary as text, for an AI's instructions */
export function vocabularyText() {
  return Object.entries(OPS).map(([op, o]) => `- ${op}(${o.args}) — ${o.about}\n  e.g. ${o.eg}`).join("\n");
}
