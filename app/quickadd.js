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

// spelled-out numbers ("sixty five inch", "landscape eight", "four speakers") → digits.
// Runs after SPOKEN, so "five one" / "seven one four" are already speaker setups.
const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function wordsToDigits(t) {
  const W = `(?:${[...Object.keys(TENS), ...Object.keys(ONES)].join("|")})`;
  // "one hundred (and) twenty", "a hundred", "one twenty" (a projector screen) are rare; handle hundreds plainly
  t = t.replace(new RegExp(`\\b(?:a|one)\\s+hundred(?:\\s+and)?(?:\\s+(${W})(?:[\\s-]+(${W}))?)?\\b`, "g"), (m, a, b) =>
    String(100 + (TENS[a] ?? ONES[a] ?? 0) + (b ? ONES[b] ?? 0 : 0)));
  // "one twenty" / "one ten" — how a projector screen is said out loud
  t = t.replace(new RegExp(`\\bone\\s+(ten|${Object.keys(TENS).join("|")})\\b`, "g"), (m, a) => String(100 + (a === "ten" ? 10 : TENS[a])));
  t = t.replace(new RegExp(`\\b(${Object.keys(TENS).join("|")})(?:[\\s-]+(${Object.keys(ONES).filter(k => ONES[k] && ONES[k] < 10).join("|")}))?\\b`, "g"),
    (m, a, b) => String(TENS[a] + (b ? ONES[b] : 0)));
  return t.replace(new RegExp(`\\b(${Object.keys(ONES).join("|")})\\b`, "g"), (m, a) => String(ONES[a]));
}
// the ways people say a speaker setup or a TV size that the readers below don't (Ryan 2026-10-02:
// "65 inch" and "two channel" must just work)
const PHRASES = [
  [/\b(\d{2,3})\s*-?\s*(?:inches|inch|in\.|in(?=\s|$)|''|"|”)(?=[\s,]|$)/g, (m, n) => n],    // 65 inch / 65-inch / 65 in. / 65"
  [/\b(?:2|two)[\s-]*(?:channel|ch)\b/g, "2.0"], [/\b(?:5|five)[\s-]*(?:channel|ch)\b/g, "5.1"],
  [/\b(?:7|seven)[\s-]*(?:channel|ch)\b/g, "7.1"], [/\b2\s*ch\b/g, "2.0"],
  [/\bstereo\s+pair\b/g, "stereo"], [/\b(?:dolby\s+)?atmos\b/g, "7.1.4"], [/\b7\.2\.4\b/g, "7.1.4"], [/\b5\.2\b/g, "5.1"], [/\b7\.2\b/g, "7.1"],
  [/\b(?:surround(?:\s+sound)?)\b/g, "__surround"],
  [/\btv\s+only\b/g, "tv"],
  [/\b(\d{1,2})\s+(?:(?:in-?)?ceiling|in-?wall|wall|outdoor|rock|bookshelf)\s+(speakers?)\b/g, (m, n, w) => `${n} ${w}`],
];

// words a sentence wraps around a room that aren't its name (Wispr Flow / dictation writes full sentences)
const FILLER = new Set(["the", "a", "an", "with", "and", "in", "on", "of", "has", "have", "had", "is", "are", "was", "will", "be", "gets", "get",
  "wants", "want", "needs", "need", "would", "like", "also", "plus", "only", "just", "audio", "sound", "speakers", "speaker", "system",
  "it", "its", "it's", "there", "that", "which", "for", "to", "some", "set", "setup", "up", "we", "they", "i", "it'll", "going", "goes", "using", "use"]);

export function parseQuickZone(text) {
  let t = " " + String(text || "").toLowerCase().trim() + " ";
  for (const [re, sub] of SPOKEN) t = t.replace(re, (...m) => " " + (typeof sub === "function" ? sub(...m) : sub) + " ");
  t = wordsToDigits(t);
  for (const [re, sub] of PHRASES) t = t.replace(re, m => " " + m.replace(re, sub) + " ");
  // a bare "surround" is a 5.1 unless a setup was also given ("surround 7.1")
  t = /(^|\s)(5\.1|5\.1\.2|7\.1|7\.1\.4)(\s|$)/.test(t) ? t.replace(/__surround/g, " ") : t.replace(/__surround/, " 5.1 ").replace(/__surround/g, " ");
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
  // "apps": the TV plays its own apps — no feed from the rack (a whole-home rack feeds every other TV)
  let apps = false;
  if (eat(/\b(?:tv\s+)?apps\b|\bsmart\s*tv\b/)) apps = true;
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
  eat(/\bno\s+speakers?\b|\bvideo\s+only\b/);              // said on purpose: a TV-only room (the suggestions stop asking)

  // landscape with optional sat count: "landscape 8" / "landscape"
  const land = eat(/\blandscape\s*(\d{1,2})?\b/);
  if (land) {
    // "landscape with eight speakers" — the count can come later in the sentence
    const n = land[1] || eat(/\b(\d{1,2})\s*(?:x\s*)?(?:speakers?|satellites?|sats?)\b/)?.[1];
    spk = { config: "landscape", satCount: n ? +n : 6, buriedSub: true };
  }

  // explicit configs
  if (!spk) for (const [tok, cfg] of Object.entries(CONFIGS)) {
    if (tok === "landscape") continue;
    const re = new RegExp(`(^|\\s)${tok.replace(/\./g, "\\.")}(\\s|$)`);
    if (re.test(t)) { t = t.replace(re, " "); spk = { config: cfg }; break; }
  }
  // the setup said twice ("two-channel stereo", "7.1.4 Atmos", "5.1 surround") — the rest is not a name
  if (spk) { t = t.replace(/(^|\s)(\d\.\d(?:\.\d)?)(?=\s|$)/g, " "); eat(/\bstereo\b/); }
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
  else { const saidTv = !!eat(/\btv\b/);   // "tv" is never part of the room's name ("65 inch tv")
    if (!noTv && (size || brand || saidTv)) tv = { displayType: "tv", size: size ? +size[1] : null, brand }; }
  if (tv && brand && !tv.brand) tv.brand = brand;

  // leftover words = zone name (dictation's grammar — "the kitchen is stereo only", "has a",
  // "with a pair of speakers" — never becomes part of it)
  // a setup SignalPath doesn't have ("3.1") is flagged, never part of the name
  let oddSetup = null;
  t = t.replace(/(^|\s)(\d\.\d(?:\.\d)?)(?=\s|$)/g, (m, sp, x) => { oddSetup = x; return " "; });
  const words = t.replace(/#(\d)/g, (m, d) => d).replace(/[.,;:!?–—"“”()]/g, " ").replace(/\s+/g, " ").trim().split(" ")
    .filter(w => w && !FILLER.has(w));
  const name = words.map(w => w[0] ? w[0].toUpperCase() + w.slice(1) : w).join(" ").trim() || "New Zone";
  zone.name = name;
  const named = words.length > 0;
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
    const cfgLabel = ep.config === "landscape" ? `Landscape ${ep.satCount}+1` : ep.config === "stereo" && ep.count && ep.count !== 2 ? `${ep.count} speakers` : SPEAKER_SETUP[ep.config] || ep.config;
    chips.push({ kind: "spk", label: cfgLabel + (ofe ? " · OFE" : "") });
  }
  if (tv) {
    const ep = { id: zone.id + "-tv", type: "display", displayType: tv.displayType, brand: tv.brand || "",
      size: tv.size || 65, status: ofe ? "ofe" : "new" };
    if (!tv.size) ep.confirm = ["size"];
    if (apps && !local) ep.ownApps = true;                 // remembered: no rack feed on purpose (not an unwired TV)
    zone.endpoints.push(ep);
    chips.push({ kind: "tv", label: `${tv.brand || (tv.displayType === "projector" ? "Projector" : "TV")} ${ep.size}"${ep.confirm ? " ?" : ""}${ofe ? " · OFE" : ""}` });
  }
  if (local && tv) chips.push({ kind: "hint", label: "TV fed by a source in the zone" });
  if (matrix && tv) chips.push({ kind: "hint", label: "TV fed from the rack" });
  if (apps && tv) chips.push({ kind: "hint", label: "TV plays its own apps — no rack feed" });
  if (avr) chips.push({ kind: "hint", label: tv && spk ? "AV receiver feeds the TV + speakers" : tv ? "AV receiver feeds the TV" : "AV receiver feeds the speakers" });
  if (dante) chips.push({ kind: "hint", label: director ? "Dante → Director amp" : "sound over Dante" });
  if (bullet && tv) chips.push({ kind: "hint", label: "Bullet Train fiber HDMI to the TV" });
  if (zone.reach || zone.runFt) chips.push({ kind: "hint", label: zone.runFt ? `${zone.runFt} ft from the rack` : `${zone.reach} from the rack` });
  zone._hints = { local, matrix, apps, avr, dante, director, bullet };
  if (oddSetup && !spk) chips.push({ kind: "warn", label: `${oddSetup} isn't a setup here — pick stereo, 5.1, 7.1 or 7.1.4` });
  // a room with no speakers and no TV has nothing to draw — say so before Add skips it
  if (!zone.endpoints.length) chips.push({ kind: "warn", label: "nothing to add — give it a setup or a TV size" });
  return { zone, chips, empty: !zone.endpoints.length, named };
}

/* what the room being typed still needs, as tappable suggestions (Ryan 2026-10-02: "select the
   bubbles to confirm instead of typing it all out"). Each item's `add` is appended to the text. */
export function quickSuggest(text) {
  // a trailing comma / period / "then" means the last room is done — nothing to suggest yet
  if (/([,;\n]|\.|\bthen|\bnext)\s*$/i.test(String(text || "")) && !/\d\.\s*$/.test(String(text || ""))) return null;
  const segs = roomTexts(text);
  const last = segs[segs.length - 1];
  if (!last || !last.trim()) return null;
  const p = parseQuickZone(last), low = " " + last.toLowerCase() + " ";
  const has = type => p.zone.endpoints.some(e => e.type === type);
  const out = { room: p.zone.name, groups: [] };
  if (!has("speakers") && !/\bno\s+speakers?\b|\bvideo\s+only\b/.test(low))
    out.groups.push({ label: "Speakers", items: [["Stereo", "stereo"], ["5.1", "5.1"], ["7.1", "7.1"], ["Atmos", "7.1.4"], ["Soundbar", "soundbar"], ["Landscape", "landscape"], ["No speakers", "no speakers"]] });
  if (!has("display") && !/\bno\s*tv\b|\baudio\s*only\b/.test(low))
    out.groups.push({ label: "TV", items: [["55″", "55"], ["65″", "65"], ["75″", "75"], ["85″", "85"], ["Projector", "projector"], ["No TV", "no tv"]] });
  if (p.zone.endpoints.length) out.groups.push({ label: "", items: [["＋ Next room", ", "]], next: true });
  return out.groups.length ? out : null;
}

/* a line → one text per room. Clauses split at commas, sentence ends, semicolons, new lines and
   "then"/"next"; a clause that names no room ("65-inch TV", "two-channel stereo", "with a 65")
   belongs to the room before it — so "Master bedroom, 65-inch TV, two-channel stereo." is one room. */
export function roomTexts(text) {
  const clauses = String(text || "")
    .replace(/(\d)\.(\d)/g, (m, a, b) => `${a}\u2024${b}`)                           // keep 5.1 / 7.1.4 whole while sentences split
    .split(/[,;\n]|\.(?=\s|$)|\bthen\b|\bnext\b/i)
    .map(x => x.replace(/\u2024/g, ".").replace(/^\s*(and|also|plus)\b/i, "").trim()).filter(Boolean);
  const rooms = [];
  for (const c of clauses) {
    const named = parseQuickZone(c).named;
    if (!named && rooms.length) rooms[rooms.length - 1] += " " + c;
    else rooms.push(c);
  }
  return rooms;
}

export function parseQuick(text) {
  return roomTexts(text).map(parseQuickZone);
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
  else if (tv && !tf && (tv.ownApps || (sol.racks || []).some(r => (r.devices || []).some(d => d.type === "videoMatrix" || d.type === "avSwitch")))) words.push("apps");   // left off the rack on purpose
  if (conns.some(c => c.dante && (c.from.startsWith(zone.id) || comps.some(k => k.id === c.from && eps.some(e => e.id === k.serves))))) words.push("dante");
  if (tf?.bullet) words.push("bullet");
  if (zone.runFt) words.push(`${zone.runFt}ft`); else if (zone.reach === "far") words.push("far"); else if (zone.reach === "short") words.push("short run");
  if (zone.remote) words.push({ savant: "savant remote", josh: "josh remote", appletv: "atv remote", factory: "factory remote" }[zone.remote] || "");
  return words.filter(Boolean).join(" ");
}
