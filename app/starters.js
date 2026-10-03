import { tidyStarterStore } from "./library.js";
/* ---------- starters.js — rack starting points for a new job ----------
   Most jobs start from one of a handful of racks. A starter fills the rack
   with its gear (linked to the catalog, named by product) and the patching
   inside the rack; zones then come from quick-add ("family room 5.1 75
   matrix", "theater 7.1 85 avr"), which wires them to this gear.
   Pure data + one function over the raw job — no DOM. */

import { productName } from "./names.js";
import { zoneToQuick } from "./quickadd.js";

const dev = (id, type, catalogRef, model, extra = {}) => ({ id, type, catalogRef, model, status: "new", ...extra });
const src = (id, model) => ({ id, type: "source", model, status: "new" });
const v = (from, to) => ({ from, to, signal: "video" });

// order = what the new-job picker offers first (Ryan 2026-09-30): MXNet EV2 is the usual video;
// the audio is Savant, Dante, or just an MDX-16 on a smaller system; a matrix (an AXION) is rare
export const STARTERS = [
  {
    id: "mxnet-savant",
    group: "whole", line: "The usual: MXNet video, Savant audio, a multi-zone amp",   // the new-job card (2026-10-02 simpler cards)
    name: "MXNet + Savant audio",
    blurb: "The usual system: MXNet EV2 video (AVDM encoders break each source's audio out as stereo for the Savant input module), Savant AVB audio into a multi-zone amp.",
    tip: "family room 5.1 75 sony, kitchen stereo 55, patio landscape 8",
    solution: { platforms: ["savant"], audioNetwork: "avb" },
    devices: [
      src("atv1", "Apple TV 1"), src("atv2", "Apple TV 2"), src("cablebox", "Cable Box"),
      dev("music", "source", "savant-pav-sms2001"),
      dev("sw", "avSwitch", "avpro-mxnet-sw24e"),
      dev("cbx", "controlBox", "avpro-mxnet-cbox-ha"),
      dev("sav-in", "audioInputModule", "savant-pav-aim7c"),
      dev("sav-out", "audioOutputModule", "savant-pav-aom8c"),
      { id: "avb", type: "avbSwitch", catalogRef: "motu-avb-switch", status: "new" },   // Synergy's small AVB switch (Ryan 2026-10-01)
      dev("amp", "amp", "anthem-mdx-16", null, { zones: 8 }),
      // sized for a whole house (Ryan 2026-10-01): the 18-outlet WattBox and a house LAN switch
      // (every TV, the networked rack gear and the AV switch uplinks land on it)
      dev("lan", "networkSwitch", "ubiquiti-usw-pro-24-poe"),
      dev("power", "power", "wattbox-800vps-ipvm-18"),
    ],
    // AVDM encoders (AC-MXNET-1G-AVDM-EV2): video onto MXNet, and each source's sound — downmixed
    // to stereo — out of its balanced analog jack into the Savant input module (Ryan 2026-09-30)
    companions: [
      { id: "enc-atv1", type: "enc", serves: "atv1", auto: true, avdm: true },
      { id: "enc-atv2", type: "enc", serves: "atv2", auto: true, avdm: true },
      { id: "enc-cable", type: "enc", serves: "cablebox", auto: true, avdm: true },
    ],
    connections: [v("atv1", "enc-atv1"), v("enc-atv1", "sw"), v("atv2", "enc-atv2"), v("enc-atv2", "sw"),
      v("cablebox", "enc-cable"), v("enc-cable", "sw"), { from: "cbx", to: "sw", signal: "network" },
      { from: "enc-atv1", to: "sav-in", signal: "audio" }, { from: "enc-atv2", to: "sav-in", signal: "audio" }, { from: "enc-cable", to: "sav-in", signal: "audio" },
      { from: "avb", to: "music", signal: "network" },
      { from: "avb", to: "sav-in", signal: "network" }, { from: "avb", to: "sav-out", signal: "network" },
      { from: "sav-out", to: "amp", signal: "audio" }],
  },
  {
    id: "dante-director",
    group: "whole", line: "MXNet video, Dante audio on Director amps",   // the new-job card (2026-10-02 simpler cards)
    name: "MXNet + Dante",
    blurb: "MXNet video + Dante audio: Director amps, Dante decoders (DANTE-DV2) at MXNet TVs, AXIS2/AXIS16 elsewhere, Dante CBOX + its own switch.",
    tip: "kitchen stereo 55, family room 5.1 75, office stereo 43, theater 7.1 85",
    solution: { audioNetwork: "dante" },
    devices: [
      src("atv1", "Apple TV 1"), src("atv2", "Apple TV 2"), src("cablebox", "Cable Box"),
      dev("music", "source", "savant-pav-sms2001"),
      dev("sw", "avSwitch", "avpro-mxnet-sw24e"),
      dev("cbx", "controlBox", "avpro-mxnet-cbox-ha"),
      dev("dante-cbox", "controlBox", "avpro-mxnet-dante-cbox"),
      dev("dante-sw", "networkSwitch", "avpro-mxnet-sw24e", null, { danteSwitch: true }),
      dev("dante-in", "danteBridge", "audiocontrol-acp-dante-e-poe"),
      dev("director", "amp", "audiocontrol-m6800d"),
      dev("lan", "networkSwitch", "ubiquiti-usw-pro-24-poe"),   // house LAN (the Dante switch stays its own)
      dev("power", "power", "wattbox-800vps-ipvm-18"),
    ],
    companions: [
      { id: "enc-atv1", type: "enc", serves: "atv1", auto: true },
      { id: "enc-atv2", type: "enc", serves: "atv2", auto: true },
      { id: "enc-cable", type: "enc", serves: "cablebox", auto: true },
    ],
    connections: [v("atv1", "enc-atv1"), v("enc-atv1", "sw"), v("atv2", "enc-atv2"), v("enc-atv2", "sw"),
      v("cablebox", "enc-cable"), v("enc-cable", "sw"), { from: "cbx", to: "sw", signal: "network" },
      { from: "music", to: "dante-in", signal: "audio" },                          // music server optical → Dante encoder
      { from: "dante-in", to: "director", signal: "audio", dante: true },
      { from: "dante-cbox", to: "dante-sw", signal: "network" }, { from: "dante-sw", to: "director", signal: "network" }],
  },
  {
    id: "mxnet",
    group: "whole", line: "Smaller whole-home: MXNet video, speaker rooms on an MDX-16",   // the new-job card (2026-10-02 simpler cards)
    name: "MXNet + MDX-16",
    blurb: "For a smaller system: sources on MXNet EV2 encoders into a switch, decoders at each TV, the speaker rooms on an Anthem MDX-16.",
    tip: "family room 5.1 75 sony, master bed stereo 65",
    devices: [
      src("atv1", "Apple TV 1"), src("atv2", "Apple TV 2"), src("cablebox", "Cable Box"),
      dev("sw", "avSwitch", "avpro-mxnet-sw12"),
      dev("cbx", "controlBox", "avpro-mxnet-cbox-ha"),
      dev("amp", "amp", "anthem-mdx-16", null, { zones: 8 }),
      dev("lan", "networkSwitch", "ubiquiti-usw-pro-24-poe"),
      dev("power", "power", "wattbox-800vps-ipvm-18"),
    ],
    companions: [
      { id: "enc-atv1", type: "enc", serves: "atv1", auto: true },
      { id: "enc-atv2", type: "enc", serves: "atv2", auto: true },
      { id: "enc-cable", type: "enc", serves: "cablebox", auto: true },
    ],
    connections: [v("atv1", "enc-atv1"), v("enc-atv1", "sw"), v("atv2", "enc-atv2"), v("enc-atv2", "sw"),
      v("cablebox", "enc-cable"), v("enc-cable", "sw"), { from: "cbx", to: "sw", signal: "network" }],
  },
  {
    id: "theater-receiver",
    group: "room", line: "One receiver runs the theater's TV and surround",   // the new-job card (2026-10-02 simpler cards)
    name: "Theater receiver",
    blurb: "One AV receiver drives the theater's TV and surround speakers.",
    tip: "theater 7.1 85 sony avr",
    devices: [src("cablebox", "Cable Box"), src("atv", "Apple TV"), dev("avr", "avr", "anthem-mrx-740-8k"),
      dev("power", "power", "wattbox-800-ipvm-6")],
    connections: [v("cablebox", "avr"), v("atv", "avr")],
  },
  {
    id: "savant-whole-home",
    group: "whole", line: "HDMI matrix to the TVs, Savant audio (rare now)",   // the new-job card (2026-10-02 simpler cards)
    name: "HDMI matrix (AXION) + Savant audio",
    blurb: "Rare nowadays: an AXION matrix to the TVs (its audio outs downmix to stereo for the Savant input module), Savant AVB audio into a multi-zone amp.",
    tip: "family room 5.1 75 sony, kitchen stereo, patio landscape 8",
    solution: { platforms: ["savant"], audioNetwork: "avb" },
    devices: [
      src("cablebox", "Cable Box"), src("atv", "Apple TV"),
      dev("music", "source", "savant-pav-sms2001"),
      dev("matrix", "videoMatrix", "avpro-ac-axion-8"),   // Ryan 2026-09-30: when it's a matrix, it's an AXION
      dev("sav-in", "audioInputModule", "savant-pav-aim7c"),
      dev("sav-out", "audioOutputModule", "savant-pav-aom8c"),
      { id: "avb", type: "avbSwitch", catalogRef: "motu-avb-switch", status: "new" },   // Synergy's small AVB switch (Ryan 2026-10-01)
      dev("amp", "amp", "anthem-mdx-16", null, { zones: 8 }),
      dev("power", "power", "wattbox-800-ipvm-12"),
    ],
    connections: [v("cablebox", "matrix"), v("atv", "matrix"),
      // the music server joins the Savant AVB network itself (Ryan 2026-09-30) — it's digital-only,
      // so never into the analog input module; outside a Savant audio system it goes optical into the amp
      { from: "avb", to: "music", signal: "network" },
      { from: "avb", to: "sav-in", signal: "network" }, { from: "avb", to: "sav-out", signal: "network" },
      // the sources reach the audio rooms through the input module: the matrix's audio outs
      // (AUDIO 1–2, always downmixed to stereo — the receivers still get full surround over HDMI) into its inputs (Ryan 2026-09-30)
      { from: "matrix", to: "sav-in", signal: "audio", count: 2 },
      { from: "sav-out", to: "amp", signal: "audio" }],
  },
  /* ---- drafted 2026-10-01 for Ryan to refine (Settings → Starter kits: hide, reorder, duplicate to
          change). Each carries starting rooms so it shows what it's for; quick-add wires them. ---- */
  {
    id: "mxnet-10g-estate",
    group: "whole", line: "Large house: MXNet 10G, Kaleidescape, two MDX-16s",   // the new-job card (2026-10-02 simpler cards)
    name: "MXNet 10G estate + Savant audio",
    blurb: "A large house: MXNet 10G (encoders become 10G transceivers), Kaleidescape, Savant AVB audio through two output modules into two MDX-16s, a 48-port house switch.",
    tip: "bedroom 4 stereo 55, wine room stereo",
    solution: { platforms: ["savant"], audioNetwork: "avb" },
    devices: [
      src("atv1", "Apple TV 1"), src("atv2", "Apple TV 2"), src("cablebox", "Cable Box"),
      dev("kscape", "source", "kaleidescape-strato-v"),
      dev("music", "source", "savant-pav-sms2001"),
      dev("sw", "avSwitch", "avpro-mxnet-10g-sw24c"),
      dev("cbx", "controlBox", "avpro-mxnet-cbox-ha"),
      dev("sav-in", "audioInputModule", "savant-pav-aim7c"),
      dev("sav-out", "audioOutputModule", "savant-pav-aom8c"),
      dev("sav-out2", "audioOutputModule", "savant-pav-aom8c"),
      { id: "avb", type: "avbSwitch", catalogRef: "motu-avb-switch", status: "new" },   // Synergy's small AVB switch (Ryan 2026-10-01)
      dev("amp", "amp", "anthem-mdx-16", null, { zones: 8 }),
      dev("amp2", "amp", "anthem-mdx-16", null, { zones: 8 }),
      dev("lan", "networkSwitch", "ubiquiti-usw-pro-max-48-poe"),
      dev("power", "power", "wattbox-800vps-ipvm-18"),
      dev("power2", "power", "wattbox-800vps-ipvm-18"),
    ],
    companions: [
      { id: "enc-atv1", type: "enc", serves: "atv1", auto: true, avdm: true },
      { id: "enc-atv2", type: "enc", serves: "atv2", auto: true, avdm: true },
      { id: "enc-cable", type: "enc", serves: "cablebox", auto: true, avdm: true },
      { id: "enc-kscape", type: "enc", serves: "kscape", auto: true },
    ],
    connections: [v("atv1", "enc-atv1"), v("enc-atv1", "sw"), v("atv2", "enc-atv2"), v("enc-atv2", "sw"),
      v("cablebox", "enc-cable"), v("enc-cable", "sw"), v("kscape", "enc-kscape"), v("enc-kscape", "sw"),
      { from: "cbx", to: "sw", signal: "network" },
      { from: "enc-atv1", to: "sav-in", signal: "audio" }, { from: "enc-atv2", to: "sav-in", signal: "audio" }, { from: "enc-cable", to: "sav-in", signal: "audio" },
      { from: "avb", to: "music", signal: "network" }, { from: "avb", to: "sav-in", signal: "network" },
      { from: "avb", to: "sav-out", signal: "network" }, { from: "avb", to: "sav-out2", signal: "network" },
      { from: "sav-out", to: "amp", signal: "audio" }, { from: "sav-out2", to: "amp2", signal: "audio" }],
    rooms: "family room 7.1.4 85 sony, primary suite 5.1 77 lg, theater 7.1.4 projector 135, kitchen stereo 65, office stereo 50, " +
      "gym 65 matrix, bedroom 2 stereo 55 matrix, bedroom 3 stereo 55 matrix, dining room stereo, primary bath stereo, patio landscape 8, pool landscape 12",
  },
  {
    id: "condo",
    group: "small", line: "Two sources on MXNet, Sonos Port into an MDX-8",   // the new-job card (2026-10-02 simpler cards)
    name: "Condo — MXNet + MDX-8",
    blurb: "A small system: two sources on MXNet EV2 into an 8-port switch, a Sonos Port streaming into an MDX-8 for the speaker rooms, a receiver for the living room's surround.",
    tip: "guest room 50, balcony stereo",
    devices: [
      src("atv1", "Apple TV"), src("cablebox", "Cable Box"),
      dev("music", "source", "sonos-port"),   // streaming into the MDX-8
      dev("sw", "avSwitch", "avpro-mxnet-sw12"),
      dev("cbx", "controlBox", "avpro-mxnet-cbox-ha"),
      dev("amp", "amp", "anthem-mdx-8", null, { zones: 4 }),
      dev("lan", "networkSwitch", "ubiquiti-usw-pro-24-poe"),
      dev("power", "power", "wattbox-800-ipvm-12"),
    ],
    companions: [
      { id: "enc-atv1", type: "enc", serves: "atv1", auto: true },
      { id: "enc-cable", type: "enc", serves: "cablebox", auto: true },
    ],
    connections: [v("atv1", "enc-atv1"), v("enc-atv1", "sw"), v("cablebox", "enc-cable"), v("enc-cable", "sw"), { from: "cbx", to: "sw", signal: "network" },
      { from: "music", to: "amp", signal: "audio" }],
    rooms: "living room 5.1 75 sony, primary bedroom stereo 55, kitchen stereo, office 43",
  },
  {
    id: "sonos",
    group: "small", line: "No video distribution: TVs local, Sonos Amps for audio",   // the new-job card (2026-10-02 simpler cards)
    name: "Sonos — streaming, local TVs",
    blurb: "No video distribution: each TV has its own source; Sonos Amps in the rack drive the speaker rooms over the network, a Sonos soundbar in the family room.",
    tip: "office stereo, primary bath stereo",
    devices: [
      dev("amp1", "amp", "sonos-amp"), dev("amp2", "amp", "sonos-amp"), dev("amp3", "amp", "sonos-amp"),
      dev("lan", "networkSwitch", "ubiquiti-usw-pro-24-poe"),
      dev("power", "power", "wattbox-800-ipvm-6"),
    ],
    connections: [],
    rooms: "family room soundbar 75 sony local, kitchen stereo, primary bedroom stereo 55 local, patio stereo",
  },
  {
    id: "josh-dante",
    group: "whole", line: "Josh.ai control, MXNet video, Dante audio",   // the new-job card (2026-10-02 simpler cards)
    name: "Josh.ai + MXNet + Dante",
    blurb: "Josh.ai control with Josh remotes; MXNet EV2 video, Dante audio into a Director amp, Dante decoders at the TVs, Dante CBOX on its own switch.",
    tip: "guest room stereo 50 josh remote",
    solution: { audioNetwork: "dante", platforms: ["josh"] },
    devices: [
      src("atv1", "Apple TV 1"), src("atv2", "Apple TV 2"), src("cablebox", "Cable Box"),
      dev("music", "source", "savant-pav-sms2001"),
      dev("sw", "avSwitch", "avpro-mxnet-sw24e"),
      dev("cbx", "controlBox", "avpro-mxnet-cbox-ha"),
      dev("dante-cbox", "controlBox", "avpro-mxnet-dante-cbox"),
      dev("dante-sw", "networkSwitch", "avpro-mxnet-sw24e", null, { danteSwitch: true }),
      dev("dante-in", "danteBridge", "audiocontrol-acp-dante-e-poe"),
      dev("director", "amp", "audiocontrol-m6800d"),
      dev("lan", "networkSwitch", "ubiquiti-usw-pro-24-poe"),
      dev("power", "power", "wattbox-800vps-ipvm-18"),
    ],
    companions: [
      { id: "enc-atv1", type: "enc", serves: "atv1", auto: true },
      { id: "enc-atv2", type: "enc", serves: "atv2", auto: true },
      { id: "enc-cable", type: "enc", serves: "cablebox", auto: true },
    ],
    connections: [v("atv1", "enc-atv1"), v("enc-atv1", "sw"), v("atv2", "enc-atv2"), v("enc-atv2", "sw"),
      v("cablebox", "enc-cable"), v("enc-cable", "sw"), { from: "cbx", to: "sw", signal: "network" },
      { from: "music", to: "dante-in", signal: "audio" },
      { from: "dante-in", to: "director", signal: "audio", dante: true },
      { from: "dante-cbox", to: "dante-sw", signal: "network" }, { from: "dante-sw", to: "director", signal: "network" }],
    rooms: "family room 5.1 75 sony josh remote, kitchen stereo 55 josh remote, primary suite stereo 65 josh remote, office stereo 43 josh remote",
  },
  {
    id: "outdoor",
    group: "small", line: "Landscape audio and Sunbrite TVs for outdoor living",   // the new-job card (2026-10-02 simpler cards)
    name: "Outdoor living — landscape + Sunbrite",
    blurb: "Outdoor-heavy: Sonance landscape sets on a Sonance amp, an MDX-8 for the stereo areas (a Sonos Port streaming into each), patio and outdoor kitchen Sunbrite TVs on MXNet.",
    tip: "side yard landscape 6, cabana stereo",
    devices: [
      src("atv1", "Apple TV"), src("cablebox", "Cable Box"),
      dev("sw", "avSwitch", "avpro-mxnet-sw12"),
      dev("cbx", "controlBox", "avpro-mxnet-cbox-ha"),
      dev("music", "source", "sonos-port"), dev("music2", "source", "sonos-port"),   // one streaming into each amp
      dev("land", "amp", "sonance-blaze-pzc-504"),   // 2 zones: the two landscape areas
      dev("amp", "amp", "anthem-mdx-8", null, { zones: 4 }),
      dev("lan", "networkSwitch", "ubiquiti-usw-pro-24-poe"),
      dev("power", "power", "wattbox-800vps-ipvm-18"),
    ],
    companions: [
      { id: "enc-atv1", type: "enc", serves: "atv1", auto: true },
      { id: "enc-cable", type: "enc", serves: "cablebox", auto: true },
    ],
    connections: [v("atv1", "enc-atv1"), v("enc-atv1", "sw"), v("cablebox", "enc-cable"), v("enc-cable", "sw"), { from: "cbx", to: "sw", signal: "network" },
      { from: "music", to: "land", signal: "audio" }, { from: "music2", to: "amp", signal: "audio" }],
    // landscapes first: quick-add fills amps in rack order, so the Sonance takes them and the MDX-8 the stereo areas
    rooms: "pool landscape 12, front yard landscape 6, patio stereo 65 sunbrite, outdoor kitchen stereo 55 sunbrite, fire pit stereo",
  },
  {
    id: "dedicated-theater",
    group: "room", line: "Kaleidescape + MRX 1140, projector on a Bullet Train",   // the new-job card (2026-10-02 simpler cards)
    name: "Dedicated theater — Kaleidescape + MRX 1140",
    blurb: "A room of its own: Kaleidescape, Apple TV and cable into an Anthem MRX 1140, the projector on an AVPro Bullet Train.",
    tip: "theater 7.1.4 projector 135 avr bullet",
    devices: [
      dev("kscape", "source", "kaleidescape-strato-v"), src("atv", "Apple TV"), src("cablebox", "Cable Box"),
      dev("avr", "avr", "anthem-mrx-1140-8k"),
      dev("lan", "networkSwitch", "ubiquiti-usw-pro-24-poe"),
      dev("power", "power", "wattbox-800-ipvm-12"),
    ],
    connections: [v("kscape", "avr"), v("atv", "avr"), v("cablebox", "avr")],
    rooms: "theater 7.1.4 projector 135 avr bullet",
  },
  {
    id: "prewire",
    group: "start", line: "Rough-in only — every room pre-wired, no gear yet",   // the new-job card (2026-10-02 simpler cards)
    name: "Prewire only — rough-in",
    blurb: "Rough-in before the gear is chosen: every room pre-wired, no rack gear yet. The quote carries Synergy's prewire items.",
    tip: "bedroom 2 prewire stereo 55",
    devices: [],
    connections: [],
    rooms: "family room prewire 7.1.4 85, primary suite prewire 5.1 75, kitchen prewire stereo 55, office prewire tv 43, patio prewire landscape 8, gym prewire tv 55",
  },
  {
    id: "blank",
    group: "start", line: "Start empty and add gear yourself",   // the new-job card (2026-10-02 simpler cards)
    name: "Blank rack",
    blurb: "Start empty and add gear yourself.",
    tip: "family room 5.1 75 sony, kitchen stereo",
    devices: [], connections: [],
  },
];

