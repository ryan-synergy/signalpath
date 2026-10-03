/* ---------- hookup.js — "what feeds this zone" ----------
   A zone-centric view over a solution's connections: where the TV's video
   comes from (and how it gets there), where the speakers are driven from,
   and where the TV's audio goes back to. The editor's HOOKUP section and
   quick-add ("family room 5.1 75 avr") both go through here, so a receiver
   feeding a TV + a surround set is one choice, not four hand-made rows.
   Pure functions over the raw job — no DOM. Everything writes plain
   connections/companions; the engine needs nothing new. */

import { SPEAKER_SETUP, AUDIO_BACK_NAME, productName } from "./names.js";
import { portsOf } from "./network.js";

// what can do each job
export const VIDEO_FROM = ["avr", "videoMatrix", "avSwitch", "splitter", "source"];
export const SPEAKERS_FROM = ["avr", "amp"];
export const RETURN_TO = ["avr", "audioInputModule"];
// how a rack video feed reaches the TV
export const RUNS = { balun: "HDBaseT balun", bullet: "Bullet Train", dec: "MXNet decoder", direct: "Direct HDMI" };

/* how far the TV is from the rack — rough by design (Ryan 2026-09-30: exact footage
   lives elsewhere). zone.reach = short | average | far; zone.runFt, when someone
   knows it, wins. Used to size a Bullet Train (AVPro AOC fiber HDMI, source head at
   the rack, display head at the TV): the 48G model comes 5–40 m and carries eARC
   only up to 10 m — longer ones fall back to ARC (avproglobal.com, 2026-09-30). */
export const REACH = { short: "Short", average: "Average", far: "Far" };
const REACH_M = { short: 10, average: 20, far: 40 };
export const BULLET_M = [5, 10, 15, 20, 30, 40];
export const BULLET_EARC_M = 10;
// the run length when someone said it (Short / Average / Far, or feet) — null when
// nobody has, so the length checks never nag a room that was never measured
export function knownRunM(zone) {
  const ft = +zone?.runFt;
  if (ft > 0) return ft * 0.3048;
  return REACH_M[zone?.reach] ?? null;
}
// how far each kind of run goes (AVPro specs, 2026-09-29/30; HDMI copper and Toslink: common practice)
export const RUN_LIMIT_M = { direct: 10, balun: 70, bullet: 40, dec: 100, earcKit: 100, optical: 10 };
export function bulletFor(zone) {
  const ft = +zone?.runFt;
  const need = ft > 0 ? ft * 0.3048 : REACH_M[zone?.reach] ?? REACH_M.average;
  const m = BULLET_M.find(x => x >= need - 0.01) ?? null;       // null: past 40 m — no Bullet Train that long
  return { m, need: Math.round(need), ref: m ? `avpro-ac-btssf-10kuhd-${String(m).padStart(2, "0")}` : null, earc: m != null && m <= BULLET_EARC_M };
}

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
      const src = comp ? conns.find(c => c.to === comp.id && c.signal === "video") : inTv;   // the edge leaving the source
      out.video = comp ? { from: src?.from || null, run: comp.type, via: comp.id } : { from: inTv.from, run: inTv.run === "bullet" ? "bullet" : "direct" };
      out.earc = !!src?.earc;
    }
    // the TV's eARC into its own AXIS (Dante) is at the TV, not an audio return to the rack
    const atTv = new Set((sol.companions || []).filter(c => c.serves === tv.id).map(c => c.id));
    const r = conns.find(c => c.from === tv.id && c.signal === "audioReturn" && !atTv.has(c.to) && c.to !== spk?.id);
    if (r) out.ret = { to: r.to, backup: !!r.backup, ...(r.earcKit ? { kit: true } : {}) };
    // one word for the TV-audio choice: earc | earc+optical | earc-kit | optical | none
    out.audioBack = r?.earcKit ? "earc-kit" : out.earc ? (r ? "earc+optical" : "earc") : r ? "optical" : "none";
  }
  if (spk) {
    const c = conns.find(c => c.to === spk.id && c.signal === "speaker");
    if (c) out.speakers = { from: c.from, channels: c.channels || "" };
    // a powered soundbar plays what its TV sends it over HDMI eARC
    else if (tv && conns.some(c => c.from === tv.id && c.to === spk.id && c.signal === "audioReturn")) out.speakers = { from: tv.id, viaTv: true, channels: "" };
  }
  if (tv) {   // TV sound on Dante: which adapter carries it, which amp listens
    const via = (sol.companions || []).find(c => c.serves === tv.id && (c.type === "axis" || c.type === "axis16" || (c.type === "dec" && c.dante)));
    if (via) out.dante = { via: via.id, type: via.type === "dec" ? "ddec" : via.type, to: conns.filter(c => c.from === via.id && c.dante).map(c => c.to) };
  }
  return out;
}

/* the TV's video: from a rack device (with a run type) or in-zone gear (direct).
   eARC rides the HDMI from a receiver: it's a flag on the edge leaving the
   receiver (no wire of its own). It's on by default when a receiver feeds the
   TV, carried over when only the run changes, and dropped for non-receivers. */
const isReceiver = (sol, id) => rackDevices(sol).some(d => d.id === id && d.type === "avr");
export function setVideo(job, sol, zone, from, run, earc) {
  const { tv } = endpointsOf(zone); if (!tv) return;
  sol.connections ||= []; sol.companions ||= [];
  if (from) delete tv.ownApps;                             // a real feed replaces "its own apps"
  const prev = readHookup(job, sol, zone);
  if (earc === undefined) earc = prev.video?.from === from ? prev.earc : !prev.ret;   // an existing optical-only choice stays optical-only
  if (!isReceiver(sol, from)) earc = false;
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
  // the AVPro balun carries no ARC/eARC, so a receiver newly feeding a TV through
  // one gets "eARC + optical backup" by default (Ryan 2026-09-29) — the optical
  // run is what actually brings the TV's own apps back. An Atmos room (7.1.4…)
  // gets the eARC extender kit instead (Ryan 2026-09-30): optical stops at Dolby
  // Digital 5.1. An explicit choice made afterwards (setAudioBack) still wins;
  // re-picking the same feed keeps it.
  // A Bullet Train brings eARC back itself up to 10 m; a longer one carries ARC
  // (Dolby Digital 5.1 — what optical would), so only an Atmos room adds the kit.
  if (tv.displayType === "projector") earc = false;   // a projector returns no audio — no eARC, no kit, no optical
  const fresh = prev.video?.from !== from || prev.video?.run !== run;
  const autoBack = (run === "balun" || (run === "bullet" && !bulletFor(zone).earc)) && earc && fresh && !prev.ret;
  const kit = autoBack && isAtmosRoom(zone);
  if (kit) earc = false;                     // the kit carries the eARC, not the HDMI video run
  const ea = earc ? { earc: true } : {};
  if (run === "direct" || run === "bullet") {
    sol.connections.push({ from, to: tv.id, signal: "video", ...(run === "bullet" ? { run: "bullet" } : {}), ...ea, ...sc });
    if (kit) setReturn(job, sol, zone, from, false, true);
    return;
  }
  const comp = keep || { id: freeId(job, sol, `${run}-${zone.id}`), type: run, serves: tv.id, auto: true };
  if (!keep) sol.companions.push(comp);
  sol.connections.push({ from, to: comp.id, signal: "video", ...ea, ...sc }, { from: comp.id, to: tv.id, signal: "video", ...sc });
  if (autoBack) setReturn(job, sol, zone, from, !kit, kit);   // balun: optical backup, or the kit in an Atmos room
}
// an Atmos speaker set: height channels in its layout (surround-7.1.4, surround-5.1.2 …)
export const isAtmosRoom = zone => (zone.endpoints || []).some(e => e.type === "speakers" && /^surround-\d\.\d\.\d/.test(e.config || ""));

