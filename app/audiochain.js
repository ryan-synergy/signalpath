/* ---------- audiochain.js — what audio reaches each box, and how it's set up ----------
   Residential audio has one format ladder: 2ch PCM < 5.1 lossy bitstream
   (Dolby Digital / DTS) < full (lossless / Atmos over HDMI or eARC). Every
   link keeps the format or lowers it; only a box that decodes changes it.
   Ryan's rules (2026-09-29):
     - surround rooms (5.1 and up) are full-format: their receiver / AXIS16
       decodes anything, Atmos included — feed them bitstream, no setting
     - a 2-channel room gets 2ch PCM: something upstream downmixes (an AVDM
       encoder, an AC-AVDM, a receiver's zone 2) — and where nothing in the
       chain can, DOWNRES THE SOURCE ("keep it simple"): the source is set
       to stereo, printed as a setup line
     - a TV's own sound back to a receiver stays on auto (the receiver
       decodes); a TV into anything else (house amp, AXIS2, input module) is
       set to 2ch PCM
   audioSetup() walks the drawn connections from every source, finds each box
   that only plays 2ch PCM with no downmix on the way, and returns the setup
   list (per source, per TV) the service packet prints. Pure; catalog-driven. */

import { describeNode } from "./names.js";
import { bulletFor } from "./hookup.js";

const RANK = { pcm2: 0, lossy51: 1, full: 2 };
export const FORMAT_NAME = { pcm2: "2ch PCM (stereo)", lossy51: "5.1 Dolby Digital / DTS", full: "full (Atmos / lossless)" };

// what a source sends when left on auto
function sourceFormat(d, cat) {
  if (/stereo/.test(d.audioOut || "")) return "pcm2";                       // already downres'd
  const o = cat?.outputs || {};
  if (cat && !o.hdmi) return "pcm2";                                       // music servers, streamers, turntables
  if (/(cable|directv|dish|xfinity|spectrum|provider|u-?verse|fios)/i.test(`${d.model || ""} ${d.catalogRef || ""}`)) return "lossy51";
  if (/turn ?table|phono|music|sonos|port|streamer|tuner|radio/i.test(d.model || "") && !o.hdmi) return "pcm2";
  return "full";                                                           // Apple TV, Roku, Kaleidescape, game consoles
}

/* how a box treats audio passing through it:
   decode  — plays / decodes anything it's handed (receiver, AXIS16, TV, soundbar)
   needs2  — only plays 2ch PCM (PCM-only digital ins, analog ins fed digital audio, AXIS2, Dante encoders)
   pass    — passes the format on (matrices, MXNet encoders/decoders, baluns, switches)
   Downmixing is per OUTPUT, not per box (port audit 2026-09-29): an AXION's
   AUDIO blocks, an AC-AVDM's analog/optical and an AVDM-EV2's local 5-pin
   always downmix to 2ch, while their HDMI / HDBaseT / MXNet stream keep the
   full format — see downmixesAudio() */
const downmixesAudio = (node, cat) => (cat?.flags || []).includes("downmix2ch") || /axion/i.test(node.d?.model || "");
function role(node, cat) {
  const f = cat?.flags || [];
  if (node.kind === "display" || node.kind === "speakers") return "decode";
  if (node.type === "avr" || f.includes("atmosDecode")) return "decode";
  if (f.includes("pcmOnly2ch") || f.includes("pcmOnlyDigital") || f.includes("ultimo")) return "needs2";
  if (["amp", "audioInputModule", "danteBridge"].includes(node.type) || ["axis"].includes(node.compType)) return "needs2";
  return "pass";
}

