/* ---------- library.js — the device library editor's rules (Ryan 2026-10-01) ----------
   "Make the products user-configurable: adjust inputs and outputs and their types, add new
   devices or copy one (an MDX-16 → an MDX-18)." Pure data + functions over catalog entries —
   no DOM. index.html draws the editor from LIB_SECTIONS and calls these to change entries.

   A catalog entry the app ships can be edited (it's then listed as "differs from shipped" and
   app updates leave it alone); an entry made here (new or copied) carries custom: true and is
   never touched by an update. Saved jobs keep the specs they were drawn with (catalogSnapshot)
   until the job is told to take the new ones. */

// every device type the catalog uses, as the editor names them
export const LIB_TYPES = [
  ["amp", "Multi-zone amp"], ["avr", "AV receiver"], ["source", "Source"], ["videoMatrix", "HDMI matrix"],
  ["avSwitch", "AV-over-IP switch"], ["enc", "Video encoder"], ["dec", "Video decoder"], ["balun", "HDBaseT balun"],
  ["earcExtender", "eARC extender"], ["audioInputModule", "Audio input module"], ["audioOutputModule", "Audio output module"],
  ["danteBridge", "Dante interface"], ["downmixer", "Downmixer"], ["splitter", "HDMI splitter"], ["controlBox", "Control processor"],
  ["host", "Control host"], ["networkSwitch", "Network switch"], ["avbSwitch", "AVB switch"], ["gateway", "Router / gateway"],
  ["power", "Power conditioner"], ["cable", "Cable / run"], ["accessory", "Accessory"],
];
export const typeLabel = t => (LIB_TYPES.find(x => x[0] === t) || [, t])[1];

// signal connectors, as counted on an entry's inputs / outputs
export const SIGNALS = {
  hdmi: "HDMI", analog: "Analog (stereo pair)", optical: "Optical", coax: "Coax", digitalCombo: "Digital (opt/coax combo)",
  earc: "HDMI eARC", dante: "Dante channels", sub: "Sub out", gbe: "Ethernet 1G", gbe25: "Ethernet 2.5G", gbe10: "Ethernet 10G",
  sfp: "SFP", sfpPlus: "SFP+",
};
// which connectors a type shows (an entry's own non-zero counts always show too)
const AUDIO_IN = ["analog", "optical", "coax", "digitalCombo", "dante"];
const NET = ["gbe", "gbe25", "gbe10", "sfp", "sfpPlus"];
export const TYPE_IO = {
  amp: { inputs: [...AUDIO_IN, "hdmi", "earc"], outputs: ["analog", "optical", "coax", "sub", "dante"] },
  avr: { inputs: ["hdmi", "earc", "analog", "optical", "coax"], outputs: ["hdmi", "analog", "sub", "optical"] },
  source: { inputs: [], outputs: ["hdmi", "optical", "coax", "analog"] },
  videoMatrix: { inputs: ["hdmi"], outputs: ["hdmi", "analog", "optical", "coax"] },
  avSwitch: { inputs: [], outputs: NET }, networkSwitch: { inputs: [], outputs: NET }, avbSwitch: { inputs: [], outputs: NET }, gateway: { inputs: [], outputs: NET },
  enc: { inputs: ["hdmi", "analog", "optical"], outputs: ["hdmi", "analog", "optical", "dante"] },
  dec: { inputs: ["dante"], outputs: ["hdmi", "analog", "optical"] },
  balun: { inputs: ["hdmi"], outputs: ["hdmi"] }, earcExtender: { inputs: ["hdmi", "earc"], outputs: ["hdmi"] }, splitter: { inputs: ["hdmi"], outputs: ["hdmi"] },
  audioInputModule: { inputs: ["analog", "optical", "coax"], outputs: [] }, audioOutputModule: { inputs: [], outputs: ["analog"] },
  danteBridge: { inputs: ["analog", "optical", "coax", "dante"], outputs: ["analog", "optical", "dante"] },
  downmixer: { inputs: ["hdmi", "optical", "coax"], outputs: ["analog", "optical", "coax"] },
};