/* the TV's audio back to the rack, as one choice:
   "earc"          — over the HDMI from the receiver (default; no extra run)
   "earc+optical"  — eARC plus an optical (Toslink) backup run to `to`
   "earc-kit"      — the AVPro AC-AEX-DEARC-KIT: the TV's eARC port → one Cat6A →
                     an HDMI input on the receiver (its RX DIP 2 = HDMI OUT), full
                     Atmos / TrueHD back; replaces the optical run (AVPro manual, 2026-09-30)
   "optical"       — an optical run to `to` only (receiver or audio input module)
   "none"                                                                        */
export const AUDIO_BACK = AUDIO_BACK_NAME;   // one vocabulary (names.js)
export function setAudioBack(job, sol, zone, mode, to) {
  const h = readHookup(job, sol, zone);
  if (!h.tv) return;
  const viaReceiver = isReceiver(sol, h.video?.from);
  const wantEarc = viaReceiver && (mode === "earc" || mode === "earc+optical");
  if (!!h.earc !== wantEarc && h.video) setVideo(job, sol, zone, h.video.from, h.video.run, wantEarc);
  if (mode === "earc-kit") {   // the kit carries the eARC itself — into the receiver feeding the TV (or the one named)
    const rcv = to || (viaReceiver ? h.video.from : null);
    setReturn(job, sol, zone, rcv, false, !!rcv);
    return;
  }
  const optical = mode === "optical" || mode === "earc+optical";
  setReturn(job, sol, zone, optical ? (to || h.ret?.to || (viaReceiver ? h.video.from : null)) : null, mode === "earc+optical" && wantEarc);
}

/* after a room's picture or sound moves: its TV's audio return follows. Back to a receiver that no longer has
   anything to do with the room is a stray wire (2026-10-03 hammer: moving Family Room to the 1140 left its optical
   on the 740; picture to a receiver and back left a backup return behind) — it goes to the room's receiver now,
   or away if the room has none. A return to an input module (a Savant rack) isn't a receiver's — left alone. */
export function followReturn(job, sol, zone) {
  const h = readHookup(job, sol, zone);
  const mine = [h.speakers?.from, h.video?.from].filter(id => isReceiver(sol, id));
  if (h.tv && !h.ret && zone.retWas && mine.includes(zone.retWas.to)) {   // back on the receiver it had: its return comes back too
    const w = zone.retWas; delete zone.retWas; setAudioBack(job, sol, zone, w.mode, w.to); return;
  }
  if (!h.tv || !h.ret?.to || !isReceiver(sol, h.ret.to)) return;
  if (mine.includes(h.ret.to)) return;
  const to = mine[0];
  if (!to) { zone.retWas = { to: h.ret.to, mode: h.audioBack === "earc-kit" ? "earc-kit" : "optical" }; setAudioBack(job, sol, zone, h.earc ? "earc" : "none"); return; }
  setAudioBack(job, sol, zone, h.audioBack === "earc-kit" ? "earc-kit" : h.earc && isReceiver(sol, h.video?.from) && h.video.from === to ? "earc+optical" : "optical", to);
}

// amp outputs a speaker set needs, and the next free block on that amp
export function outputsNeeded(spk) {
  const c = spk?.config || "stereo";
  if (c === "mono") return 1;
  if (c === "landscape") return 2;          // the array rides one stereo pair per amp zone
  if (/^surround|^soundbar/.test(c)) return 0;   // surround/soundbar hang off a receiver, not amp zones
  return 2;
}
// a surround set on a multi-zone amp fed by an AXIS16 (it does the receiver's
// processing): a zone per pair and a zone EACH for center and LFE — never C+LFE together
export function surroundOutputs(spk) {
  return { "surround-5.1": 8, "surround-7.1": 10, "surround-7.1.4": 14 }[spk?.config] || 0;
}
const fedByAxis16 = (sol, ampId) => (sol.connections || []).some(c => c.to === ampId && c.dante && (sol.companions || []).some(k => k.id === c.from && k.type === "axis16"));
export function nextFreeOutputs(sol, ampId, n, exceptTo = null) {
  if (!n) return "";
  const used = new Set();
  for (const c of sol.connections || []) if (c.from === ampId && c.signal === "speaker" && c.to !== exceptTo)
    for (const part of String(c.channels || "").split(",")) {
      const m = part.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/); if (!m) continue;
      for (let i = +m[1]; i <= +(m[2] ?? m[1]); i++) used.add(i);
    }
  let start = 1;
  while ([...Array(n).keys()].some(k => used.has(start + k))) start += Math.min(n, 2);   // big sets align to pairs, not to their own size
  return n === 1 ? String(start) : `${start}-${start + n - 1}`;
}

/* the speakers: from a receiver or an amp; amps get their next free outputs */
export function setSpeakers(job, sol, zone, from, channels) {
  const { spk } = endpointsOf(zone); if (!spk) return;
  sol.connections ||= [];
  const prev = sol.connections.find(c => c.to === spk.id && c.signal === "speaker");
  const { tv } = endpointsOf(zone);
  sol.connections = sol.connections.filter(c => !(c.to === spk.id && c.signal === "speaker") && !(tv && c.from === tv.id && c.to === spk.id && c.signal === "audioReturn"));
  if (!from) return;
  if (from === "__tv" || from === tv?.id) {                // powered soundbar off the TV's HDMI eARC
    if (tv) sol.connections.push({ from: tv.id, to: spk.id, signal: "audioReturn", ...scopeOf(zone) });
    return;
  }
  const dev = rackDevices(sol).find(d => d.id === from);
  if (channels === undefined)
    channels = prev && prev.from === from ? prev.channels : dev?.type === "amp" && !isTheaterAmp(dev)
      ? nextFreeOutputs(sol, from, (fedByAxis16(sol, from) && surroundOutputs(spk)) || outputsNeeded(spk) || 2, spk.id) : "";
  sol.connections.push({ from, to: spk.id, signal: "speaker", ...(channels ? { channels } : {}), ...scopeOf(zone) });
}

/* the TV's audio back to the rack (eARC / optical into a receiver or input module) */
export function setReturn(job, sol, zone, to, backup = false, earcKit = false) {
  const { tv } = endpointsOf(zone); if (!tv) return;
  const atTv = new Set((sol.companions || []).filter(c => c.serves === tv.id).map(c => c.id));   // eARC into its AXIS stays
  const { spk } = endpointsOf(zone);                        // …and so does the TV's own soundbar
  sol.connections = (sol.connections || []).filter(c => !(c.from === tv.id && c.signal === "audioReturn" && !atTv.has(c.to) && c.to !== spk?.id));
  if (to) sol.connections.push({ from: tv.id, to, signal: "audioReturn", ...(backup ? { backup: true } : {}), ...(earcKit ? { earcKit: true } : {}), ...scopeOf(zone) });
}

