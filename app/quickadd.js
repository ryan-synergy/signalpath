/* SignalPath quick-add — shorthand/dictation zone entry (UX mock: type or
   speak "family room 5.1 75 sony matrix", see parse-preview chips, commit).
   Pure parser, no DOM. Comma / "then" / newline separates multiple zones. */

import { SPEAKER_SETUP, SCOPE_NAME } from "./names.js";

const uid = p => p + "-" + Math.random().toString(36).slice(2, 7);
const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || uid("z");

const BRANDS = ["sony", "samsung", "lg", "tcl", "vizio", "hisense", "panasonic", "sharp", "seura", "sunbrite", "c-seed", "epson", "jvc", "toshiba", "philips", "insignia", "dell", "barco", "optoma", "benq"];
const BRAND_LABEL = { lg: "LG", tcl: "TCL", "c-seed": "C SEED", jvc: "JVC", benq: "BenQ" };
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
  [/\bfive[\s-]*(point[\s-]*)?one[\s-]*(point[\s-]*)?two\b/g, "5.1.2"],
  [/\bseven[\s-]*(point[\s-]*)?one[\s-]*(point[\s-]*)?four\b/g, "7.1.4"],
  [/\bfive[\s-]*(point[\s-]*)?one\b/g, "5.1"],
  [/\bseven[\s-]*(point[\s-]*)?one\b/g, "7.1"],
  [/\btwo[\s-]*(point[\s-]*)?one\b/g, "2.1"],
  [/\btwo[\s-]*(point[\s-]*)?(oh|zero)\b/g, "2.0"],
  [/\bsound\s+bar(\s*(and|\+|with)?\s*sub)?\b/g, (m, sub) => sub ? "soundbar-sub" : "soundbar"],
];

