/* SignalPath quick-add — shorthand/dictation zone entry (UX mock: type or
   speak "family room 5.1 75 sony matrix", see parse-preview chips, commit).
   Pure parser, no DOM. Comma / "then" / newline separates multiple zones. */

const uid = p => p + "-" + Math.random().toString(36).slice(2, 7);
const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || uid("z");

const BRANDS = ["sony", "samsung", "lg", "tcl", "vizio", "hisense", "panasonic", "sharp", "seura", "sunbrite", "c-seed"];
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
  [/\bsound\s*bar\b/g, "soundbar"],
];

export function parseQuickZone(text) {
  let t = " " + String(text || "").toLowerCase().trim() + " ";
  for (const [re, sub] of SPOKEN) t = t.replace(re, " " + sub + " ");
  const chips = [];
  const zone = { scope: "included" };
  let spk = null, tv = null, ofe = false, local = false, matrix = false;

  const eat = re => { const m = t.match(re); if (m) t = t.replace(re, " "); return m; };

  if (eat(/\bprewire(d)?\b|\bpre-wire(d)?\b/)) { zone.scope = "prewire"; chips.push({ kind: "scope", label: "PRE-WIRE" }); }
  if (eat(/\bfuture\b/)) { zone.scope = "future"; chips.push({ kind: "scope", label: "FUTURE" }); }
  if (eat(/\bofe\b|\bexisting\b|\bowner\b/)) ofe = true;
  if (eat(/\blocal\b/)) local = true;
  if (eat(/\bmatrix\b|\bdistributed\b/)) matrix = true;

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
    const m = eat(/\b(\d{1,2})\s*(x\s*)?(speakers?|spk)\b/) || (eat(/\bpair\b/) && [null, "2"]);
    if (m) spk = { config: "stereo", count: +m[1] || 2 };
  }

  // projector: "projector 120"
  const proj = eat(/\bprojector\s*(\d{2,3})?\b|\bproj\s*(\d{2,3})?\b/);
  // brand
  let brand = "";
  for (const b of BRANDS) { const re = new RegExp(`\\b${b}\\b`); if (re.test(t)) { t = t.replace(re, " "); brand = b[0].toUpperCase() + b.slice(1); break; } }
  // TV size: standalone 32–220 number (after configs consumed)
  const size = eat(/\b(3[2-9]|[4-9]\d|1\d\d|2[0-2]\d)\b/);
  if (proj) tv = { displayType: "projector", size: +(proj[1] || proj[2] || size?.[1] || 120) };
  else if (!noTv && (size || brand || eat(/\btv\b/))) tv = { displayType: "tv", size: size ? +size[1] : null, brand };
  if (tv && brand && !tv.brand) tv.brand = brand;

  // leftover words = zone name
  const name = t.replace(/\s+/g, " ").trim().split(" ")
    .filter(w => w && !/^(the|a|an|with|and|in|room)$/.test(w) || w === "room")
    .map(w => w[0] ? w[0].toUpperCase() + w.slice(1) : w).join(" ").trim() || "New Zone";
  zone.name = name;
  zone.id = "z-" + slug(name);
  zone.endpoints = [];
  chips.unshift({ kind: "name", label: name });

  if (spk) {
    const ep = { id: zone.id + "-spk", type: "speakers", ...spk, status: zone.scope === "prewire" ? "prewire" : ofe ? "ofe" : "new" };
    if (ep.config === "stereo" && !ep.count) ep.count = 2;
    zone.endpoints.push(ep);
    const cfgLabel = ep.config === "landscape" ? `landscape ${ep.satCount}+1`
      : ep.config.startsWith("surround") ? ep.config.slice(9) + " surround" : ep.config;
    chips.push({ kind: "spk", label: cfgLabel + (ofe ? " · OFE" : "") });
  }
  if (tv) {
    const ep = { id: zone.id + "-tv", type: "display", displayType: tv.displayType, brand: tv.brand || "",
      size: tv.size || 65, status: ofe ? "ofe" : "new" };
    if (!tv.size) ep.confirm = ["size"];
    zone.endpoints.push(ep);
    chips.push({ kind: "tv", label: `${tv.brand || (tv.displayType === "projector" ? "Projector" : "TV")} ${ep.size}"${ep.confirm ? " ?" : ""}${ofe ? " · OFE" : ""}` });
  }
  if (local && tv) chips.push({ kind: "hint", label: "local source" });
  if (matrix && tv) chips.push({ kind: "hint", label: "matrix feed" });
  zone._hints = { local, matrix };
  return { zone, chips, empty: !zone.endpoints.length };
}

export function parseQuick(text) {
  return String(text || "").split(/,|\bthen\b|\n/).map(s => s.trim()).filter(Boolean).map(parseQuickZone);
}