/* quick-add's receiver for a room: the Anthem that fits its speakers (the
   Theater starter's default is an MRX 740). Pick another on GEAR. */
export function avrFor(spk) {
  const cfg = spk?.config || "";
  const [ref, model] = cfg === "surround-7.1.4" ? ["anthem-mrx-1140-8k", "Anthem MRX 1140"]
    : cfg === "surround-7.1" ? ["anthem-mrx-740-8k", "Anthem MRX 740"] : ["anthem-mrx-540-8k", "Anthem MRX 540"];
  return { model, catalogRef: ref };
}

/* a new box in the first rack, named plainly; returns its id */
export function addRackDevice(job, sol, type, model, extra = {}) {
  const want = extra.rackId && (sol.racks || []).find(r => r.id === extra.rackId);   // a named rack (a pool house's WattBox), else the first
  delete extra.rackId;
  const rack = want || (sol.racks ||= [])[0] || (sol.racks[0] = { id: "rack-main", name: "Equipment Rack", devices: [] });
  const id = freeId(job, sol, extra.idBase || (type === "avr" ? "avr" : type === "amp" ? "amp" : type));
  delete extra.idBase;
  rack.devices.push({ id, type, model, status: "new", ...(type === "amp" ? { zones: 8 } : {}), ...extra });
  return id;
}

/* ---------- Dante (a job's audio network is Dante OR Savant AVB) ----------
   TV sound gets onto Dante AT THE TV: an MXNet TV's decoder becomes the Dante
   model (AC-MXNET-1G-DANTE-DV2 — the default), any other TV gets an AXIS2 on
   its eARC, and a surround room gets an AXIS16 (decodes Atmos/DTS-HD, does
   the receiver's EQ/crossover/delay). The amp subscribes over the Dante
   network — a dashed "Dante audio" wire; the Cat6 runs go to the dedicated
   Dante switch. The system needs a Dante-mode CBOX + that switch. */
export const isDanteJob = sol => sol?.audioNetwork === "dante";
export const isTheaterAmp = d => /hype|hyperion/i.test(`${d?.catalogRef || ""} ${d?.model || ""}`);
const DIRECTOR = { type: "amp", model: "AudioControl M6800D", catalogRef: "audiocontrol-m6800d", zones: 8 };
const HYPE = { 5: ["penta", 5], 7: ["hepta", 7], 4: ["tetra", 4] };
const hyperion = n => { const [k, ch] = HYPE[n]; return { type: "amp", model: `AudioControl ACP-HYPE-${k.toUpperCase()}`, catalogRef: `audiocontrol-hype-${k}`, zones: 1, idBase: "hype" }; };

/* the Dante core every Dante system needs: controller + dedicated switch */
export function ensureDanteCore(job, sol) {
  sol.audioNetwork = "dante";
  const devs = rackDevices(sol);
  let ctl = devs.find(d => d.type === "controlBox" && /dante/i.test(`${d.catalogRef || ""} ${d.model || ""}`))?.id;
  if (!ctl) ctl = addRackDevice(job, sol, "controlBox", "AVPro Edge AC-MXNET-DANTE-CBOX", { catalogRef: "avpro-mxnet-dante-cbox", idBase: "dante-cbox" });
  let sw = devs.find(d => d.danteSwitch)?.id;
  if (!sw) sw = addRackDevice(job, sol, "networkSwitch", "AVPro Edge AC-MXNET-SW24E", { catalogRef: "avpro-mxnet-sw24e", danteSwitch: true, idBase: "dante-sw" });
  sol.connections ||= [];
  if (!sol.connections.some(c => c.from === ctl && c.to === sw)) sol.connections.push({ from: ctl, to: sw, signal: "network" });
  return { ctl, sw };
}
const linkToDanteSwitch = (sol, sw, id) => {
  if (!sol.connections.some(c => c.signal === "network" && ((c.from === sw && c.to === id) || (c.from === id && c.to === sw))))
    sol.connections.push({ from: sw, to: id, signal: "network" });
};

/* which amp takes this zone on a Dante job: surround → Hyperion by size
   (7.1.4 = Hepta, heights on a Tetra), else the next Director with room */
export function danteAmpFor(job, sol, zone, { director = false } = {}) {
  const { spk } = endpointsOf(zone);
  const cfg = spk?.config || "stereo";
  const need = surroundOutputs(spk) || outputsNeeded(spk) || 2;
  if (/^surround/.test(cfg) && !director) {
    const d = hyperion(cfg === "surround-5.1" ? 5 : 7);
    return addRackDevice(job, sol, d.type, d.model, { catalogRef: d.catalogRef, zones: 1, idBase: "hype" });
  }
  const used = id => new Set((sol.connections || []).filter(c => c.from === id && c.signal === "speaker")
    .flatMap(c => String(c.channels || "").split(",").flatMap(p => { const m = p.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/); return m ? Array.from({ length: +(m[2] ?? m[1]) - +m[1] + 1 }, (_, i) => +m[1] + i) : []; }))).size;
  const fits = d => d.type === "amp" && !isTheaterAmp(d) && /m6800d|m4800d|director/i.test(`${d.catalogRef || ""} ${d.model || ""}`) &&
    used(d.id) + need <= (d.zones || 8) * 2;
  const found = rackDevices(sol).find(fits);
  return found ? found.id : addRackDevice(job, sol, DIRECTOR.type, DIRECTOR.model, { catalogRef: DIRECTOR.catalogRef, zones: DIRECTOR.zones, idBase: "director" });
}

/* put a zone's TV sound on Dante and its speakers on a Dante amp */
export function setDanteAudio(job, sol, zone, ampId) {
  const { tv, spk } = endpointsOf(zone);
  sol.companions ||= []; sol.connections ||= [];
  const { sw } = ensureDanteCore(job, sol);
  const surround = /^surround/.test(spk?.config || "");
  const sc = scopeOf(zone);
  let src = null;
  if (tv) {
    const mine = sol.companions.filter(c => c.serves === tv.id);
    const dec = mine.find(c => c.type === "dec");
    const want = surround ? "axis16" : dec ? null : "axis";
    // adapters this choice doesn't reuse go, with their wires; old Dante feeds off the decoder too
    const drop = new Set(mine.filter(c => (c.type === "axis" || c.type === "axis16") && c.type !== want).map(c => c.id));
    sol.companions = sol.companions.filter(c => !drop.has(c.id));
    sol.connections = sol.connections.filter(c => !drop.has(c.from) && !drop.has(c.to) && !(c.dante && mine.some(m => m.id === c.from)));
    if (want) {
      let a = sol.companions.find(c => c.serves === tv.id && c.type === want);
      if (!a) { a = { id: freeId(job, sol, `${want}-${zone.id}`), type: want, serves: tv.id, auto: true }; sol.companions.push(a); }
      if (!sol.connections.some(c => c.from === tv.id && c.to === a.id))
        sol.connections.push({ from: tv.id, to: a.id, signal: "audioReturn", earc: true, ...sc });   // TV eARC into the AXIS
      src = a.id;
    } else {                                                   // AC-MXNET-1G-DANTE-DV2 (default at MXNet TVs)
      dec.dante = true; src = dec.id;
      // it breaks out the Dante the SOURCE's DANTE-EV2 put on the stream — make the encoders Dante too
      for (const e of sol.companions) if (e.type === "enc") e.dante = true;
    }
    for (const d of sol.companions.filter(c => c.serves === tv.id && c.type === "dec" && c.id !== src)) delete d.dante;
    if (surround && dec) delete dec.dante;
  }
  if (!ampId) return src;
  if (src) sol.connections.push({ from: src, to: ampId, signal: "audio", dante: true, ...sc });
  if (spk) setSpeakers(job, sol, zone, ampId);
  linkToDanteSwitch(sol, sw, ampId);
  return src;
}