// spelled-out numbers ("sixty five inch", "landscape eight", "four speakers") → digits.
// Runs after SPOKEN, so "five one" / "seven one four" are already speaker setups.
const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function wordsToDigits(t) {
  // "one-hundred-forty-inch", "eighty-two-inch": hyphens between number words are spaces
  const NW = "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)";
  for (let i = 0; i < 3; i++) t = t.replace(new RegExp(`\\b(${NW})-(?=${NW}\\b|inch)`, "g"), (m, w) => `${w} `);
  const W = `(?:${[...Object.keys(TENS), ...Object.keys(ONES)].join("|")})`;
  // "one hundred (and) twenty", "a hundred", "one twenty" (a projector screen) are rare; handle hundreds plainly
  t = t.replace(new RegExp(`\\b(?:a|one)\\s+hundred(?:\\s+and)?(?:\\s+(${W})(?:[\\s-]+(${W}))?)?\\b`, "g"), (m, a, b) =>
    String(100 + (TENS[a] ?? ONES[a] ?? 0) + (b ? ONES[b] ?? 0 : 0)));
  // "one twenty" / "one ten" — how a projector screen is said out loud
  // ("one thirty five" = 135, "one oh five" = 105 — the ones place counts too)
  const ONE9 = Object.keys(ONES).filter(k => ONES[k] > 0 && ONES[k] < 10).join("|");
  t = t.replace(new RegExp(`\\bone\\s+(?:oh|zero|o)\\s+(${ONE9})\\b`, "g"), (m, b) => String(100 + ONES[b]));
  t = t.replace(new RegExp(`\\bone\\s+(ten|${Object.keys(TENS).join("|")})(?:[\\s-]+(${ONE9}))?\\b`, "g"), (m, a, b) => String(100 + (a === "ten" ? 10 : TENS[a]) + (b && a !== "ten" ? ONES[b] : 0)));
  t = t.replace(new RegExp(`\\b(${Object.keys(TENS).join("|")})(?:[\\s-]+(${Object.keys(ONES).filter(k => ONES[k] && ONES[k] < 10).join("|")}))?\\b`, "g"),
    (m, a, b) => String(TENS[a] + (b ? ONES[b] : 0)));
  return t.replace(new RegExp(`\\b(${Object.keys(ONES).join("|")})\\b`, "g"), (m, a) => String(ONES[a]));
}
// the ways people say a speaker setup or a TV size that the readers below don't (Ryan 2026-10-02:
// "65 inch" and "two channel" must just work)
const PHRASES = [
  [/\b(\d{2,3})\s*-?\s*(?:inches|inch|in\.|in(?=\s|$)|''|"|”)(?=[\s,]|$)/g, (m, n) => n],    // 65 inch / 65-inch / 65 in. / 65"
  [/\b(?:1|one|single)[\s-]*(?:channel|ch)\b/g, "mono"], [/\b(?:2|two)[\s-]*(?:channel|ch)\b/g, "2.0"], [/\b(?:5|five)[\s-]*(?:channel|ch)\b/g, "5.1"],
  [/\b(?:7|seven)[\s-]*(?:channel|ch)\b/g, "7.1"], [/\b2\s*ch\b/g, "2.0"],
  [/\bstereo\s+pair\b/g, "stereo"], [/\b(?:dolby\s+)?atmos\b|\b(?:ceiling\s+)?heights?(?:\s+(?:channels?|speakers?))?\b|\bheight\s+channels?\b/g, "__atmos"], [/\b7\.2\.4\b/g, "7.1.4"], [/\b5\.2\b/g, "5.1"], [/\b7\.2\b/g, "7.1"],
  [/\bsound\s*bar\s*(?:\+|&|and|with|w\/)\s*(?:a\s+)?(?:sub(?:woofer)?)\b/g, "soundbar-sub"],
  [/\b(?:surround(?:\s+sound)?)\b/g, "__surround"],
  [/\btv\s+only\b/g, "tv"],
  [/(?<![\d.])\b(\d{1,2})\s+(?:(?:in-?)?ceiling|in-?wall|wall|outdoor|rock|bookshelf)\s+(speakers?)\b/g, (m, n, w) => `${n} ${w}`],
];

// words a sentence wraps around a room that aren't its name (Wispr Flow / dictation writes full sentences)
const FILLER = new Set(["the", "a", "an", "with", "and", "in", "on", "of", "has", "have", "had", "is", "are", "was", "will", "be", "gets", "get",
  "wants", "want", "needs", "need", "would", "like", "also", "plus", "only", "just", "audio", "sound", "speakers", "speaker", "system", "screen", "display", "television", "monitor", "oled", "qled", "led", "lcd", "uhd", "4k", "8k", "bravia", "neo", "frame", "smart",
  "it", "its", "it's", "there", "that", "which", "for", "to", "some", "set", "setup", "up", "we", "they", "i", "it'll", "going", "goes", "using", "use",
  // spoken filler (voicemail-style dictation: "okay so uh master bedroom um …") and leftovers of fixes / "both"
  "uh", "uhh", "um", "umm", "er", "okay", "ok", "so", "oh", "yeah", "right", "well", "basically", "let", "me", "don't", "dont", "forget",
  "provides", "provide", "includes", "include", "features", "feature", "featuring", "equipped", "showcases", "delivers", "offers", "through", "via", "channel", "channels",
  "both", "all", "each", "add", "plus", "including", "but", "not", "maybe", "actually", "wait", "sorry", "pretty", "we've", "got", "here", "at", "about", "around"]);

// a floor said as a heading ("upstairs we have …", "level 2 has three bedrooms") isn't part of a room's name.
// Glued to one room ("upstairs bath") it stays — that's how the crew tells two baths apart.
const FLOOR = "(?:upstairs|downstairs|main\\s+(?:level|floor)|(?:first|second|third|ground|top|lower|upper|1st|2nd|3rd)\\s+(?:floor|level)|(?:floor|level)\\s+(?:\\d|one|two|three))";
// dictation's false starts: "55 no wait 65", "5.1 actually make it 7.1", "not 50 sorry 43" — the last thing said wins
const VAL = "(?:\\d{1,3}(?:\\.\\d){0,2}|__surround|stereo|mono|soundbar(?:-sub)?|projector|tv|speakers?)";
const FIXUP = new RegExp(`(?:\\bno\\s+)?(?:\\baudio\\s+)?\\b${VAL}(?:\\s+tv)?\\s+(?:no\\s+wait|no\\s+actually|actually(?:\\s+make\\s+(?:it|that))?|wait|sorry|i\\s+mean|scratch\\s+that|make\\s+(?:it|that))\\s+(?:maybe\\s+|make\\s+(?:it|that)\\s+|just\\s+)?(?=(?:a\\s+)?(?:no\\s+|single\\s+)?${VAL}\\b)`, "g");

export function parseQuickZone(text) {
  let t = " " + String(text || "").toLowerCase().trim() + " ";
  // dictation punctuation never sticks to a word ("soundbar:", "50 inch!", "3.1:") — decimals (5.1) and the inch mark stay
  t = t.replace(/[,;:!?–—()]/g, " ").replace(/\.(?=\s|$)/g, " ");
  // tech shorthand: "4 ic spkrs" = 4 in-ceiling speakers, "iw spk" = in-wall
  t = t.replace(/\bspkrs?\b|\bspks\b/g, "speakers").replace(/\bic\b(?=\s+speakers?)|\bic\b(?=\s+spk)/g, "in-ceiling").replace(/\biw\b(?=\s+(?:speakers?|spk))/g, "in-wall");
  t = t.replace(/\bsurround-(\d\.\d(?:\.\d)?)\b/g, (m, c) => ` ${c} `).replace(/\bspeaker[_\s]?count\s*:?\s*(\d{1,2})\b/g, (m, n) => ` ${n} speakers `);
  for (const [re, sub] of SPOKEN) t = t.replace(re, (...m) => " " + (typeof sub === "function" ? sub(...m) : sub) + " ");
  t = wordsToDigits(t);
  for (const [re, sub] of PHRASES) t = t.replace(re, m => " " + m.replace(re, sub) + " ");
  // a bare "surround" is a 5.1 unless a setup was also given ("surround 7.1")
  // (with Atmos said too, the Atmos rule below decides: "surround sound with atmos" is a 7.1.4)
  t = /(^|\s)(5\.1|5\.1\.2|7\.1|7\.1\.4)(\s|$)/.test(t) || /__atmos/.test(t) ? t.replace(/__surround/g, " ") : t.replace(/__surround/, " 5.1 ").replace(/__surround/g, " ");
  for (let i = 0; i < 4 && FIXUP.test(t); i++) t = t.replace(FIXUP, " ");
  t = t.replace(/\b(\d{2,3})\s+no\s+(?=\d{2,3}\b)/g, " ")                      // "77 no 75"
    .replace(/\b(?:soundbar|stereo|mono)\s+(?:uh|um)\s+(?=soundbar|stereo|mono)/g, " ");   // "soundbar uh soundbar with sub"
  // a floor as a heading: "upstairs we have", "level 2 has three bedrooms", "upstairs: loft …"
  t = t.replace(new RegExp(`\\b${FLOOR}\\s+(?=(?:we\\s+have|we've\\s+got|there\\s+(?:are|is)|there's|has|have|is|:|[2-9]\\s+[a-z]))`, "g"), " ");
  // "full setup" / "the whole works" is praise, not a name
  t = t.replace(/\b(?:pretty\s+)?full\s+(?:setup|system)\b|\bthe\s+works\b/g, " ");
  // protect a numbered room name from the TV-size reader: "suite 101" → "suite #101"
  t = t.replace(NUMBERED_ROOM, (m, w, n) => `${w} #${n}`);
  const chips = [];
  const zone = { scope: "included" };
  // "den same as the office" / "guest suite same setup" / "lounge ditto": the gear comes from that room (parseQuick copies it)
  const same = t.match(/\bsame\s+(?:thing\s+)?as\s+(?:the\s+)?(.+?)\s*$|\b(?:the\s+)?(?:exact(?:ly)?\s+)?(?:the\s+)?same(?:\s+(?:setup|thing|gear|deal|as\s+(?:above|before)))?\b|\bditto\b|\bidentical\b|\bmatch(?:es)?\s+(?:it|that)\b|\bcopy\s+(?:that|it)\b/);
  if (same) { zone._same = (same[1] || "").trim(); t = t.replace(same[0], " "); }
  // "both 65 …" / "all 43 inch": this gear goes to the rooms just named too
  if (/\b(?:both|all|each)\b/.test(t)) zone._both = true;
  let spk = null, tv = null, ofe = false, local = false, matrix = false, avr = false;



  const eat = re => { const m = t.match(re); if (m) t = t.replace(re, " "); return m; };
  const eatAll = re => { let m = null; for (let i = 0; i < 4; i++) { const x = eat(re); if (!x) break; m = m || x; } return m; };
  if (eat(/\bprewire(d)?\b|\bpre-wire(d)?\b/)) { zone.scope = "prewire"; chips.push({ kind: "scope", label: SCOPE_NAME.prewire }); }
  // "prewire only … ready for future expansion": the prewire is what's being done now — "future" doesn't override it
  // ("future prewire", said together, is a prewire for a later phase — future)
  const futurePre = /\bfuture\s+pre-?wire/.test(text.toLowerCase());
  const prewireOnly = /\bpre-?wire\s+only\b|\bscope\s*:?\s*pre-?wire/.test(text.toLowerCase());
  if (eatAll(/\bfuture\b/) && (zone.scope !== "prewire" || futurePre || !prewireOnly)) { zone.scope = "future"; chips.push({ kind: "scope", label: SCOPE_NAME.future }); }
  if (eat(/\b(?:customer|client|homeowner)[- ]?(?:supplied|provided|furnished|provides|supplies|owned)\b|\bofe\b|\bexisting\b|\bowner\b(?!'s|s\b)(?:[- ]?(?:supplied|provided|furnished))?/)) ofe = true;   // "owner's suite" is a room, not OFE
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
  // things said ABOUT the room that aren't its name (Ryan 2026-10-03: "it's still creating random rooms") —
  // a source, a sub, where the TV hangs, the mount. Kept as the room's note, never its name, never a new room.
  const said = [];
  // a Sonos soundbar is a soundbar ("master 65 with a sonos arc")
  t = t.replace(/\bsonos\s+(?:arc(?:\s+ultra)?|beam|ray|playbar|playbase)\b/g, " soundbar ");
  // sources: "with an apple tv", "and a cable box", "kaleidescape", "Apple TV and cable."
  t = t.replace(/\b(?:an?\s+|the\s+)?(apple\s*tv(?:\s*4k)?|appletv|atv|cable(?:\s+box)?(?!\s+(?:run|runs|pull|drop|wire|wiring))|directv(?:\s+box)?|dish(?:\s+box)?|satellite(?:\s+box)?|roku|fire\s*tv|kaleidescape|blu-?ray(?:\s+player)?|xbox|playstation|ps5|nintendo|switch\s+console|game\s+console|turntable|record\s+player)\b/g,
    (m, w) => { said.push(w.replace(/\s+/g, " ")); return " "; });
  // a sub: with a soundbar it's a soundbar + sub, with a stereo pair a 2.1; surround and landscape already have one
  let sub = false;
  t = t.replace(/\b(?:an?\s+|the\s+|dual\s+|two\s+|2\s+)?(?<!-)(?:sub(?:woofer)?s?)\b(?!-)/g, m => { sub = true; return " "; });
  // gear named in passing: "and the sonos", "a sonos amp", "an amp"
  t = t.replace(/\b(?:an?\s+|the\s+)?(sonos(?:\s+(?:amp|port|connect))?)\b/g, (m, w) => { said.push(w); return " "; });
  // where it goes / how it's mounted: "over the fireplace", "in the ceiling", "on an articulating mount", "mounted above the mantel"
  t = t.replace(/\b(?:mounted\s+)?(?:over|above|on|in|under|below|beside|behind|into|next\s+to)\s+(?:the|a|an)\s+((?:[a-z-]+\s+)?(?:fireplace|mantel|mantle|wall|ceiling|island|bar|bed|cabinet|credenza|console|sofa|couch|bookshelf|bookcase|shelf|corner|window|built-?ins?|niche|vanity|mirror|pergola|eaves?|soffit|cabana|patio\s+cover))\b/g,
    m => { said.push(m.trim().replace(/\s+/g, " ")); return " "; });
  t = t.replace(/\b(?:on\s+)?(?:an?\s+)?(?:articulating|full[\s-]*motion|tilt(?:ing)?|fixed|swivel|ceiling)\s+mount\b|\bmounted\b|\blater\b/g, m => { if (/mount\b/.test(m)) said.push(m.trim()); return " "; });
  // "nothing else", "no nothing", "nothing in there": said, not a name
  eat(/\bno\s+nothing\b|\bnothing(?:\s+(?:else|in\s+there|at\s+all))?\b/);
  // "audio only" is speakers and no TV
  t = t.replace(/\b(audio|music)\s*only\b/g, (m, w) => ` ${w} no tv `);     // ("two speakers only" = just the pair)
  // "a six foot screen": a width, not a size — not a name either
  t = t.replace(/\b\d{1,2}\s*(?:foot|feet|ft)\s+(?:wide\s+)?(?:screen|wide)\b/g, " ");
  const noTv = !!eatAll(/\bno\s*(?:video\s*)?(?:tv|display|screen|television|video)s?\b|\bwithout (?:a )?(?:tv|display|screen)\b|\bskip\s+(?:the\s+)?(?:tv|display|screen|video)\b|\bno\s+room\s+for\s+(?:a\s+)?(?:tv|screen|display)\b/);
  // said on purpose: a TV-only room (the suggestions stop asking) — "no audio", "no sound system", "TV only"
  const noSpk = !!eatAll(/\bno\s+(?:speakers?|audio|sound|music)(?:\s+(?:system|components?|speakers?|equipment))?\b|\bvideo\s+only\b|\b(?:skip|without)\s+(?:the\s+)?(?:speakers?|audio|sound)\b/);

  // landscape with optional sat count: "landscape 8" / "landscape"
  const land = eat(/\blandscape\s*(\d{1,2})?\b/);
  if (land) {
    // "landscape with eight speakers" — the count can come later in the sentence
    eat(/\bpairs?\b/);
    const n = land[1] || eat(/(?<![\d.])\b(\d{1,2})\s*(?:x\s*)?(?:speakers?|satellites?|sats?)\b/)?.[1];
    spk = { config: "landscape", satCount: n ? +n : 6, buriedSub: true };
  }

  // where the speakers go is not a name: "4 in-ceiling speakers" = 4 speakers ("in ceiling", "in-wall", "outdoor rock")
  t = t.replace(/\b(?:in[- ]?ceiling|in[- ]?wall|on[- ]?wall|ceiling|wall|outdoor|rock|bookshelf|architectural|surface[- ]?mount(?:ed)?)\s+(speakers?|spk)\b/g, () => " speakers ");
  // "speakers 4" said the other way round (a small number only — "speakers 55" is a TV)
  t = t.replace(/\b(speakers?)\s*(?:x\s*)?(\d{1,2})\b(?!\s*(?:"|''|in\b|inch|tv\b))/g, (m, w, n) => +n >= 1 && +n <= 12 ? ` ${n} speakers ` : m);
  // Atmos / height channels: 7.1 + Atmos = 7.1.4; 5.1 + Atmos stays a 5.1 set (5.1.2); Atmos alone = 7.1.4
  if (/__atmos/.test(t)) { t = t.replace(/__atmos/g, " "); if (!/(^|\s)(5\.1(\.2)?|7\.1\.4)(?=\s|$)/.test(t)) t = /(^|\s)7\.1(?=\s|$)/.test(t) ? t.replace(/(^|\s)7\.1(?=\s|$)/, " 7.1.4 ") : t + " 7.1.4 "; }
  // "outdoor stereo", "4 in-ceiling stereo": where they go, and how many
  t = t.replace(/(?<![\d.])\b(\d{1,2})\s+(?:in[- ]?ceiling|in[- ]?wall|ceiling|wall|outdoor|rock)\s+(?=stereo\b)/g, (m, n) => ` ${n} speakers `)
    .replace(/\b(?:in[- ]?ceiling|in[- ]?wall|outdoor|rock|ceiling)\s+(?=stereo\b|mono\b|audio\b|music\b|pair\b)/g, " ");
  // explicit configs (the richest first: "7.1.4" before "7.1")
  const RICH = ["7.1.4", "5.1.2", "7.1", "5.1", "soundbar-sub", "sb-sub", "2.1", "soundbar", "sb", "landscape", "stereo", "2.0", "mono"];
  if (!spk) for (const [tok, cfg] of Object.entries(CONFIGS).sort((a, b) => RICH.indexOf(a[0]) - RICH.indexOf(b[0]))) {
    if (tok === "landscape") continue;
    const re = new RegExp(`(^|\\s)${tok.replace(/\./g, "\\.")}(\\s|$)`);
    if (re.test(t)) { t = t.replace(re, " "); spk = { config: cfg }; break; }
  }
  // "2.1 with a soundbar" / "soundbar 2.1": a soundbar and its sub
  if (spk && (spk.config === "2.1" && eat(/\bsoundbar\b/) || spk.config === "soundbar" && eat(/(^|\s)2\.1(?=\s|$)/))) spk = { config: "soundbar-sub" };
  // the setup said twice ("two-channel stereo", "7.1.4 Atmos", "5.1 surround") — the rest is not a name
  if (spk) { t = t.replace(/(^|\s)(\d\.\d(?:\.\d)?)(?=\s|$)/g, " "); eat(/\bstereo\b/); }
  // "stereo, 4 ceiling speakers": a stereo-type set with its count given too
  if (spk) { const n = eat(/(?<![\d.])\b(\d{1,2})\s*(?:x\s*)?(?:speakers?|spk)\b/);
    if (n && +n[1] > 1 && ["stereo", "mono"].includes(spk.config)) spk = { config: "stereo", count: +n[1] };   // "one speaker (mono)" stays mono
    eat(/\bspeakers?\b/); }                                   // "7.1.4 with 6 ceiling speakers": the count isn't a name either
  // "N speakers" / "pair"
  // "just a single speaker" / "one speaker": a mono speaker
  if (!spk && !noSpk && eat(/(?<![\d.])\b(?:a\s+)?(?:single|1|lone|one)\s+speakers?\b(?!\s*(?:pairs?|sets?))/)) spk = { config: "mono" };
  if (!spk && !noSpk) {
    const pairs = eat(/(?<![\d.])\b(\d{1,2})\s*(x\s*)?pairs?\b/);
    const m = pairs ? [null, String(+pairs[1] * 2)]
      : eat(/(?<![\d.])\b(\d{1,2})\s*(x\s*)?(speakers?|spk)\b/) || (eat(/\bpair\b/) && [null, "2"]);
    if (m) spk = { config: "stereo", count: +m[1] || 2 };
    // plain "speakers" (no number, no setup) is a stereo pair
    else if (eat(/\bspeakers?\b|\baudio\b|\bmusic\b/)) spk = { config: "stereo", count: 2 };
  }

  // the sub said earlier: a soundbar gets its sub, a stereo pair becomes a 2.1
  if (sub && spk?.config === "soundbar") spk = { config: "soundbar-sub" };
  else if (sub && spk?.config === "stereo" && (spk.count || 2) === 2) spk = { config: "2.1" };
  t = t.replace(/\bprojection(?:\s+screen)?\b/g, " projector ");
  // projector: "projector 120"
  const proj = eat(/\bprojector\s*(\d{2,3})?\b|\bproj\s*(\d{2,3})?\b/);
  // brand
  let brand = "";
  // the brand said first wins ("a TCL … (the old Samsung moves to the den)")
  const bHit = BRANDS.map(b => ({ b, i: t.search(new RegExp(`\\b${b}\\b`)) })).filter(x => x.i >= 0).sort((x, y) => x.i - y.i)[0];
  if (bHit) { t = t.replace(new RegExp(`\\b${bHit.b}\\b`), " "); brand = BRAND_LABEL[bHit.b] || bHit.b[0].toUpperCase() + bHit.b.slice(1); }
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
  if (said.length) { zone.note = [...new Set(said)].join(" · "); chips.push({ kind: "hint", label: `noted: ${zone.note}` }); }
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
    // "… and two guest rooms 50 each": a count of rooms after "and" starts its own room ("and 4 speakers" doesn't)
    .replace(/\band\s+(?=(?:[2-9]|two|three|four|five|six|seven|eight|nine)\s+(?!speakers?|pairs?|subs?|ceiling|in\b|in-|wall|outdoor|rock|channels?|ch\b|point|one\b|oh\b|zero|x\b|inch|tvs?\b)[a-z])/gi, ",")
    // "also don't forget the bathroom", "and uh the theater", "oh and the patio": a new room is starting
    // (a clause that names no room still joins the one before — "and the sub" stays with its soundbar)
    .split(/[,;\n]|\.(?=\s|$)|\bthen\b|\bnext\b|\balso\b|\boh\s+and\b|\band\s+(?:(?:uh|um)\s+)?the\b|\band\s+(?:uh|um)\b/i)
    .map(x => x.replace(/\u2024/g, ".").replace(/^\s*(and|also|plus|oh)\b/i, "").trim()).filter(Boolean);
  const rooms = [];
  let lead = "";   // "so we also need …": an opener that names nothing goes with the room after it
  for (const c of clauses) {
    const named = parseQuickZone(c).named;
    if (!named && rooms.length) rooms[rooms.length - 1] += " " + c;
    else if (!named && !parseQuickZone(c).zone.endpoints.length) lead += c + " ";
    else { rooms.push(lead + c); lead = ""; }
  }
  if (lead && !rooms.length) rooms.push(lead.trim());
  return rooms;
}

// the same gear under another name: new ids, the name chip swapped
function cloneAs(src, name, scope) {
  const id = "z-" + slug(name), zone = JSON.parse(JSON.stringify(src.zone));
  Object.assign(zone, { name, id, scope: scope || zone.scope });
  delete zone._same; delete zone._both;
  zone.endpoints = zone.endpoints.map(e => ({ ...e, id: id + "-" + e.id.split("-").pop() }));
  return { ...src, zone, chips: [{ kind: "name", label: name }, ...src.chips.filter(c => c.kind !== "name")], empty: !zone.endpoints.length, named: true };
}
const keyOf = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// a floor glued to a room ("upstairs master", "lower bedroom") — "basement" is kept: "Basement Theater" is how the room is named
const GLUED_FLOOR = /^((?:upstairs|downstairs|upper|lower|main\s+(?:level|floor)|(?:first|second|third|ground|top|lower|upper|1st|2nd|3rd)\s+(?:floor|level)|(?:floor|level)\s+\d))\s+(.+)$/i;

/* text → rooms. `existing` = the job's room names already, so a floor stays in a name only when it's
   needed to tell two rooms apart (Ryan 2026-10-02: there's only one master — "upstairs master" is
   Master — but "upper bedroom" and "lower bedroom", or a second bath, keep their floor). */
export function parseQuick(text, existing = []) {
  const rooms = parseQuickRooms(text);
  const base = p => p.zone.name.match(GLUED_FLOOR)?.[2] || p.zone.name;
  const taken = new Map();   // base name → how many rooms answer to it
  for (const n of [...existing.map(n => ({ zone: { name: n } })), ...rooms]) { const k = keyOf(base(n)); taken.set(k, (taken.get(k) || 0) + 1); }
  return rooms.map(p => {
    const m = p.zone.name.match(GLUED_FLOOR);
    return m && taken.get(keyOf(m[2])) === 1 ? cloneAs(p, m[2], p.zone.scope) : p;
  });
}

function parseQuickRooms(text) {
  const out = [];
  for (const p of roomTexts(text).map(parseQuickZone)) {
    const z = p.zone;
    // "den same as the office": that room's gear (the room named, else the one before)
    if (z._same !== undefined && !z.endpoints.length) {
      const want = keyOf(z._same), done = out.filter(o => !o.empty);
      const src = want ? done.find(o => keyOf(o.zone.name) === want) || done.find(o => keyOf(o.zone.name).includes(want) || want.includes(keyOf(o.zone.name))) : done[done.length - 1];
      if (src) { out.push(cloneAs(src, z.name, z.scope !== "included" ? z.scope : null)); continue; }
    }
    // "conference room and then training room both 65 …": the rooms just named with nothing yet get it too
    if (z._both && z.endpoints.length) for (let i = out.length - 1; i >= 0 && out[i].empty; i--) out[i] = cloneAs(p, out[i].zone.name);
    // "two bedrooms 50 stereo" / "three 43 inch bedrooms": that many rooms, numbered
    const many = z.name.match(/^([2-9]) (.*[a-z])s$/i);
    if (many && !/ss$/i.test(z.name)) { for (let i = 1; i <= +many[1]; i++) out.push(cloneAs(p, `${many[2]} ${i}`)); continue; }
    delete z._same; delete z._both;
    out.push(p);
  }
  return out;
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
