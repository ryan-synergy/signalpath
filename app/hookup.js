/* ---------- hookup.js — "what feeds this zone" ----------
   A zone-centric view over a solution's connections: where the TV's video
   comes from (and how it gets there), where the speakers are driven from,
   and where the TV's audio goes back to. The editor's HOOKUP section and
   quick-add ("family room 5.1 75 avr") both go through here, so a receiver
   feeding a TV + a surround set is one choice, not four hand-made rows.
   Pure functions over the raw job — no DOM. Everything writes plain
   connections/companions; the engine needs nothing new. */

import { SPEAKER_SETUP } from "./names.js";

// what can do each job
export const VIDEO_FROM = ["avr", "videoMatrix", "avSwitch", "splitter", "source"];
export const SPEAKERS_FROM = ["avr", "amp"];
export const RETURN_TO = ["avr", "audioInputModule"];
// how a rack video feed reaches the TV
export const RUNS = { balun: "HDBaseT balun", dec: "MXNet decoder", direct: "Direct HDMI" };

const rackDevices = sol => (sol.racks || []).flatMap(r => r.devices || []);
const endpointsOf = z => ({ tv: (z.endpoints || []).find(e => e.type === "display"), spk: (z.endpoints || []).find(e => e.type === "speakers") });
const scopeOf = z => (z.scope && z.scope !== "included" ? { scope: z.scope } : {});
function freeId(job, sol, base) {
  const taken = new Set([...job.house.zones.flatMap(z => [z.id, ...(z.endpoints || []).map(e => e.id)]),
    ...rackDevices(sol).map(d => d.id), ...(sol.companions || []).map(c => c.id), ...(sol.localDevices || []).map(d => d.id)]);
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

/* current hookup, read back from the connections */
export function readHookup(job, sol, zone) {
  const { tv, spk } = endpointsOf(zone);
  const conns = sol.connections || [];
  const out = { tv, spk, video: null, speakers: null, ret: null };
  if (tv) {
    const inTv = conns.find(c => c.to === tv.id && c.signal === "video");
    if (inTv) {
      const comp = (sol.companions || []).find(c => c.id === inTv.from);
      if (comp) out.video = { from: conns.find(c => c.to === comp.id && c.signal === "video")?.from || null, run: comp.type, via: comp.id };
      else out.video = { from: inTv.from, run: "direct" };
    }
    const r = conns.find(c => c.from === tv.id && c.signal === "audioReturn");
    if (r) out.ret = { to: r.to };
  }
  if (spk) {
    const c = conns.find(c => c.to === spk.id && c.signal === "speaker");
    if (c) out.speakers = { from: c.from, channels: c.channels || "" };
  }
  return out;
}

/* the TV's video: from a rack device (with a run type) or in-zone gear (direct) */
export function setVideo(job, sol, zone, from, run) {
  const { tv } = endpointsOf(zone); if (!tv) return;
  sol.connections ||= []; sol.companions ||= [];
  const isLocal = (sol.localDevices || []).some(d => d.id === from);
  if (isLocal || !from) run = "direct";
  run ||= rackDevices(sol).find(d => d.id === from)?.type === "avSwitch" ? "dec" : "balun";
  // adapters in front of this TV that the new choice doesn't reuse go away
  // with every wire into or out of them
  const mine = sol.companions.filter(c => c.serves === tv.id);
  const keep = run !== "direct" ? mine.find(c => c.type === run) : null;
  const drop = new Set(mine.filter(c => c !== keep).map(c => c.id));
  sol.companions = sol.companions.filter(c => !drop.has(c.id));
  sol.connections = sol.connections.filter(c => !drop.has(c.from) && !drop.has(c.to) &&
    !(c.to === tv.id && c.signal === "video") && !(keep && c.to === keep.id && c.signal === "video"));
  if (!from) return;
  const sc = scopeOf(zone);
  if (run === "direct") { sol.connections.push({ from, to: tv.id, signal: "video", ...sc }); return; }
  const comp = keep || { id: freeId(job, sol, `${run}-${zone.id}`), type: run, serves: tv.id, auto: true };
  if (!keep) sol.companions.push(comp);
  sol.connections.push({ from, to: comp.id, signal: "video", ...sc }, { from: comp.id, to: tv.id, signal: "video", ...sc });
}

// amp outputs a speaker set needs, and the next free block on that amp
export function outputsNeeded(spk) {
  const c = spk?.config || "stereo";
  if (c === "mono") return 1;
  if (c === "landscape") return 2;          // the array rides one stereo pair per amp zone
  if (/^surround|^soundbar/.test(c)) return 0;   // surround/soundbar hang off a receiver, not amp zones
  return 2;
}
export function nextFreeOutputs(sol, ampId, n, exceptTo = null) {
  if (!n) return "";
  const used = new Set();
  for (const c of sol.connections || []) if (c.from === ampId && c.signal === "speaker" && c.to !== exceptTo)
    for (const part of String(c.channels || "").split(",")) {
      const m = part.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/); if (!m) continue;
      for (let i = +m[1]; i <= +(m[2] ?? m[1]); i++) used.add(i);
    }
  let start = 1;
  while ([...Array(n).keys()].some(k => used.has(start + k))) start += n;
  return n === 1 ? String(start) : `${start}-${start + n - 1}`;
}

