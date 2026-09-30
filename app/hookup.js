/* ---------- hookup.js — "what feeds this zone" ----------
   A zone-centric view over a solution's connections: where the TV's video
   comes from (and how it gets there), where the speakers are driven from,
   and where the TV's audio goes back to. The editor's HOOKUP section and
   quick-add ("family room 5.1 75 avr") both go through here, so a receiver
   feeding a TV + a surround set is one choice, not four hand-made rows.
   Pure functions over the raw job — no DOM. Everything writes plain
   connections/companions; the engine needs nothing new. */

import { SPEAKER_SETUP, AUDIO_BACK_NAME } from "./names.js";

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
  const rack = (sol.racks ||= [])[0] || (sol.racks[0] = { id: "rack-main", name: "Equipment Rack", devices: [] });
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
function feedReceiver(job, sol, m, avr, sc) {
  if (m.type !== "avSwitch") { sol.connections.push({ from: m.id, to: avr, signal: "video", ...sc }); return; }
  const dec = { id: freeId(job, sol, `dec-${avr}`), type: "dec", serves: avr, auto: true };
  (sol.companions ||= []).push(dec);
  sol.connections.push({ from: m.id, to: dec.id, signal: "video", ...sc }, { from: dec.id, to: avr, signal: "video", ...sc });
}

/* quick-add: wire a new zone from its shorthand hints */
export function autoHookup(job, sol, zone, hints = {}) {
  const { tv, spk } = endpointsOf(zone);
  const devs = rackDevices(sol);
  // "local": the Apple TV quick-add put in the room feeds this TV directly
  const loc = hints.local && tv && (sol.localDevices || []).find(d => d.zone === zone.id && d.type === "source");
  if (loc) setVideo(job, sol, zone, loc.id);
  // a pre-wire TV is its run back to the rack — to the video distributor, like a live one
  const tvFromRack = !loc && (hints.matrix || (zone.scope === "prewire" && !hints.avr));
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
    if (!avr) { const a = avrFor(spk); avr = addRackDevice(job, sol, "avr", a.model, { catalogRef: a.catalogRef }); }
    if (tv) setVideo(job, sol, zone, avr, hints.bullet ? "bullet" : "balun", true);   // eARC back over the HDMI — the default, no extra run
    if (spk) setSpeakers(job, sol, zone, avr);
    // a receiver on a whole-home rack plays the house sources: one matrix output
    // into it (the Theater starter's receiver already has its own sources)
    const m = devs.find(d => d.type === "videoMatrix") || devs.find(d => d.type === "avSwitch" && !d.danteSwitch);
    if (m && !(sol.connections || []).some(c => c.to === avr && c.signal !== "network" && c.signal !== "audioReturn"))   // the TV's optical return isn't a source
      feedReceiver(job, sol, m, avr, scopeOf(zone));
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
        let avr = rackDevices(sol).find(d => d.type === "avr" && !busy.has(d.id))?.id;
        if (!avr) { const a = avrFor(spk); avr = addRackDevice(job, sol, "avr", a.model, { catalogRef: a.catalogRef }); }
        setSpeakers(job, sol, zone, avr);
        if (!(sol.connections || []).some(c => c.to === avr && c.signal === "video"))   // (directly, or via its decoder)
          feedReceiver(job, sol, m, avr, {});
      }
    } else if (!/^soundbar/.test(cfg)) {
      const used = id => (sol.connections || []).filter(c => c.from === id && c.signal === "speaker").length;
      const amp = rackDevices(sol).find(d => d.type === "amp" && used(d.id) < (d.zones || 8));
      if (amp) setSpeakers(job, sol, zone, amp.id);
    }
  }
  barOffTv();
}

export const speakerSetupName = spk => SPEAKER_SETUP[spk?.config || "stereo"] || spk?.config;