/* a receiver fed by the house video: an HDMI matrix output straight in; an
   MXNet switch through a decoder at the receiver (it has no MXNet jack) */
// a TV fed from the matrix in a receiver room: its own apps reach the surround speakers
// only if its sound comes back — optical into the receiver (the receiver decodes it),
// or the eARC kit where Atmos matters or the run is too long for Toslink. Skipped when the TV already sends it somewhere.
function tvBackToReceiver(job, sol, zone, avr) {
  const { tv } = endpointsOf(zone);
  // a projector has no apps and sends no sound back: nothing to return
  if (!tv || tv.displayType === "projector" || readHookup(job, sol, zone).ret || readHookup(job, sol, zone).video?.from === avr) return;
  // Toslink past ~10 m is unreliable: a far room gets the kit (Cat6A, 100 m) as well
  const far = (knownRunM(zone) ?? 0) > RUN_LIMIT_M.optical + 0.5;
  setReturn(job, sol, zone, avr, false, isAtmosRoom(zone) || far);
}
function feedReceiver(job, sol, m, avr, sc) {
  if (m.type !== "avSwitch") { sol.connections.push({ from: m.id, to: avr, signal: "video", ...sc }); return; }
  const dec = { id: freeId(job, sol, `dec-${avr}`), type: "dec", serves: avr, auto: true };
  (sol.companions ||= []).push(dec);
  sol.connections.push({ from: m.id, to: dec.id, signal: "video", ...sc }, { from: dec.id, to: avr, signal: "video", ...sc });
}

/* an amp quick-add just gave speakers to, with nothing playing into it: on an MXNet rack its
   sound comes off the network — a decoder at the rack de-embeds the MXNet audio to its analog
   inputs (what the estate's pool house does). Other racks are left to the advisor's fix. */
export function feedAmp(job, sol, ampId) {
  const conns = (sol.connections ||= []);
  if (conns.some(c => c.to === ampId && !["network", "speaker", "audioReturn"].includes(c.signal))) return null;
  const sw = rackDevices(sol).find(d => d.type === "avSwitch" && !d.danteSwitch);
  if (!sw) return null;
  const dec = { id: freeId(job, sol, `dec-audio-${ampId}`), type: "dec", variant: "audio-deembed", serves: ampId, auto: true };
  (sol.companions ||= []).push(dec);
  conns.push({ from: sw.id, to: dec.id, signal: "video" }, { from: dec.id, to: ampId, signal: "audio" });
  return dec.id;
}

/* delete a rack box and everything that only existed for it (2026-10-03 hammer: deleting the MXNet switch left
   12 decoders drawn and wired with nothing feeding them, every room still green). Goes: the box, the adapters at
   it (its encoders), and any adapter whose every feed came from it (a TV's decoder or balun, an amp's audio
   decoder) — then their wires. Returns the rooms that lost a feed, so the caller can say so. */
export function removeRackDevice(job, sol, devId) {
  for (const r of sol.racks || []) r.devices = (r.devices || []).filter(d => d.id !== devId);
  const conns = sol.connections || [], comps = sol.companions || [];
  const gone = new Set([devId, ...comps.filter(c => c.serves === devId).map(c => c.id)]);
  for (let grew = true; grew;) {
    grew = false;
    for (const k of comps) {
      if (gone.has(k.id)) continue;
      const ins = conns.filter(c => c.to === k.id && c.signal !== "network");
      if (ins.length && ins.every(c => gone.has(c.from))) { gone.add(k.id); grew = true; }
    }
  }
  const hit = new Set();
  for (const c of conns) if (gone.has(c.from) && !gone.has(c.to)) {
    const k = comps.find(x => x.id === c.to);
    const z = (job.house?.zones || []).find(z => (z.endpoints || []).some(e => e.id === c.to || e.id === k?.serves));
    if (z) hit.add(z.name);
  }
  for (const k of comps) if (gone.has(k.id) && k.serves) { const z = (job.house?.zones || []).find(z => (z.endpoints || []).some(e => e.id === k.serves)); if (z) hit.add(z.name); }
  sol.connections = conns.filter(c => !gone.has(c.from) && !gone.has(c.to));
  sol.companions = comps.filter(c => !gone.has(c.id));
  for (const c of sol.connections) if (c.routeHint?.between?.some?.(x => gone.has(x))) delete c.routeHint;
  if (sol.poePower) for (const id of gone) delete sol.poePower[id];
  return [...hit];
}

/* a TV or speaker set added to a room that has the other (Display "None" → "TV" dropped the wiring with it):
   on the room's receiver if it has one, else the way quick-add would (the rack's switch, the next free amp zone) */
export function wireAdded(job, sol, zone) {
  let h = readHookup(job, sol, zone);
  const rcv = [h.speakers?.from, h.video?.from].find(id => isReceiver(sol, id));
  if (h.tv && !h.video && !h.tv.ownApps) {
    if (rcv && !rackDevices(sol).some(d => d.type === "videoMatrix" || (d.type === "avSwitch" && !d.danteSwitch))) setVideo(job, sol, zone, rcv, "balun", true);
    else autoHookup(job, sol, zone, {});
  }
  h = readHookup(job, sol, zone);
  if (h.spk && !h.speakers) {
    if (/^soundbar/.test(h.spk.config || "") && h.tv) setSpeakers(job, sol, zone, "__tv");
    else if (rcv && /^surround/.test(h.spk.config || "")) setSpeakers(job, sol, zone, rcv);
    else autoHookup(job, sol, zone, {});
  }
  followReturn(job, sol, zone);
}

/* a source added to an MXNet rack gets its encoder into the switch, like the kit's own sources (2026-10-03:
   an Apple TV added to the Bel Air rack sat unplugged). AVDM when the rack's other encoders are (a Savant
   rack breaks each source's audio out); nothing for a box with no picture or one that's already wired. */
export function encodeSource(job, sol, srcId, catalog = null) {
  const d = rackDevices(sol).find(x => x.id === srcId);
  if (!d || d.type !== "source") return null;
  const sw = rackDevices(sol).find(x => x.type === "avSwitch" && !x.danteSwitch);
  if (!sw) return null;
  const cat = d.catalogRef ? catalog?.devices?.[d.catalogRef] : null;
  if (cat?.outputs && !cat.outputs.hdmi) return null;
  if (/turn\s*table|record player|phono|music|streamer|tuner|radio/i.test(`${d.model || ""} ${d.sourceType || ""}`) && !/apple|roku|kaleidescape|cable/i.test(d.model || "")) return null;
  const conns = (sol.connections ||= []);
  if (conns.some(c => c.from === d.id && c.signal === "video")) return null;
  const encs = (sol.companions || []).filter(k => /^enc/.test(k.type));
  const enc = { id: freeId(job, sol, `enc-${d.id}`), type: "enc", serves: d.id, auto: true, ...(encs.length && encs.every(k => k.avdm) ? { avdm: true } : {}) };
  (sol.companions ||= []).push(enc);
  conns.push({ from: d.id, to: enc.id, signal: "video" }, { from: enc.id, to: sw.id, signal: "video" });
  // an AVDM rack sends each source's sound to the input module its other encoders feed
  const aim = enc.avdm && conns.find(c => encs.some(k => k.id === c.from) && c.signal === "audio")?.to;
  if (aim) conns.push({ from: enc.id, to: aim, signal: "audio" });
  return enc.id;
}

