/* ---------- starters.js — rack starting points for a new job ----------
   Most jobs start from one of a handful of racks. A starter fills the rack
   with its gear (linked to the catalog, named by product) and the patching
   inside the rack; zones then come from quick-add ("family room 5.1 75
   matrix", "theater 7.1 85 avr"), which wires them to this gear.
   Pure data + one function over the raw job — no DOM. */

import { productName } from "./names.js";

const dev = (id, type, catalogRef, model, extra = {}) => ({ id, type, catalogRef, model, status: "new", ...extra });
const src = (id, model) => ({ id, type: "source", model, status: "new" });
const v = (from, to) => ({ from, to, signal: "video" });

export const STARTERS = [
  {
    id: "savant-whole-home",
    name: "Savant whole-home",
    blurb: "HDMI matrix to the TVs, Savant AVB audio into a multi-zone amp.",
    tip: "family room 5.1 75 sony matrix, kitchen stereo, patio landscape 8",
    solution: { platforms: ["savant"], audioNetwork: "avb" },
    devices: [
      src("cablebox", "Cable Box"), src("atv", "Apple TV"),
      dev("music", "source", "savant-pav-sms2001"),
      dev("matrix", "videoMatrix", "avpro-ac-mx-88"),
      dev("sav-in", "audioInputModule", "savant-avb-input-module"),
      dev("sav-out", "audioOutputModule", "savant-avb-output-module"),
      { id: "avb", type: "avbSwitch", model: "AVB switch (Avnu-certified)", status: "new" },
      dev("amp", "amp", "anthem-mdx-16", null, { zones: 8 }),
      dev("power", "power", "wattbox-800-ipvm-12"),
    ],
    connections: [v("cablebox", "matrix"), v("atv", "matrix"),
      // the music server joins the Savant AVB network itself (Ryan 2026-09-30) — it's digital-only,
      // so never into the analog input module; outside a Savant audio system it goes optical into the amp
      { from: "avb", to: "music", signal: "network" },
      { from: "avb", to: "sav-in", signal: "network" }, { from: "avb", to: "sav-out", signal: "network" },
      { from: "sav-out", to: "amp", signal: "audio" }],
  },
  {
    id: "theater-receiver",
    name: "Theater receiver",
    blurb: "One AV receiver drives the theater's TV and surround speakers.",
    tip: "theater 7.1 85 sony avr",
    devices: [src("cablebox", "Cable Box"), src("atv", "Apple TV"), dev("avr", "avr", "anthem-mrx-740-8k"),
      dev("power", "power", "wattbox-800-ipvm-6")],
    connections: [v("cablebox", "avr"), v("atv", "avr")],
  },
  {
    id: "mxnet",
    name: "AV-over-IP (MXNet)",
    blurb: "Sources on MXNet encoders into a switch; decoders at each TV.",
    tip: "family room 5.1 75 sony matrix, master bed stereo 65 matrix",
    devices: [
      src("atv1", "Apple TV 1"), src("atv2", "Apple TV 2"), src("cablebox", "Cable Box"),
      dev("sw", "avSwitch", "avpro-mxnet-sw12"),
      dev("cbx", "controlBox", "avpro-mxnet-cbox-ha"),
      dev("amp", "amp", "anthem-mdx-16", null, { zones: 8 }),
      dev("power", "power", "wattbox-800-ipvm-12"),
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
    id: "dante-director",
    name: "Dante (Director amps)",
    blurb: "MXNet video + Dante audio: Director amps, Dante decoders (DANTE-DV2) at MXNet TVs, AXIS2/AXIS16 elsewhere, Dante CBOX + its own switch.",
    tip: "kitchen stereo 55 matrix, family room 5.1 75 matrix, office stereo 43 matrix, theater 7.1 85 matrix",
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
      dev("power", "power", "wattbox-800-ipvm-12"),
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
    id: "blank",
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
  const rack = (sol.racks ||= [])[0] || (sol.racks[0] = { id: "rack-main", name: "Equipment Rack", devices: [] });
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