// fields: [key, label, kind, help] — kind: text | num | bool | list (comma separated) | select
export const LIB_SECTIONS = [
  { title: "Identity", fields: [
    ["brand", "Brand", "text"], ["model", "Model", "text", "what the drawing, lists and quote call it"],
    ["type", "Type", "select"],
    ["partNo", "Part number", "text", "the PlanQueue SKU — the quote export uses it"],
    ["notInPlanQueue", "Not in PlanQueue", "bool", "the quote marks it for you to add there"],
    ["partNoUnsure", "Part number unconfirmed", "bool"],
    ["skuWhite", "White SKU", "text"],
    ["aliases", "Also known as", "list", "other names quick-add and imports should match"],
  ] },
  { title: "Amplification", types: ["amp", "avr"], fields: [
    ["zones", "Zones", "num", "independent rooms it can drive"], ["ampCh", "Amp channels", "num"],
    ["processing", "Processing", "text", "a receiver's channel count, e.g. 7.2 or 11.2"],
  ] },
  { title: "Platform", types: ["avSwitch", "enc", "dec", "networkSwitch"], fields: [
    ["gen", "MXNet generation", "select", "routes only to the same generation"],
    ["poeBudgetW", "PoE budget (W)", "num"],
  ] },
  { title: "Source", types: ["source"], fields: [
    ["stereoSetup", "Stereo setting", "text", "the menu path that sets the source to stereo"],
    ["provider", "Provider box", "bool", "a cable/satellite box the provider supplies"],
  ] },
  { title: "Power", types: ["power"], fields: [
    ["outlets", "Outlets", "num"], ["controlledOutlets", "Switchable outlets", "num"], ["amps", "Circuit (A)", "num"],
  ] },
  { title: "Cable", types: ["cable"], fields: [["lengthM", "Length (m)", "num"]] },
  { title: "Rack & power draw", fields: [
    ["rackUnits", "Rack units (U)", "num"], ["rackUnitsConfirm", "Height needs to be confirmed", "bool", "drawn at that height, listed in the advisor's confirm note"],
    ["halfRack", "Half-width", "bool", "two side by side on one shelf"],
    ["mount", "Mount", "select"], ["desktop", "Sits on a shelf (no rack ears)", "bool"],
    ["lan", "Ethernet jacks", "num", "ports it needs on the house network"],
    ["powerTypicalW", "Typical draw (W)", "num"], ["powerMaxW", "Max draw (W)", "num"], ["powerIdleW", "Idle draw (W)", "num"],
    ["rackNote", "Rack note", "text"],
  ] },
  { title: "Status", fields: [
    ["verified", "Specs verified", "bool", "checked against the manufacturer's datasheet"],
    ["notes", "Notes", "area"],
  ] },
];
export const SELECTS = {
  gen: [["", "—"], ["1g", "1G (V1)"], ["1g-ev2", "1G EVO II"], ["usp", "USP"], ["10g", "10G"]],
  mount: [["", "Rack"], ["vertical", "Vertical strip (0U)"]],
};