/* quick-add: wire a new zone from its shorthand hints */
// a room in an area with its own rack (a casita, a pool house) uses that rack's gear first, and new gear goes there
function homeRackOf(job, sol, zone) {
  const a = (job.house?.areas || []).find(x => x.id === zone.area);
  return a?.homeRack && (sol.racks || []).find(r => r.id === a.homeRack) || null;
}
// the home rack and any rack standing beside it (Main Rack A + B are one equipment room)
function homeRacksOf(job, sol, zone) {
  const home = homeRackOf(job, sol, zone); if (!home) return [];
  return (sol.racks || []).filter(r => r === home || r.beside === home.id || home.beside === r.id);
}

/* a room moved to another area (main house → casita): its wiring moves to that area's rack (2026-10-03, Ryan:
   "fix the area, move wiring to"). Its own receiver goes with it; speakers on an amp take a free zone on an amp
   there (another of the same amp if they're all full); the TV takes that rack's switch or matrix if it has one —
   a whole-house MXNet switch elsewhere still reaches it over the network, so that stays. Returns what it did. */
export function rehomeZone(job, sol, zone) {
  const homes = homeRacksOf(job, sol, zone); if (!homes.length) return [];
  const said = [], devs = () => rackDevices(sol);
  const here = id => homes.some(r => (r.devices || []).some(d => d.id === id));
  const dev = id => devs().find(d => d.id === id);
  const home = homes[0];
  let h = readHookup(job, sol, zone);
  // speakers
  const sFrom = dev(h.speakers?.from);
  if (sFrom && !here(sFrom.id)) {
    const others = (sol.connections || []).filter(c => c.from === sFrom.id && c.signal === "speaker" && c.to !== h.spk?.id);
    if (sFrom.type === "avr" && !others.length) {
      // the room's own receiver moves with the room
      for (const r of sol.racks) { if ((r.devices || []).includes(sFrom)) { r.devices = r.devices.filter(d => d !== sFrom); if (r.layout) delete r.layout[sFrom.id]; } }
      home.devices.push(sFrom); said.push(`${sFrom.model || sFrom.id} → ${home.name}`);
    } else if (sFrom.type === "avr") {
      const busy = new Set((sol.connections || []).filter(c => c.signal === "speaker").map(c => c.from));
      const free = devs().find(d => d.type === "avr" && here(d.id) && !busy.has(d.id));
      if (free) { setSpeakers(job, sol, zone, free.id); said.push(`speakers → ${free.model || free.id}`); }
      else said.push(`no free receiver in ${home.name} — speakers stay on ${sFrom.model || sFrom.id}`);
    } else if (sFrom.type === "amp") {
      const used = id => (sol.connections || []).filter(c => c.from === id && c.signal === "speaker").length;
      const amps = devs().filter(d => d.type === "amp" && here(d.id));
      let amp = amps.find(d => used(d.id) < (d.zones || 8));
      if (!amp && amps.length) {
        const last = amps[amps.length - 1], rk = homes.find(r => r.devices.includes(last));
        const id = addRackDevice(job, sol, "amp", last.model || "Multi-zone amp", { ...(last.catalogRef ? { catalogRef: last.catalogRef } : {}), zones: last.zones || 8, rackId: rk.id });
        amp = dev(id); said.push(`added ${amp.model} to ${rk.name}`);
      }
      if (amp) { setSpeakers(job, sol, zone, amp.id); if ((zone.scope || "included") === "included") feedAmp(job, sol, amp.id); h = readHookup(job, sol, zone); said.push(`speakers → ${amp.model || amp.id} ${h.speakers?.channels || ""}`.trim()); }
      else said.push(`${home.name} has no amp — speakers stay on ${sFrom.model || sFrom.id}`);
    }
  }
  // picture
  h = readHookup(job, sol, zone);
  const vFrom = dev(h.video?.from);
  if (vFrom && !here(vFrom.id)) {
    const hub = devs().find(d => here(d.id) && (d.type === "videoMatrix" || (d.type === "avSwitch" && !d.danteSwitch)));
    const rcv = dev(h.speakers?.from)?.type === "avr" && here(h.speakers.from) ? dev(h.speakers.from) : null;
    if (hub) { setVideo(job, sol, zone, hub.id); said.push(`TV → ${hub.model || hub.id}`); }
    else if (vFrom.type === "avr" && rcv) { setVideo(job, sol, zone, rcv.id, undefined, true); said.push(`TV → ${rcv.model || rcv.id}`); }
    // else: the house switch keeps feeding it over the network
  }
  followReturn(job, sol, zone);
  return said;
}
export function autoHookup(job, sol, zone, hints = {}) {
  const { tv, spk } = endpointsOf(zone);
  const home = homeRackOf(job, sol, zone), homes = homeRacksOf(job, sol, zone);
  const atHome = d => homes.some(r => (r.devices || []).includes(d));
  const devs = rackDevices(sol).sort((a, b) => atHome(b) - atHome(a));
  const homeX = home ? { rackId: home.id } : {};
  // "local": the Apple TV quick-add put in the room feeds this TV directly
  const loc = hints.local && tv && (sol.localDevices || []).find(d => d.zone === zone.id && d.type === "source");
  if (loc) setVideo(job, sol, zone, loc.id);
  // a whole-home rack (a matrix / MXNet switch) feeds every TV unless the room says "local"
  // (Ryan 2026-10-02: rooms wire themselves — no "matrix" keyword needed); a pre-wire TV is
  // its run back to the rack, to the video distributor, like a live one
  const distributor = devs.find(d => d.type === "videoMatrix") || devs.find(d => d.type === "avSwitch" && !d.danteSwitch);
  const tvFromRack = !loc && !hints.apps && (hints.matrix || (zone.scope === "prewire" && !hints.avr) || (!!distributor && !hints.avr));
  // a surround room that's part of this job gets its own receiver — added automatically
  // (5.1 → MRX 540, 7.1 → 740, Atmos → 1140) — unless it's a Dante job (Hyperion / Director)
  const included = (zone.scope || "included") === "included";
  if (!hints.avr && included && /^surround/.test(spk?.config || "") && !hints.dante && !isDanteJob(sol)
      && !(sol.connections || []).some(c => c.to === spk.id)) hints = { ...hints, avr: true };
  // a powered soundbar plays its TV's sound (HDMI eARC) unless a receiver drives it
  const barOffTv = () => { if (tv && /^soundbar/.test(spk?.config || "") && !readHookup(job, sol, zone).speakers) setSpeakers(job, sol, zone, "__tv"); };
  if ((hints.dante || isDanteJob(sol)) && !hints.avr) {
    // Dante job: video as asked (matrix → MXNet decoder), sound over Dante
    const m = devs.find(d => d.type === "avSwitch" && !d.danteSwitch) || devs.find(d => d.type === "videoMatrix");
    if (tvFromRack && tv && m) setVideo(job, sol, zone, m.id);
    if (spk && !/^soundbar/.test(spk.config || "")) setDanteAudio(job, sol, zone, danteAmpFor(job, sol, zone, hints));
    else if (tv) setDanteAudio(job, sol, zone, null);
    barOffTv();
    return;
  }
  if (hints.avr) {
    // one receiver per surround/theater zone is the norm — reuse one only if
    // it isn't already driving another zone's speakers
    const busy = new Set((sol.connections || []).filter(c => c.signal === "speaker").map(c => c.from));
    let avr = devs.find(d => d.type === "avr" && !busy.has(d.id))?.id;
    if (!avr) { const a = avrFor(spk); avr = addRackDevice(job, sol, "avr", a.model, { catalogRef: a.catalogRef, ...homeX }); }
    // a whole-home rack (a matrix / AV switch): the matrix feeds the receiver and the TV
    // SEPARATELY — one output each (Ryan 2026-09-30: matrix → receiver → TV is unstable
    // HDMI practice, an option for extreme cases, never the default). Without one, the
    // receiver is the room's source switch and feeds the TV itself.
    const m = devs.find(d => d.type === "videoMatrix") || devs.find(d => d.type === "avSwitch" && !d.danteSwitch);
    if (m) {
      if (tv && !loc && !hints.apps) setVideo(job, sol, zone, m.id, hints.bullet && m.type !== "avSwitch" ? "bullet" : undefined);
      if (spk) setSpeakers(job, sol, zone, avr);
      if (!(sol.connections || []).some(c => c.to === avr && c.signal !== "network" && c.signal !== "audioReturn"))   // the TV's return isn't a source
        feedReceiver(job, sol, m, avr, scopeOf(zone));
      tvBackToReceiver(job, sol, zone, avr);
      return;
    }
    if (tv && !loc) setVideo(job, sol, zone, avr, hints.bullet ? "bullet" : "balun", true);   // eARC back over the HDMI — the default, no extra run
    if (spk) setSpeakers(job, sol, zone, avr);
    return;
  }
  const m = devs.find(d => d.type === "videoMatrix") || devs.find(d => d.type === "avSwitch");
  if (tvFromRack && tv && m) setVideo(job, sol, zone, m.id, hints.bullet && m.type !== "avSwitch" ? "bullet" : undefined);
  // speakers: stereo-style sets take the next free amp zone; surround wants a
  // receiver (fed from the matrix, like a family room off a whole-home rack)
  if (spk && !readHookup(job, sol, zone).speakers) {
    const cfg = spk.config || "stereo";
    if (/^surround/.test(cfg)) {
      if (hints.matrix && m) {
        const busy = new Set((sol.connections || []).filter(c => c.signal === "speaker").map(c => c.from));
        let avr = devs.find(d => d.type === "avr" && !busy.has(d.id))?.id;
        if (!avr) { const a = avrFor(spk); avr = addRackDevice(job, sol, "avr", a.model, { catalogRef: a.catalogRef, ...homeX }); }
        setSpeakers(job, sol, zone, avr);
        if (!(sol.connections || []).some(c => c.to === avr && c.signal === "video"))   // (directly, or via its decoder)
          feedReceiver(job, sol, m, avr, {});
        tvBackToReceiver(job, sol, zone, avr);
      }
    } else if (!/^soundbar/.test(cfg)) {
      const used = id => (sol.connections || []).filter(c => c.from === id && c.signal === "speaker").length;
      const amps = devs.filter(d => d.type === "amp");
      let amp = amps.find(d => used(d.id) < (d.zones || 8));
      // every amp full: another of the same, beside the last one (2026-10-03: a 30-room job left 12 rooms unfed, silently)
      if (!amp && amps.length) {
        const last = amps.filter(d => !home || atHome(d)).pop() || amps[amps.length - 1];
        const rk = (sol.racks || []).find(r => (r.devices || []).includes(last));
        const id = addRackDevice(job, sol, "amp", String(last.model || "Multi-zone amp").replace(/\s*\(\d+\)$/, ""), {
          ...(last.catalogRef ? { catalogRef: last.catalogRef } : {}), zones: last.zones || 8, ...(rk ? { rackId: rk.id } : {}) });
        amp = rackDevices(sol).find(d => d.id === id);
      }
      if (amp) { setSpeakers(job, sol, zone, amp.id); if (included) feedAmp(job, sol, amp.id); }
    }
  }
  barOffTv();
}