/* the speakers: from a receiver or an amp; amps get their next free outputs */
export function setSpeakers(job, sol, zone, from, channels) {
  const { spk } = endpointsOf(zone); if (!spk) return;
  sol.connections ||= [];
  const prev = sol.connections.find(c => c.to === spk.id && c.signal === "speaker");
  sol.connections = sol.connections.filter(c => !(c.to === spk.id && c.signal === "speaker"));
  if (!from) return;
  const dev = rackDevices(sol).find(d => d.id === from);
  if (channels === undefined)
    channels = prev && prev.from === from ? prev.channels : dev?.type === "amp" ? nextFreeOutputs(sol, from, outputsNeeded(spk) || 2, spk.id) : "";
  sol.connections.push({ from, to: spk.id, signal: "speaker", ...(channels ? { channels } : {}), ...scopeOf(zone) });
}

/* the TV's audio back to the rack (eARC / optical into a receiver or input module) */
export function setReturn(job, sol, zone, to) {
  const { tv } = endpointsOf(zone); if (!tv) return;
  sol.connections = (sol.connections || []).filter(c => !(c.from === tv.id && c.signal === "audioReturn"));
  if (to) sol.connections.push({ from: tv.id, to, signal: "audioReturn", ...scopeOf(zone) });
}

/* a new box in the first rack, named plainly; returns its id */
export function addRackDevice(job, sol, type, model) {
  const rack = (sol.racks ||= [])[0] || (sol.racks[0] = { id: "rack-main", name: "Equipment Rack", devices: [] });
  const id = freeId(job, sol, type === "avr" ? "avr" : type === "amp" ? "amp" : type);
  rack.devices.push({ id, type, model, status: "new", ...(type === "amp" ? { zones: 8 } : {}) });
  return id;
}

/* quick-add: wire a new zone from its shorthand hints */
export function autoHookup(job, sol, zone, hints = {}) {
  const { tv, spk } = endpointsOf(zone);
  const devs = rackDevices(sol);
  if (hints.avr) {
    // one receiver per surround/theater zone is the norm — reuse one only if
    // it isn't already driving another zone's speakers
    const busy = new Set((sol.connections || []).filter(c => c.signal === "speaker").map(c => c.from));
    let avr = devs.find(d => d.type === "avr" && !busy.has(d.id))?.id;
    if (!avr) avr = addRackDevice(job, sol, "avr", `AV receiver — ${zone.name}`);
    if (tv) setVideo(job, sol, zone, avr, "balun");
    if (spk) setSpeakers(job, sol, zone, avr);
    if (tv) setReturn(job, sol, zone, null);   // HDMI to the TV carries eARC back — no separate run
    return;
  }
  if (hints.matrix && tv) {
    const m = devs.find(d => d.type === "videoMatrix") || devs.find(d => d.type === "avSwitch");
    if (m) setVideo(job, sol, zone, m.id);
  }
}

export const speakerSetupName = spk => SPEAKER_SETUP[spk?.config || "stereo"] || spk?.config;