export function audioSetup(job, ix, catalog, solIndex = 0) {
  const s = ix.solutions[solIndex]; if (!s) return { sources: [], tvs: [], notes: [] };
  const sol = s.sol, conns = sol.connections || [];
  const cat = ref => ref ? catalog?.devices?.[ref] : null;
  const name = id => describeNode(job, sol, id).short;
  const node = id => {
    const d = s.devices[id] || s.locals[id];
    if (d) return { id, type: d.type, d, cat: cat(d.catalogRef) };
    const c = s.companions[id];
    if (c) return { id, type: "companion", compType: c.type, cat: cat(companionCat(c)) };
    const e = ix.endpointsById[id];
    if (e) return { id, kind: e.type === "display" ? "display" : "speakers", e };
    return { id, type: "?" };
  };
  // audio moves along HDMI (video), line/digital audio and Dante links; not speaker wire or Cat6
  // control — except the Cat6 between two MXNet switches, which IS the AV network (stacked switches)
  const isAvSw = id => s.devices[id]?.type === "avSwitch";
  const outOf = id => conns.flatMap(c => {
    if (c.signal === "video" || c.signal === "audio") return c.from === id ? [c] : [];
    if (c.signal === "network" && isAvSw(c.from) && isAvSw(c.to) && (c.from === id || c.to === id)) return [{ ...c, from: id, to: c.from === id ? c.to : c.from }];
    return [];
  });

  const sources = [], tvs = [], notes = [];
  const srcs = [...Object.values(s.devices), ...Object.values(s.locals)].filter(d => d.type === "source");
  for (const d of srcs) {
    const fmt = sourceFormat(d, cat(d.catalogRef));
    // walk forward; stop at a box that decodes, downmixes or needs 2ch
    const needs = new Map(), decoders = new Set(), seen = new Set([d.id]);
    // a line-level link straight out of a source is its analog out — always 2ch
    // (a cable / DirecTV box downmixes its own analog out); only HDMI carries bitstream on
    const q = outOf(d.id).filter(c => c.signal === "video").map(c => c.to);
    while (q.length) {
      const id = q.shift(); if (seen.has(id)) continue; seen.add(id);
      const n = node(id), r = role(n, n.cat);
      if (r === "decode") {
        if (n.type === "avr" || n.cat?.flags?.includes("atmosDecode")) decoders.add(id);
        // a TV passes the source's sound on over eARC — a surround room's receiver
        // or AXIS16 behind the TV hears whatever the source was set to
        if (n.kind === "display") for (const c of conns.filter(c => c.from === id && c.signal === "audioReturn")) {
          const m = node(c.to); if (m.type === "avr" || m.cat?.flags?.includes("atmosDecode")) decoders.add(c.to);
        }
        continue;
      }
      if (r === "needs2") { needs.set(id, n); continue; }
      // passes the format on — except a downmixing box's line / digital audio outs, which carry 2ch PCM
      q.push(...outOf(id).filter(c => !(c.signal === "audio" && downmixesAudio(n, n.cat))).map(c => c.to));
    }
    if (fmt !== "pcm2" && needs.size) {
      const who = [...needs.keys()].map(name);
      const how = cat(d.catalogRef)?.stereoSetup || stereoHint(d);
      sources.push({ id: d.id, name: name(d.id), setting: "Stereo (2ch PCM)", how, reason: `${who.join(", ")} play${who.length > 1 ? "" : "s"} only 2ch PCM; nothing on the way downmixes`,
        format: fmt, downres: true });
      if (decoders.size) notes.push({ code: "downres-surround", ref: d.id,
        msg: `${name(d.id)} is set to stereo for the 2-channel zones, so ${[...decoders].map(name).join(", ")} also get${decoders.size > 1 ? "" : "s"} stereo from it — give a surround room its own source if it needs surround` });
    } else if (fmt !== "pcm2" && (decoders.size || seen.size > 1)) {
      sources.push({ id: d.id, name: name(d.id), setting: "Auto (bitstream)", how: "", reason: decoders.size ? `${[...decoders].map(name).join(", ")} decode${decoders.size > 1 ? "" : "s"} it` : "only TVs play it", format: fmt });
    }
  }

  // TVs: their own sound (apps, antenna) — auto into a decoder, 2ch PCM into anything else
  for (const [eid, e] of Object.entries(ix.endpointsById)) {
    if (e.type !== "display") continue;
    const back = conns.filter(c => c.from === eid && c.signal === "audioReturn");
    // …or back up the HDMI that feeds it: eARC on a direct run or a Bullet Train up to
    // 10 m; ARC (Dolby Digital 5.1 at most) on a longer Bullet Train. A balun / decoder
    // run carries no eARC (the advisor says so), so it doesn't count here.
    const hdmi = conns.find(c => c.to === eid && c.signal === "video" && c.earc && s.devices[c.from]);
    const arc = hdmi?.run === "bullet" && !bulletFor(ix.zonesById[ix.endpointZone[eid]]).earc;
    if (hdmi) back.push({ from: eid, to: hdmi.from, signal: "audioReturn", viaHdmi: true });
    if (!back.length) continue;
    const plain = back.filter(c => { const n = node(c.to); return role(n, n.cat) !== "decode"; });
    tvs.push(plain.length
      ? { id: eid, name: name(eid), setting: "PCM / Stereo", how: "TV sound settings › digital / eARC audio out = PCM (Stereo)", reason: `its sound goes to ${plain.map(c => name(c.to)).join(", ")}, which play${plain.length > 1 ? "" : "s"} only 2ch PCM` }
      : back.length === 1 && arc
      ? { id: eid, name: name(eid), setting: "Auto (bitstream / ARC)", how: "TV sound settings › ARC / HDMI audio out on, digital audio out = Auto", reason: `${name(hdmi.from)} decodes it — the ${bulletFor(ix.zonesById[ix.endpointZone[eid]]).m} m Bullet Train carries ARC (Dolby Digital 5.1), not eARC` }
      : { id: eid, name: name(eid), setting: "Auto (bitstream / eARC)", how: "TV sound settings › eARC on, digital audio out = Auto", reason: `${back.map(c => name(c.to)).join(", ")} decode${back.length > 1 ? "" : "s"} it${hdmi ? " (back up the HDMI)" : ""}` });
  }
  return { sources, tvs, notes };
}

// a source with no catalog link: the menu path by what it's called
function stereoHint(d) {
  const m = d.model || "";
  if (/apple ?tv/i.test(m)) return "Settings › Video and Audio › Audio Format › Change Format (on) › Stereo";
  if (/roku/i.test(m)) return "Settings › Audio › Digital output format › Stereo";
  if (/directv|genie/i.test(m)) return "MENU › Settings & Help › Settings › Audio › Dolby Digital › Off";
  if (/cable|xfinity|spectrum|cox|fios|u-?verse/i.test(m)) return "the box's audio settings: HDMI (and optical) output = Stereo";
  return "";
}

// the catalog product behind an app-added adapter (mirrors network.js companionRef, no tenG detail needed here)
function companionCat(c) {
  if (c.type === "axis") return "avpro-acp-axis2";
  if (c.type === "axis16") return "avpro-acp-axis16";
  if (c.type === "enc") return c.dante ? "avpro-mxnet-1g-dante-ev2" : "avpro-mxnet-1g-ev2";
  if (c.type === "dec") return c.dante ? "avpro-mxnet-1g-dante-dv2" : "avpro-mxnet-1g-dv2";
  if (c.type === "balun") return "avpro-ac-ex70-444-kit";
  return null;
}