// capabilities the app acts on — a checkbox with what it changes. Every other flag is a plain tag.
export const BEHAVIOURS = [
  ["poe", "Powered over Ethernet", "needs a PoE switch port and takes no outlet (on a switch: it supplies PoE)"],
  ["mxnet", "AVPro MXNet", "MXNet gear — rides the AV-over-IP network"],
  ["dante", "Dante audio", "has a Dante jack; joins the Dante network"],
  ["avb", "Savant AVB audio", "needs an Avnu-certified AVB switch"],
  ["eARC", "HDMI eARC", "can return the TV's audio over HDMI"],
  ["atmosDecode", "Decodes surround / Atmos", "treated like a receiver in the audio chain"],
  ["downmix2ch", "Audio outs mix down to stereo", "its analog/optical outs always carry 2-channel — sources can stay on Auto"],
  ["pcmOnlyDigital", "Digital ins are PCM only", "bitstream (Dolby/DTS) mutes — sources feeding it need stereo"],
  ["pcmOnly2ch", "Takes 2-channel PCM only", "anything else mutes"],
  ["ultimo", "Dante Ultimo chip", "fixed 4×4 Dante, PCM only"],
  ["controlLanOnly", "Ethernet is control only", "no audio over its network jack"],
  ["danteController", "Dante controller", "manages the Dante network"],
  ["hdbasetOut", "Outputs are HDBaseT", "powers the far-end receiver — the job quotes the receiver only, no rack outlet"],
  ["sonos", "Sonos", "Sonos network and lip-sync advice applies"],
  ["twentyAmp", "Needs a 20 A circuit", ""],
  ["wattboxPick", "Advisor may pick it", "a candidate when the advisor sizes a WattBox"],
  ["legacy", "Legacy", "never auto-picked; kept for existing jobs"],
];
const BEHAVIOUR_SET = new Set(BEHAVIOURS.map(b => b[0]));
export const tagsOf = e => (e.flags || []).filter(f => !BEHAVIOUR_SET.has(f));

// a catalog id from brand + model, unique in the catalog
export function newId(devices, brand, model) {
  const slug = `${brand || ""} ${model || "device"}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "device";
  let id = slug, k = 2;
  while (devices[id]) id = `${slug}-${k++}`;
  return id;
}

// a blank device of a type, ready to fill in
export function blankDevice(type = "amp") {
  return { brand: "", model: "New device", type, inputs: {}, outputs: {}, flags: [], verified: false,
    partNo: "", notInPlanQueue: true, notes: "", custom: true };
}

// copy an entry: the copy is yours (custom), unverified, with no part number until you give it one
export function duplicateDevice(devices, id, today = new Date().toISOString().slice(0, 10)) {
  const src = devices[id]; if (!src) return null;
  const e = structuredClone(src);
  e.model = `${src.model} (copy)`;
  e.custom = true; e.copiedFrom = id; e.verified = false;
  e.partNo = ""; e.notInPlanQueue = true; delete e.partNoUnsure; delete e.skuWhite; delete e.pqSkuWhite; delete e.aliases; delete e.match;
  e.notes = `Copied from ${src.brand || ""} ${src.model} on ${today} — the notes below are about that model.${src.notes ? " " + src.notes : ""}`;
  const nid = newId(devices, src.brand, e.model);
  return { id: nid, entry: e };
}

// what doesn't add up on an entry — shown above its form
export function checkEntry(e) {
  const w = [];
  if (!String(e.brand || "").trim()) w.push("No brand.");
  if (!String(e.model || "").trim()) w.push("No model name.");
  if (!LIB_TYPES.some(t => t[0] === e.type)) w.push(`Unknown type "${e.type}".`);
  if (!e.partNo && !e.notInPlanQueue) w.push("No part number — the quote marks it unsure.");
  for (const side of ["inputs", "outputs"]) for (const [k, v] of Object.entries(e[side] || {}))
    if (typeof v !== "number" || v < 0 || !Number.isFinite(v)) w.push(`${side === "inputs" ? "Input" : "Output"} count for ${SIGNALS[k] || k} isn't a number of jacks.`);
  if (e.type === "amp" && e.zones && e.ampCh && e.ampCh < e.zones * 2) w.push(`${e.zones} zones need at least ${e.zones * 2} amp channels for stereo; it has ${e.ampCh}.`);
  if (Array.isArray(e.ports) && e.ports.length) {
    const count = (dir, conn) => e.ports.filter(p => p.dir === dir && p.conn === conn).length;
    for (const [side, dir] of [["inputs", "in"], ["outputs", "out"]]) for (const [k, v] of Object.entries(e[side] || {})) {
      if (!["hdmi", "analog", "optical", "coax"].includes(k)) continue;
      const n = count(dir, k);
      if (n !== v) w.push(`Jack list has ${n} ${SIGNALS[k]} ${dir === "in" ? "input" : "output"}${n === 1 ? "" : "s"}, the count says ${v} — use the counts instead.`);
    }
  }
  return w;
}