export const speakerSetupName = spk => SPEAKER_SETUP[spk?.config || "stereo"] || spk?.config;

/* ---------- one-click fixes (Ryan 2026-10-02: "a friendlier building experience") ----------
   A finding the app knows how to fix gets buttons: an unfed TV → the rack's video, an Apple TV
   at the TV, or its own apps; unfed speakers → the right receiver / the next free amp zone /
   a new amp; an amp with no source on an MXNet rack → its audio decoder. Each fix is the same
   hookup call a tech would make by hand. `run(job, sol)` works on whatever copy it's given
   (the caller pushes undo first); fixes are looked up by ids, never by object, so they survive
   a re-render. */
export function quickFixes(job, sol, f, catalog = null) {
  const out = [];
  if (!f?.code) return out;
  // the advisor already sized the box it wants (a WattBox, a LAN switch): add it — or swap it in
  if (f.add?.ref && catalog?.devices?.[f.add.ref]) {
    const c = catalog.devices[f.add.ref], name = productName(c), qty = Math.max(1, f.add.qty || 1);
    out.push({ label: `${f.add.swap ? "Swap in" : "Add"} ${qty > 1 ? `${qty} × ` : "a "}${name}`, run: (j, s) => {
      if (f.add.swap) for (const r of s.racks || []) if (!f.rack || r.id === f.rack) r.devices = r.devices.filter(d => d.type !== f.add.type);
      for (let k = 0; k < qty; k++) addRackDevice(j, s, f.add.type, name, { catalogRef: f.add.ref, ...(f.rack ? { rackId: f.rack } : {}) });
    } });
    return out;
  }
  // a rack over-full / not fitting its space: a taller rack that still fits, or squeeze the spacing
  // PoE boxes on a switch that can't power them: injectors in the rack, or local power supplies
  if (f.code === "switch-no-poe" && f.ids?.length) {
    const n = f.ids.length, set = how => (j, s) => { s.poePower ||= {}; for (const id of f.ids) s.poePower[id] = how; };
    out.push({ label: `PoE injector${n > 1 ? `s for all ${n}` : ""}`, run: set("injector") });
    out.push({ label: `Local power suppl${n > 1 ? `ies for all ${n}` : "y"}`, run: set("psu") });
  }
  if ((f.code === "rack-full" || f.code === "rack-space") && f.rack) {
    const rackOf = s => (s.racks || []).find(r => r.id === f.rack);
    const pick = f.code === "rack-space" ? f.best : f.bigger;
    if (pick) out.push({ label: `Use the ${pick}${f.code === "rack-full" ? " (still fits the space)" : ""}`, run: (j, s) => { const r = rackOf(s); if (r) { r.rackModel = pick; r.sizeMode = "space"; } } });
    if (f.code === "rack-full" && !f.tight && !f.manual)
      out.push({ label: "Squeeze the spacing (keep the vents round amps)", run: (j, s) => { const r = rackOf(s); if (r) r.tight = true; } });
    // a second rack standing beside this one (same space, same rack) — then drag gear onto it on the rack page
    if (f.code === "rack-full") out.push({ label: "Add a second rack beside it (then drag gear onto it)", run: (j, s) => {
      const r = rackOf(s); if (!r) return;
      const n = (s.racks || []).filter(x => x.beside === r.id).length + 2;
      s.racks.push({ id: freeId(j, s, `${r.id}-b`), name: `${r.name} ${n}`, devices: [], beside: r.id,
        ...(r.space ? { space: { ...r.space } } : {}), ...(r.rackModel ? { rackModel: r.rackModel } : r.units ? { units: r.units } : {}),
        ...(r.sizeMode ? { sizeMode: r.sizeMode } : {}), ...(r.locked ? { locked: true } : {}), ...(r.casters === false ? { casters: false } : {}) });
    } });
    return out;
  }
  if (!f.ref) return out;
  const devs = rackDevices(sol);
  const zoneOf = j => (j.house?.zones || []).find(z => (z.endpoints || []).some(e => e.id === f.ref));
  const zone = zoneOf(job);
  if (f.code === "orphan-endpoint" && zone && (zone.scope || "included") === "included") {
    const ep = zone.endpoints.find(e => e.id === f.ref);
    const m = devs.find(d => d.type === "videoMatrix") || devs.find(d => d.type === "avSwitch" && !d.danteSwitch);
    const busy = new Set((sol.connections || []).filter(c => c.signal === "speaker").map(c => c.from));
    if (ep.type === "display") {
      if (m) out.push({ label: `Feed it from the ${m.model || "rack"}`, run: (j, s) => setVideo(j, s, zoneOf(j), m.id) });
      if (m) {
        const unfed = (j, so) => (j.house?.zones || []).filter(z => (z.scope || "included") === "included" && z.area === zone.area && (() => {
          const h = readHookup(j, so, z); return h.tv && !h.video && !h.tv.ownApps && !(so.localDevices || []).some(d => d.zone === z.id); })());
        const n = unfed(job, sol).length;
        if (n > 1) out.push({ label: `Feed all ${n} unfed TVs from the ${m.model || "rack"}`, run: (j, s) => { for (const z of unfed(j, s)) setVideo(j, s, z, m.id); } });
      }
      const avr = (sol.connections || []).find(c => c.signal === "speaker" && zone.endpoints.some(e => e.id === c.to) && devs.some(d => d.id === c.from && d.type === "avr"))?.from;
      if (avr && !m) out.push({ label: `Feed it from the ${devs.find(d => d.id === avr).model}`, run: (j, s) => setVideo(j, s, zoneOf(j), avr, "balun", true) });
      out.push({ label: "Add an Apple TV at the TV", run: (j, s) => {
        const z = zoneOf(j), id = freeId(j, s, `${z.id}-src`);
        (s.localDevices ||= []).push({ id, type: "source", sourceType: "appletv", model: "Apple TV", status: "new", zone: z.id, location: "at-display" });
        setVideo(j, s, z, id);
      } });
      out.push({ label: "It plays its own apps", run: j => { const e = zoneOf(j).endpoints.find(e => e.id === f.ref); if (e) e.ownApps = true; } });
    } else if (ep.type === "speakers") {
      const cfg = ep.config || "stereo";
      if (/^soundbar/.test(cfg)) {
        if (zone.endpoints.some(e => e.type === "display")) out.push({ label: "Play it from the TV (eARC)", run: (j, s) => setSpeakers(j, s, zoneOf(j), "__tv") });
      } else if (/^surround/.test(cfg)) {
        const free = devs.find(d => d.type === "avr" && !busy.has(d.id));
        const a = avrFor(ep);
        out.push({ label: free ? `Drive them from the ${free.model}` : `Add an ${a.model}`, run: (j, s) => {
          const z = zoneOf(j), id = free?.id || addRackDevice(j, s, "avr", a.model, { catalogRef: a.catalogRef });
          setSpeakers(j, s, z, id);
          const mm = rackDevices(s).find(d => d.type === "videoMatrix") || rackDevices(s).find(d => d.type === "avSwitch" && !d.danteSwitch);
          const tv = z.endpoints.find(e => e.type === "display");
          if (mm && !(s.connections || []).some(c => c.to === id && c.signal === "video")) feedReceiver(j, s, mm, id, {});
          else if (!mm && tv && !(s.connections || []).some(c => c.to === tv.id)) setVideo(j, s, z, id, "balun", true);
        } });
      } else {
        const used = id => (sol.connections || []).filter(c => c.from === id && c.signal === "speaker").length;
        const amp = devs.find(d => d.type === "amp" && used(d.id) < (d.zones || 8));
        out.push(amp ? { label: `Use the ${amp.model}`, run: (j, s) => { setSpeakers(j, s, zoneOf(j), amp.id); feedAmp(j, s, amp.id); } }
          : { label: "Add an Anthem MDX-16", run: (j, s) => { const id = addRackDevice(j, s, "amp", "Anthem MDX-16", { catalogRef: "anthem-mdx-16" }); setSpeakers(j, s, zoneOf(j), id); feedAmp(j, s, id); } });
      }
    }
  }
  // a surround room whose TV comes off the matrix: its own apps need their sound back to the receiver
  if (f.code === "tv-apps-no-surround" && zone) {
    const drive = (sol.connections || []).find(c => c.signal === "speaker" && zone.endpoints.some(e => e.id === c.to) && devs.some(d => d.id === c.from && d.type === "avr"));
    if (drive) {
      const name = devs.find(d => d.id === drive.from).model;
      out.push({ label: `Add optical back to the ${name}`, run: (j, s) => setReturn(j, s, zoneOf(j), drive.from, false, false) });
      out.push({ label: "Add the eARC kit (Atmos from the apps)", run: (j, s) => setReturn(j, s, zoneOf(j), drive.from, false, true) });
    }
  }
  // a switch out of ports: step up to the smallest switch of its own kind (same MXNet generation,
  // or a plain LAN switch) that holds what's on it with room to spare; its connections stay
  if (f.code === "switch-ports-full" && catalog?.devices) {
    const d = devs.find(x => x.id === f.ref), cur = d && catalog.devices[d.catalogRef];
    if (cur) {
      const mx = (cur.flags || []).includes("mxnet"), need = (f.need || 0) + 2;
      const total = c => { const p = portsOf(c); return p.copper + p.sfp; };
      const up = Object.entries(catalog.devices).filter(([, c]) => (c.type === "avSwitch" || c.type === "networkSwitch") && !(c.flags || []).includes("legacy")
          && ((c.flags || []).includes("mxnet") === mx) && (!mx || c.gen === cur.gen) && total(c) >= need && total(c) > total(cur))
        .sort((a, b) => total(a[1]) - total(b[1]))[0];
      if (up) out.push({ label: `Step up to the ${productName(up[1])} (${total(up[1])} ports)`, run: (j, s) => {
        const dev = rackDevices(s).find(x => x.id === d.id); if (!dev) return;
        dev.catalogRef = up[0]; dev.model = productName(up[1]); if (up[1].type) dev.type = up[1].type;
      } });
    }
  }
  // an amp with more rooms than zones (a smaller model picked): those rooms onto an amp with room for them, or another amp
  if (f.code === "amp-over") {
    const amp = rackDevices(sol).find(x => x.id === f.ref), zones = +amp?.zones || 0;
    if (amp && zones) {
      const feeds = (sol.connections || []).filter(c => c.from === amp.id && c.signal === "speaker");
      const past = feeds.filter(c => String(c.channels || "").split(/[,-]/).some(n => +n > zones * 2));
      const over = (past.length ? past : feeds.slice(zones)).map(c => c.to);
      const zoneOfEp = (j, id) => (j.house.zones || []).find(z => (z.endpoints || []).some(e => e.id === id));
      const used = id => (sol.connections || []).filter(c => c.from === id && c.signal === "speaker").length;
      const roomy = rackDevices(sol).find(d => d.type === "amp" && d.id !== amp.id && (+d.zones || 8) - used(d.id) >= over.length);
      if (roomy) out.push({ label: `Move ${over.length > 1 ? `those ${over.length} rooms` : "it"} to ${roomy.model || "the other amp"} (${(+roomy.zones || 8) - used(roomy.id)} zones free)`,
        run: (j, s) => { for (const ep of over) { const z = zoneOfEp(j, ep); if (z) setSpeakers(j, s, z, roomy.id); } } });
      out.push({ label: `Add another ${amp.model || "amp"} for ${over.length > 1 ? "them" : "it"}`, run: (j, s) => {
        const rk = (s.racks || []).find(r => (r.devices || []).some(d => d.id === amp.id));
        const id = addRackDevice(j, s, "amp", amp.model || "Multi-zone amp", { ...(amp.catalogRef ? { catalogRef: amp.catalogRef } : {}), zones, ...(rk ? { rackId: rk.id } : {}) });
        for (const ep of over) { const z = zoneOfEp(j, ep); if (z) setSpeakers(j, s, z, id); }
        feedAmp(j, s, id);
      } });
    }
  }
  if (f.code === "idle-receiver") {
    const d = rackDevices(sol).find(x => x.id === f.ref);
    if (d) out.push({ label: `Delete ${d.model || "the receiver"}`, run: (j, s) => { removeRackDevice(j, s, f.ref); } });
  }
  if (f.code === "surround-on-amp") {
    const z = zoneOf(job);
    if (z) out.push({ label: "Give it its own receiver", run: (j, s) => { const zz = (j.house.zones || []).find(x => x.id === z.id);
      const spk = (zz.endpoints || []).find(e => e.type === "speakers"); const a = avrFor(spk);
      const id = addRackDevice(j, s, "avr", a.model, { catalogRef: a.catalogRef }); setSpeakers(j, s, zz, id);
      const h = readHookup(j, s, zz); if (h.tv && !h.video) setVideo(j, s, zz, id); } });
  }
  if (f.code === "no-input") {
    const d = devs.find(x => x.id === f.ref);
    if (d?.type === "amp" && devs.some(x => x.type === "avSwitch" && !x.danteSwitch))
      out.push({ label: "Feed it from the MXNet switch", run: (j, s) => feedAmp(j, s, d.id) });
    else if (d?.type === "avr") {
      // a receiver nothing plays into: the rack's switch / matrix when there is one (its own output or decoder);
      // else a rack source whose HDMI out is free, or a new Apple TV (2026-10-03: "Feed it from the Apple TV 1"
      // offered an Apple TV already on its encoder — the fix made a new warning)
      const hub = devs.find(x => x.type === "videoMatrix") || devs.find(x => x.type === "avSwitch" && !x.danteSwitch);
      if (hub) out.push({ label: `Feed it from the ${hub.model || "rack switch"}`, run: (j, s) => feedReceiver(j, s, rackDevices(s).find(x => x.id === hub.id), d.id, {}) });
      const srcs = devs.filter(x => x.type === "source" && !(sol.connections || []).some(c => c.from === x.id && c.signal === "video")).slice(0, 2);
      for (const src of srcs) out.push({ label: `Feed it from the ${src.model}`, run: (j, s) => (s.connections ||= []).push({ from: src.id, to: d.id, signal: "video" }) });
      out.push({ label: "Add an Apple TV in the rack", run: (j, s) => { const id = addRackDevice(j, s, "source", "Apple TV", { sourceType: "appletv", idBase: "atv" }); s.connections.push({ from: id, to: d.id, signal: "video" }); } });
    }
    else if (d?.type === "amp") {
      // no network audio: the receiver's line out (whole-house audio off the theater), or a rack source
      for (const src of [devs.find(x => x.type === "avr"), devs.find(x => x.type === "source")].filter(Boolean))
        out.push({ label: `Feed it from the ${src.model}${src.type === "avr" ? " line out" : ""}`, run: (j, s) => (s.connections ||= []).push({ from: src.id, to: d.id, signal: "audio" }) });
    }
  }
  return out;
}

