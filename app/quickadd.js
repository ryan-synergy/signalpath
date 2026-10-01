/* SignalPath quick-add — shorthand/dictation zone entry (UX mock: type or
   speak "family room 5.1 75 sony matrix", see parse-preview chips, commit).
   Pure parser, no DOM. Comma / "then" / newline separates multiple zones. */

import { SPEAKER_SETUP, SCOPE_NAME } from "./names.js";

const uid = p => p + "-" + Math.random().toString(36).slice(2, 7);
const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || uid("z");

const BRANDS = ["sony", "samsung", "lg", "tcl", "vizio", "hisense", "panasonic", "sharp", "seura", "sunbrite", "c-seed"];
const BRAND_LABEL = { lg: "LG", tcl: "TCL", "c-seed": "C SEED" };
// "#101" or "unit 4" is a room NUMBER, never a TV size. Words like suite/room
// stay ambiguous on purpose — "family room 75" and "primary suite 85" are the
// core dictation phrases — so a numbered suite is typed "suite #101".
const NUMBERED_ROOM = /\b(unit|apt|apartment)\s+(\d{1,4})(?![\d.])/;
const CONFIGS = {
  "mono": "mono", "2.0": "stereo", "stereo": "stereo", "2.1": "2.1",
  "5.1": "surround-5.1", "5.1.2": "surround-5.1", "7.1": "surround-7.1", "7.1.4": "surround-7.1.4",
  "soundbar": "soundbar", "sb": "soundbar", "soundbar-sub": "soundbar-sub", "sb-sub": "soundbar-sub",
  "landscape": "landscape",
};
// spoken forms → canonical tokens (dictation says "five one" / "five point one")
const SPOKEN = [
  [/\bfive\s*(point\s*)?one\s*(point\s*)?two\b/g, "5.1.2"],
  [/\bseven\s*(point\s*)?one\s*(point\s*)?four\b/g, "7.1.4"],
  [/\bfive\s*(point\s*)?one\b/g, "5.1"],
  [/\bseven\s*(point\s*)?one\b/g, "7.1"],
  [/\btwo\s*(point\s*)?one\b/g, "2.1"],
  [/\btwo\s*(point\s*)?(oh|zero)\b/g, "2.0"],
  [/\bsound\s+bar(\s*(and|\+|with)?\s*sub)?\b/g, (m, sub) => sub ? "soundbar-sub" : "soundbar"],
];