// (a jack list that no longer matches the counts is simply dropped: ports.js derives one from the
// counts for any entry without an audited list)

/* ---- the library file: your custom devices and your edits to shipped ones, to carry between
        browsers (Mac ↔ iPad) or keep as a backup. Shipped entries you never touched stay out. ---- */
export function exportLibrary(devices, shipped, stableStr, today = new Date().toISOString().slice(0, 10), starters = null) {
  const out = {};
  for (const [id, e] of Object.entries(devices || {}))
    if (e.custom || !shipped[id] || stableStr(shipped[id]) !== stableStr(e)) out[id] = e;
  const file = { kind: "signalpath-library", version: 1, exported: today, devices: out };
  // your starter kits travel with it (with the order and hidden list of the kit picker)
  if (starters && (Object.keys(starters.mine || {}).length || (starters.order || []).length || (starters.hidden || []).length))
    file.starters = { mine: starters.mine || {}, order: starters.order || [], hidden: starters.hidden || [] };
  return file;
}
// the kit store (SETTINGS.starters) as it should be — kits by id, an order list, a hidden list — whatever
// a bad import or a hand edit left there (hardening pass 2026-10-02); fixes it in place
export function tidyStarterStore(st) {
  if (!st || typeof st !== "object") return { mine: {}, order: [], hidden: [] };
  const plain = v => v && typeof v === "object" && !Array.isArray(v);
  if (!plain(st.mine)) st.mine = {};
  for (const [id, k] of Object.entries(st.mine)) if (!plain(k) || !Array.isArray(k.devices)) delete st.mine[id]; else k.id = id;
  for (const key of ["order", "hidden"]) st[key] = Array.isArray(st[key]) ? st[key].filter(x => typeof x === "string") : [];
  return st;
}
// what importing a library file would do (added / updated / unchanged), and doing it
export function planImport(devices, file, stableStr, starters = null) {
  if (!file || file.kind !== "signalpath-library" || !file.devices || typeof file.devices !== "object" || Array.isArray(file.devices)) throw new Error("That isn't a SignalPath library file.");
  const plan = { added: [], updated: [], same: [], kitsAdded: [], kitsUpdated: [] };
  for (const [id, e] of Object.entries(file.devices)) {
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !e || typeof e !== "object") continue;
    if (!devices[id]) plan.added.push(id); else if (stableStr(devices[id]) !== stableStr(e)) plan.updated.push(id); else plan.same.push(id);
  }
  const mine = starters?.mine || {};
  const theirs = file.starters?.mine;
  for (const [id, k] of Object.entries(theirs && typeof theirs === "object" && !Array.isArray(theirs) ? theirs : {})) {
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !k || typeof k !== "object" || !Array.isArray(k.devices)) continue;
    if (!mine[id]) plan.kitsAdded.push(id); else if (stableStr(mine[id]) !== stableStr(k)) plan.kitsUpdated.push(id);
  }
  return plan;
}
// starters (optional): SETTINGS.starters — kits are added or replaced; new ones join the end of the order
export function applyImport(devices, file, plan, starters = null) {
  for (const id of [...plan.added, ...plan.updated]) devices[id] = structuredClone(file.devices[id]);
  if (starters) {
    tidyStarterStore(starters);
    for (const id of [...(plan.kitsAdded || []), ...(plan.kitsUpdated || [])]) starters.mine[id] = structuredClone(file.starters.mine[id]);
    for (const id of plan.kitsAdded || []) if (!starters.order.includes(id)) starters.order.push(id);
  }
  return devices;
}