/* ---------- a rack-side adapter's analog audio out (Ryan 2026-10-02) ----------
   An MXNet AVDM encoder breaks its source's audio out as analog — normally into the Savant
   input module. It can go elsewhere: straight into an amp or a receiver (bypassing the AIM),
   or out to gear in a room. One output, one destination; null = not used. */
const AUDIO_IN_RACK = ["audioInputModule", "amp", "avr", "danteBridge"];
export function adapterAudioOut(sol, compId) {
  return (sol.connections || []).find(c => c.from === compId && c.signal === "audio" && !c.dante)?.to || null;
}
export function adapterAudioTargets(job, sol, compId) {
  const comp = (sol.companions || []).find(c => c.id === compId);
  const rack = rackDevices(sol).filter(d => AUDIO_IN_RACK.includes(d.type) && d.id !== comp?.serves);
  const zoneName = zid => (job.house?.zones || []).find(z => z.id === zid)?.name || zid;
  const local = (sol.localDevices || []).filter(d => ["amp", "avr"].includes(d.type)).map(d => ({ id: d.id, label: `${d.model || d.type} — ${zoneName(d.zone)}` }));
  return { rack: rack.map(d => ({ id: d.id, label: d.model || d.id, type: d.type })), local };
}
export function setAdapterAudio(sol, compId, to) {
  sol.connections = (sol.connections || []).filter(c => !(c.from === compId && c.signal === "audio" && !c.dante));
  if (to) sol.connections.push({ from: compId, to, signal: "audio" });
}
// a new amp in a room (the rare local feed: an encoder's analog out to an amp at the room) —
// it drives the room's speakers when nothing else does yet; returns its id
export function addLocalAmp(job, sol, zoneId) {
  const z = (job.house?.zones || []).find(x => x.id === zoneId); if (!z) return null;
  const id = freeId(job, sol, `${zoneId}-amp`);
  (sol.localDevices ||= []).push({ id, type: "amp", model: `Local amp — ${z.name}`, status: "new", zone: z.id, location: "at-display", zones: 1 });
  const spk = (z.endpoints || []).find(e => e.type === "speakers");
  if (spk && !(sol.connections || []).some(c => c.to === spk.id && c.signal === "speaker")) (sol.connections ||= []).push({ from: id, to: spk.id, signal: "speaker" });
  return id;
}