export function parseQuickZone(text) {
  let t = " " + String(text || "").toLowerCase().trim() + " ";
  for (const [re, sub] of SPOKEN) t = t.replace(re, (...m) => " " + (typeof sub === "function" ? sub(...m) : sub) + " ");
  // protect a numbered room name from the TV-size reader: "suite 101" → "suite #101"
  t = t.replace(NUMBERED_ROOM, (m, w, n) => `${w} #${n}`);
  const chips = [];
  const zone = { scope: "included" };
  let spk = null, tv = null, ofe = false, local = false, matrix = false, avr = false;

  const eat = re => { const m = t.match(re); if (m) t = t.replace(re, " "); return m; };

  if (eat(/\bprewire(d)?\b|\bpre-wire(d)?\b/)) { zone.scope = "prewire"; chips.push({ kind: "scope", label: SCOPE_NAME.prewire }); }
  if (eat(/\bfuture\b/)) { zone.scope = "future"; chips.push({ kind: "scope", label: SCOPE_NAME.future }); }
  if (eat(/\bofe\b|\bexisting\b|\bowner\b(?!'s|s\b)/)) ofe = true;   // "owner's suite" is a room, not OFE
  if (eat(/\blocal\b/)) local = true;
  if (eat(/\bmatrix\b|\bdistributed\b/)) matrix = true;
  // "avr" / "receiver": one AV receiver drives this zone's TV and speakers
  if (eat(/\bav\s?rs?\b|\breceiver\b/)) avr = true;
  // "bullet" / "bullet train": the TV's run is an AVPro Bullet Train fiber HDMI
  let bullet = false;
  if (eat(/\bbullet(?:\s*train)?\b|\baoc\b|\bfiber hdmi\b/)) bullet = true;
  // rough distance to the rack: "far" (a pool house), "short run"; or "120ft"
  const ftm = eat(/\b(\d{2,4})\s*(?:ft|feet|')(?:\s+run)?(?=\s|,|$)/);
  if (ftm) zone.runFt = +ftm[1];
  else if (eat(/\bfar(?:\s+run)?\b|\blong\s+run\b/)) zone.reach = "far";
  else if (eat(/\bshort\s+run\b|\bclose\s+to\s+the\s+rack\b/)) zone.reach = "short";
  // "dante": sound over Dante (AXIS2 / Dante decoder at the TV → a Director);
  // "director": a surround set on a Director instead of a Hyperion
  let dante = false, director = false;
  if (eat(/\bdante\b/)) dante = true;
  if (eat(/\bdirector\b/)) { director = true; dante = true; }

  // room remote: "savant remote", "atv remote", "josh remote", "factory remote"
  const rm = eat(/\b(savant|josh|apple\s*tv|appletv|atv|apple|factory|oem)\s+remote\b/);
  if (rm) {
    const k = rm[1].replace(/\s+/g, "");
    zone.remote = k === "savant" ? "savant" : k === "josh" ? "josh" : (k === "factory" || k === "oem") ? "factory" : "appletv";
    chips.push({ kind: "hint", label: (zone.remote === "appletv" ? "Apple TV" : zone.remote === "factory" ? "factory" : zone.remote) + " remote" });
  }
  const noTv = !!eat(/\bno\s*tv\b|\baudio\s*only\b/);

  // landscape with optional sat count: "landscape 8" / "landscape"
  const land = eat(/\blandscape\s*(\d{1,2})?\b/);
  if (land) { spk = { config: "landscape", satCount: land[1] ? +land[1] : 6, buriedSub: true }; }

  // explicit configs
  if (!spk) for (const [tok, cfg] of Object.entries(CONFIGS)) {
    if (tok === "landscape") continue;
    const re = new RegExp(`(^|\\s)${tok.replace(/\./g, "\\.")}(\\s|$)`);
    if (re.test(t)) { t = t.replace(re, " "); spk = { config: cfg }; break; }
  }
  // "N speakers" / "pair"
  if (!spk) {
    const pairs = eat(/\b(\d{1,2})\s*(x\s*)?pairs?\b/);
    const m = pairs ? [null, String(+pairs[1] * 2)]
      : eat(/\b(\d{1,2})\s*(x\s*)?(speakers?|spk)\b/) || (eat(/\bpair\b/) && [null, "2"]);
    if (m) spk = { config: "stereo", count: +m[1] || 2 };
  }

  // projector: "projector 120"
  const proj = eat(/\bprojector\s*(\d{2,3})?\b|\bproj\s*(\d{2,3})?\b/);
  // brand
  let brand = "";
  for (const b of BRANDS) { const re = new RegExp(`\\b${b}\\b`); if (re.test(t)) { t = t.replace(re, " "); brand = BRAND_LABEL[b] || b[0].toUpperCase() + b.slice(1); break; } }
  // TV size: standalone 32–229 number (after configs consumed), with an optional
  // inch suffix ("75in", "75\"", "75 inch")
  const size = eat(/(?<![#\d])\b(3[2-9]|[4-9]\d|1\d\d|2[0-2]\d)(?:\s*(?:in|inch|inches|"))?(?![\d.])/);
  if (proj) tv = { displayType: "projector", size: +(proj[1] || proj[2] || size?.[1] || 120) };
  else if (!noTv && (size || brand || eat(/\btv\b/))) tv = { displayType: "tv", size: size ? +size[1] : null, brand };
  if (tv && brand && !tv.brand) tv.brand = brand;

  // leftover words = zone name
  const name = t.replace(/#(\d)/g, "$1").replace(/\s+/g, " ").trim().split(" ")
    .filter(w => w && !/^(the|a|an|with|and|in|room)$/.test(w) || w === "room")
    .map(w => w[0] ? w[0].toUpperCase() + w.slice(1) : w).join(" ").trim() || "New Zone";
  zone.name = name;
  zone.id = "z-" + slug(name);
  zone.endpoints = [];
  chips.unshift({ kind: "name", label: name });

  if (spk) {
    // pre-wire is the ZONE's scope, not a speaker status — tagging the endpoint
    // left it filed under PRE-WIRE after the zone was later switched to included
    const ep = { id: zone.id + "-spk", type: "speakers", ...spk, status: ofe ? "ofe" : "new" };
    if (ep.config === "stereo" && !ep.count) ep.count = 2;
    zone.endpoints.push(ep);
    // chip words match the editor's (names.js); landscape adds its count
    const cfgLabel = ep.config === "landscape" ? `Landscape ${ep.satCount}+1` : SPEAKER_SETUP[ep.config] || ep.config;
    chips.push({ kind: "spk", label: cfgLabel + (ofe ? " · OFE" : "") });
  }
  if (tv) {
    const ep = { id: zone.id + "-tv", type: "display", displayType: tv.displayType, brand: tv.brand || "",
      size: tv.size || 65, status: ofe ? "ofe" : "new" };
    if (!tv.size) ep.confirm = ["size"];
    zone.endpoints.push(ep);
    chips.push({ kind: "tv", label: `${tv.brand || (tv.displayType === "projector" ? "Projector" : "TV")} ${ep.size}"${ep.confirm ? " ?" : ""}${ofe ? " · OFE" : ""}` });
  }
  if (local && tv) chips.push({ kind: "hint", label: "TV fed by a source in the zone" });
  if (matrix && tv) chips.push({ kind: "hint", label: "TV fed from the rack" });
  if (avr) chips.push({ kind: "hint", label: tv && spk ? "AV receiver feeds the TV + speakers" : tv ? "AV receiver feeds the TV" : "AV receiver feeds the speakers" });
  if (dante) chips.push({ kind: "hint", label: director ? "Dante → Director amp" : "sound over Dante" });
  if (bullet && tv) chips.push({ kind: "hint", label: "Bullet Train fiber HDMI to the TV" });
  if (zone.reach || zone.runFt) chips.push({ kind: "hint", label: zone.runFt ? `${zone.runFt} ft from the rack` : `${zone.reach} from the rack` });
  zone._hints = { local, matrix, avr, dante, director, bullet };
  // a room with no speakers and no TV has nothing to draw — say so before Add skips it
  if (!zone.endpoints.length) chips.push({ kind: "warn", label: "nothing to add — give it a setup or a TV size" });
  return { zone, chips, empty: !zone.endpoints.length };
}

export function parseQuick(text) {
  return String(text || "").split(/,|\bthen\b|\n/).map(s => s.trim()).filter(Boolean).map(parseQuickZone);
}

/* a room back as quick-add text (starter kits keep their starting rooms this way — readable,
   editable, and re-added through the same parser + hookup as a typed line). How the room is fed
   is read from the solution: a receiver → "avr", a rack video feed → "matrix", an in-room
   source → "local", Dante audio → "dante". */
export function zoneToQuick(zone, sol = {}) {
  const eps = zone.endpoints || [], spk = eps.find(e => e.type === "speakers"), tv = eps.find(e => e.type === "display");
  const conns = sol.connections || [], comps = sol.companions || [];
  const rackDev = id => (sol.racks || []).flatMap(r => r.devices || []).find(d => d.id === id);
  const feedOf = ep => { if (!ep) return null;
    let c = conns.find(c => c.to === ep.id && (c.signal === "video" || c.signal === "speaker"));
    if (c && comps.some(k => k.id === c.from)) c = conns.find(k => k.to === c.from && k.signal === "video") || c;
    return c ? { dev: rackDev(c.from), local: (sol.localDevices || []).some(d => d.id === c.from), bullet: c.run === "bullet" } : null; };
  const words = [zone.name || "room"];
  if ((zone.scope || "included") === "prewire") words.push("prewire");
  if (zone.scope === "future") words.push("future");
  if (eps.some(e => e.status === "ofe")) words.push("ofe");
  if (spk) {
    const cfg = spk.config || "stereo";
    if (cfg === "landscape") words.push(`landscape ${spk.satCount || 6}`);
    else if (cfg === "stereo") words.push(spk.count && spk.count !== 2 ? `${spk.count} speakers` : "stereo");
    else words.push({ "surround-5.1": "5.1", "surround-7.1": "7.1", "surround-7.1.4": "7.1.4" }[cfg] || cfg);
  }
  if (tv) {
    if (tv.displayType === "projector") words.push(`projector ${tv.size || ""}`.trim());
    // a size, else the brand (a brand alone means a TV), else the word "tv" — "tv" beside a brand stays in the name
    else { const sized = tv.size && !tv.confirm?.includes("size"); if (sized) words.push(String(tv.size));
      if (tv.brand) words.push(tv.brand.toLowerCase()); else if (!sized) words.push("tv"); }
  } else if (spk) words.push("no tv");
  const tf = feedOf(tv), sf = feedOf(spk);
  // "avr" only when the receiver feeds the TV itself (the pass-through option); a surround room whose
  // TV comes off the rack with a receiver beside it is Synergy's separate-feeds default → "matrix"
  if (tf?.dev?.type === "avr" || (!tv && sf?.dev?.type === "avr")) words.push("avr");
  else if (tf?.local || (tv && (sol.localDevices || []).some(d => d.zone === zone.id && d.type === "source"))) words.push("local");
  else if (tf?.dev) words.push("matrix");
  if (conns.some(c => c.dante && (c.from.startsWith(zone.id) || comps.some(k => k.id === c.from && eps.some(e => e.id === k.serves))))) words.push("dante");
  if (tf?.bullet) words.push("bullet");
  if (zone.runFt) words.push(`${zone.runFt}ft`); else if (zone.reach === "far") words.push("far"); else if (zone.reach === "short") words.push("short run");
  if (zone.remote) words.push({ savant: "savant remote", josh: "josh remote", appletv: "atv remote", factory: "factory remote" }[zone.remote] || "");
  return words.filter(Boolean).join(" ");
}