/* fill a (blank) job's first solution from a starter; catalog-linked gear
   takes its product's name, so the drawing, lists and catalog agree */
export function applyStarter(job, starter, catalog) {
  const sol = job.solutions[0];
  const rack = (sol.racks ||= [])[0] || (sol.racks[0] = { id: "rack-main", name: "Equipment Rack", devices: [], sizeMode: "auto" });
  rack.devices = starter.devices.map(d => {
    const c = d.catalogRef ? catalog?.devices?.[d.catalogRef] : null;
    const out = { ...d, model: d.model || (c ? productName(c) : d.id) };
    if (!c) delete out.catalogRef;                     // a ref the catalog lacks would only confuse the advisor
    if (out.type === "amp" && c?.zones) out.zones = c.zones;
    if (out.model == null) delete out.model;
    return out;
  });
  sol.companions = structuredClone(starter.companions || []);
  sol.connections = structuredClone(starter.connections);
  if (starter.solution?.audioNetwork) sol.audioNetwork = starter.solution.audioNetwork; else delete sol.audioNetwork;
  if (starter.solution?.platforms) sol.platforms = [...starter.solution.platforms];   // a Savant rack is a Savant job: licensing advice follows
  job.job.starter = starter.id;
  return job;
}

/* ---- starter kits you make (Settings → Starter kits, 2026-10-01) ----
   A kit is the same shape as a shipped starter: the first rack's gear, the adapters at that gear
   (encoders on its sources), the patching between them, the audio platform — and, optionally,
   starting rooms as quick-add text ("family room 5.1 75 sony matrix, …") that a new job adds
   through the same parser and hookup as a typed line. */
const kitSlug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "kit";
export function starterFromJob(job, solIndex = 0, { name = "My starter", blurb = "", tip = "", includeRooms = false, taken = [] } = {}) {
  const sol = job.solutions?.[solIndex] || {}, rack = sol.racks?.[0] || { devices: [] };
  const devices = structuredClone(rack.devices || []);
  const ids = new Set(devices.map(d => d.id));
  const companions = structuredClone((sol.companions || []).filter(c => ids.has(c.serves)));
  for (const c of companions) ids.add(c.id);
  const connections = structuredClone((sol.connections || []).filter(c => ids.has(c.from) && ids.has(c.to)));
  const rooms = includeRooms ? (job.house?.zones || []).map(z => zoneToQuick(z, sol)).join(", ") : "";
  let id = "my-" + kitSlug(name), k = 2; while (taken.includes(id)) id = `my-${kitSlug(name)}-${k++}`;
  const solution = {};
  if (sol.platforms?.length) solution.platforms = [...sol.platforms];
  if (sol.audioNetwork) solution.audioNetwork = sol.audioNetwork;
  return { id, name, blurb, tip: tip || rooms.split(", ").slice(0, 2).join(", "), solution, devices, companions, connections,
    ...(rooms ? { rooms } : {}), custom: true, madeFrom: job.job?.name || "", ...(sol.racks?.length > 1 ? { note: "first rack only" } : {}) };
}
// the kits the new-job picker offers: shipped ones and yours, in your order, each marked
export function listStarters(store = {}) {
  store = tidyStarterStore(store);                     // a damaged store lists the shipped kits, never throws
  const mine = Object.values(store.mine), hidden = new Set(store.hidden);
  const all = [...STARTERS.map(s => ({ ...s, shipped: true })), ...mine], byId = new Map(all.map(s => [s.id, s]));
  // your order first; a kit it doesn't mention (a kit added to the app later, or a new one of yours)
  // slots in right after the kit that comes before it in the natural order, so it doesn't sink below Blank
  const ids = (store.order || []).filter(id => byId.has(id));
  all.forEach((s, i) => {
    if (ids.includes(s.id)) return;
    let at = -1;
    for (let k = i - 1; k >= 0 && at < 0; k--) at = ids.indexOf(all[k].id);
    ids.splice(at + 1, 0, s.id);
  });
  return ids.map(id => ({ ...byId.get(id), hidden: hidden.has(id) }));
}
// a copy of any kit as yours, to change
export function duplicateStarter(st, taken = []) {
  const c = structuredClone(st); delete c.shipped; delete c.hidden;
  c.name = `${st.name} (copy)`; c.custom = true; c.copiedFrom = st.id;
  let id = "my-" + kitSlug(c.name), k = 2; while (taken.includes(id)) id = `my-${kitSlug(c.name)}-${k++}`;
  c.id = id; return c;
}

/* ---- editing a kit's gear in place (Ryan 2026-10-03: "Starter Kit 1 starts with two Apple TVs and a cable box —
   maybe I want to remove the cable box"). Pure: each takes the kit and changes it. ---- */
const kitIds = kit => new Set([...(kit.devices || []), ...(kit.companions || [])].map(d => d.id));
const freeKitId = (kit, base) => { const ids = kitIds(kit), b = kitSlug(base).slice(0, 24) || "box"; let id = b, n = 2; while (ids.has(id)) id = `${b}-${n++}`; return id; };
// a box out of the kit: its adapters (an encoder on a source) and every patch to either go with it
export function kitRemoveDevice(kit, devId) {
  const gone = new Set([devId, ...(kit.companions || []).filter(c => c.serves === devId).map(c => c.id)]);
  kit.devices = (kit.devices || []).filter(d => d.id !== devId);
  if (kit.companions) kit.companions = kit.companions.filter(c => !gone.has(c.id));
  if (kit.connections) kit.connections = kit.connections.filter(c => !gone.has(c.from) && !gone.has(c.to));
  return kit;
}
// one more of a box ("a second Apple TV"): the copy is patched the way the original is, adapters and all
export function kitDuplicateDevice(kit, devId) {
  const d = (kit.devices || []).find(x => x.id === devId); if (!d) return null;
  const map = new Map([[d.id, freeKitId(kit, d.id.replace(/-\d+$/, ""))]]);
  kit.devices.push({ ...structuredClone(d), id: map.get(d.id) });
  for (const c of (kit.companions || []).filter(c => c.serves === devId)) {
    const id = freeKitId(kit, c.id); map.set(c.id, id); kit.companions.push({ ...structuredClone(c), id, serves: map.get(d.id) });
  }
  const re = x => map.get(x) ?? x;
  for (const c of [...(kit.connections || [])].filter(c => map.has(c.from) || map.has(c.to))) kit.connections.push({ ...structuredClone(c), from: re(c.from), to: re(c.to) });
  return map.get(d.id);
}
// a new box from the catalog (not patched yet — the job's hookup and fixes wire it)
export function kitAddDevice(kit, { type, catalogRef, model }) {
  const id = freeKitId(kit, model || catalogRef || type);
  (kit.devices ||= []).push({ id, type, ...(catalogRef ? { catalogRef } : {}), ...(model ? { model } : {}), status: "new" });
  return id;
}
