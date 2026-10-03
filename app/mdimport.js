/* ---------- mdimport.js — a job from Markdown (Ryan 2026-10-02: "the priority is Markdown import") ----------
   The way a tech or another AI writes a system down: front matter or "Client:" lines, a ROOMS
   section (bullets, sub-headings per room, or a table) and a RACK / EQUIPMENT section (bullets
   or a table of gear). Nothing here decides design: every room goes through the quick-add reader
   and every box through the catalog, as the same commands the quick-add box and ✦ AI run
   (add_device, then add_zones) — so the rooms wire themselves exactly like typed ones.
   JSON inside the file still wins when it's a whole job: an AI review export, a SignalPath job,
   an AVWalk survey, a Blueprinted takeoff. A fenced command list (the ✦ AI reply shape) runs on
   top. What can't be read is listed in the import review, never dropped silently. Prices are
   never read: they're stripped from every line before anything is matched or kept. */

import { parseQuick, parseQuickZone } from "./quickadd.js";
import { planCommands, findProduct } from "./commands.js";
import { importAny, skeletonJob } from "./importers.js";
import { productName, TYPE_NAME } from "./names.js";

export const MD_FORMAT = "signalpath-design/1";

const MONEY = /(?:US)?\$\s?-?[\d,]+(?:\.\d+)?|\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b(?=\s*(?:USD|each|ea\b|\/|$))|\b\d+\.\d{2}\b(?:\s?USD)?|(@|\bat)\s*\d[\d,]*(?:\.\d+)?(?=\s*(?:each|ea\b|\/|$))/gi;
const noMoney = s => String(s).replace(MONEY, " ").replace(/\s+/g, " ").trim();
// Markdown decoration → plain words: links, images, emphasis, inline code, HTML tags, checkboxes, emoji bullets
export const plain = s => String(s ?? "")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, (m, t) => t)
  .replace(/<[^>]{1,80}>/g, " ").replace(/`+/g, "").replace(/\*\*|__|(?<![\w])\*(?=\S)|(?<=\S)\*(?![\w])|~~/g, "")
  .replace(/^\s*\[[ xX]\]\s*/, "").replace(/[•▪●✓✔✅➤▸►→]/g, " ")
  .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ").replace(/\s+/g, " ").trim();
const linkText = s => String(s).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, a, b) => b || a).replace(/\[([^\]]*)\]\([^)]*\)/g, (m, t) => t);

// what a heading is about
const H_ROOMS = /\b(rooms?|zones?|spaces?|by room|room[- ]by[- ]room|program|areas? served|locations?|audio\s*\/\s*video|a\s*\/?\s*v (?:system|plan|design|scope)|distributed (?:audio|video)|tvs? (?:&|and) speakers|displays?)\b/i;
const H_RACK = /\b(rack|equipment|head[- ]?end|gear|components?|hardware|bill of materials|b\.?o\.?m|devices|electronics|central|core|sources?|network(?:ing)?|amplification|amps?|receivers?|distribution|control system|processing)\b/i;
const H_JOB = /\b(job|project|client|customer|site|overview|summary|info(?:rmation)?|details|header)\b/i;
const H_SKIP = /\b(notes?|assumptions?|questions?|open items?|exclusions?|pricing|price|cost|labor|labour|terms|warranty|schedule|timeline|lighting|shades?|security|cameras?|hvac|wire list|wiring|connections?|cable|next steps?|summary of changes|revision|appendix|source data|command vocabulary|quote lines)\b/i;
const H_FLOOR = /\b(floor|level|upstairs|downstairs|basement|lower|upper|ground|main|first|second|third|exterior|outdoors?|outside|yard|backyard|guest ?house|pool ?house|casita|adu|wing|garage)\b/i;
const OUTDOOR_AREA = /\b(exterior|outdoors?|outside|yard|backyard)\b/i;

// gear words → the type a box gets when it isn't in the catalog
const TYPE_GUESS = [
  [/\b(av |a\/v )?receiver\b|\bavr\b|\bmrx\b/i, "avr"], [/\b(multi[- ]?zone |power |stereo )?amp(lifier)?s?\b|\bmdx\b/i, "amp"],
  [/\bhdmi matrix|\bmatrix\b/i, "videoMatrix"], [/\bmxnet\b.*\bswitch|\bav[- ]?over[- ]?ip\b.*\bswitch|\bavoip switch/i, "avSwitch"],
  [/\bavb\b/i, "avbSwitch"], [/\binput module|\baim\b/i, "audioInputModule"], [/\boutput module|\baom\b/i, "audioOutputModule"],
  [/\b(network |poe |ethernet |lan )switch\b|\bnetgear\b|\baraknis\b|\bcisco\b|\bluxul\b/i, "networkSwitch"],
  [/\bmxnet\b(?!.*\b(enc|dec|encoder|decoder|cbox|control)\b)/i, "avSwitch"], [/\brouter\b|\bgateway\b|\bfirewall\b|\budm\b|\bdream ?machine\b|\bdream ?router\b|\bcloud gateway\b|\bpepwave\b|\bpakedge\b.*\brouter|\beero\b/i, "gateway"],
  [/\bwattbox\b|\bpower conditioner\b|\bups\b|\bsurge\b|\bpdu\b/i, "power"], [/\bsplitter\b/i, "splitter"],
  [/\bhost\b|\bcontroller\b|\bcontrol processor\b|\bcore\b/i, "host"],
  [/\bapple ?tv\b|\bcable box\b|\bdirec ?tv\b|\bdirect ?tv\b|\bgenie\b|\bxfinity\b|\bspectrum box\b|\bdish\b|\broku\b|\bkaleidescape\b|\bblu[- ]?ray\b|\bstreamer\b|\bmusic( server)?\b|\bturn ?table\b|\bsonos (port|connect)\b|\bxbox\b|\bplaystation\b|\bps5\b|\bnintendo\b|\bfire ?tv\b|\bchromecast\b|\bnvidia shield\b|\bsatellite\b|\bmedia player\b/i, "source"],
];
// lines in a rack list that aren't boxes in the rack (they're wire, furniture, or in the rooms)
const NOT_RACK = /\b(cable|cat ?6a?|cat ?5e?|wire|wiring|hdmi cord|patch cord|rack shelf|shelf|blank|vent panel|brush|screws?|labels?|mounts?|brackets?|in[- ]?ceiling|in[- ]?wall|speakers?|subwoofer|tv|television|display|projector|screen|remote|keypad|touch ?panel|ipad|labor|programming|installation|design fee|tax|shipping|freight)\b/i;
const RACK_ITSELF = /\b(middle atlantic|strong|rack ?(enclosure|cabinet)?|\d{2}\s*u\b)/i;

/* ---------- reading: Markdown → rooms / gear / meta / embedded JSON ---------- */
export function readMarkdown(text) {
  let src = String(text ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/ /g, " ")
    .replace(/[‘’‚′]/g, "'").replace(/[“”„]/g, '"').replace(/″/g, '"').replace(/[‐-‒−]/g, "-");
  if (src.length > 2e6) src = src.slice(0, 2e6);
  src = src.replace(/<!--[\s\S]*?(?:-->|$)/g, "");                       // HTML comments are notes to the writer, never content
  const out = { meta: {}, rooms: [], gear: [], fences: [], skipped: [], areas: [] };
  // front matter
  const fm = src.match(/^\s*---\n([\s\S]*?)\n---\s*(\n|$)/);
  if (fm) { for (const l of fm[1].split("\n")) metaLine(out.meta, l); src = src.slice(fm[0].length); }
  // fenced blocks (``` or ~~~), kept apart from the prose
  src = src.replace(/(^|\n)[ \t]*(```+|~~~+)[ \t]*([\w+-]*)[^\n]*\n([\s\S]*?)(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g, (m, pre, fence, lang, body) => {
    out.fences.push({ lang: lang.toLowerCase(), body });
    // a YAML / plain block that lists rooms or gear ("rooms:\n  - name: great_room") reads like the rest of the page
    const l = lang.toLowerCase(), t = body.trim();
    if (/^(ya?ml|md|markdown|te?xt|plain)?$/.test(l) && !/^[[{]/.test(t) && /^\s*(rooms?|zones?|spaces?|equipment|rack|gear)\s*:/im.test(body)) return pre + "\n" + body + "\n";
    return pre + "\n";
  });
  const lines = src.split("\n");
  let section = "none", sectionLevel = 0, area = null, areaLevel = 99, table = null, titled = false, rackName = null;
  let hroom = null;   // a sub-heading under Rooms: one room with details, or a floor of rooms — decided by what's under it
  let room = null;    // the bullet room being read (its indented bullets are its details)
  const closeRoom = () => { if (room) { out.rooms.push(room); room = null; } };
  const closeH = () => {
    closeRoom();
    if (!hroom) return;
    const h = hroom; hroom = null;
    const floorish = h.floor || H_FLOOR_STRICT.test(h.name) || !looksLikeRoom(h.name);
    // "Speakers: …", "Screen: …" under it: one room's details, whatever the heading's called
    const specLines = h.items.some(it => SPEC_KEY.test(String(it.text).split(":")[0].trim()));
    // every line under it names a room ("Home Theater — 7.1.4…"): it's a floor, whatever it's called ("Basement")
    const allRooms = h.items.length && h.items.every(it => it.sep && looksLikeRoom(nameSep(it.text)?.[1] || ""));
    if (!specLines && (allRooms || (h.items.length && floorish && h.items.every(it => it.sep || looksLikeRoom(it.text)))))
      for (const it of h.items) out.rooms.push(splitRoom(it.text, it.parts, h.name));
    else if (!h.items.length && h.floor) { /* a floor heading with nothing under it */ }
    else out.rooms.push({ ...nameAndParens(h.name), parts: [...nameAndParens(h.name).parts, ...h.items.flatMap(it => [it.text, ...it.parts])], area: h.area });
  };
  const setSection = (kind, level) => { closeH(); section = kind; sectionLevel = level; area = null; areaLevel = 99; rackName = null; };
  const heading = (level, t) => {
    table = null;
    if (level <= areaLevel) { area = null; areaLevel = 99; }
    // the document's title: the job's name, never a section
    if (!titled && level === 1 && section === "none" && !/^(?:the\s+)?(rooms?|zones?|spaces?|rack|equipment(?: rack)?|gear|room[- ]by[- ]room|by room|audio\s*\/\s*video|av)$/i.test(t) && (!isRoomName(t) || t.split(/\s+/).length >= 3)) {
      if (isRoomName(t)) out.titleRoom = t; titled = true; out.meta.name ??= t.replace(/\s+[—–:|-]\s+.*(design|plan|proposal|system|scope|overview|av|audio|video|spec).*$/i, "").trim() || t; return; }
    titled = true;
    // "Main Equipment Rack", "Pool House Rack": a rack of its own, wherever it sits (a name ending in "rack" names it)
    if (/\brack\b/i.test(t) && !/\b(rack ?room|by (?:the )?rack)\b/i.test(t)) { setSection("rack", level); rackName = /\brack\s*\d*$/i.test(t) ? t : null; return; }
    const deeper = section !== "none" && level > sectionLevel;
    if (deeper && (section === "rooms" || section === "skip-in-rooms")) {
      if ((H_RACK.test(t) && !looksLikeRoom(t) && !H_FLOOR.test(t)) || RACK_WORDS.test(t)) { setSection("rack", level); return; }
      if (H_SKIP.test(t) && !looksLikeRoom(t)) { closeH(); out.skipped.push(`section “${t}”`); section = "skip-in-rooms"; return; }
      section = "rooms";
      // a heading with nothing under it yet, and now a deeper one: it was a floor
      if (hroom && !hroom.items.length && level > hroom.level) { area = hroom.name; areaLevel = hroom.level; hroom = null; }
      closeH();
      hroom = { name: t, level, items: [], area, floor: H_FLOOR.test(t) && !looksLikeRoom(t) };
      return;
    }
    if (deeper && section === "rack") { closeH(); return; }               // "### Sources" inside the rack list
    const kind = RACK_WORDS.test(t) ? "rack" : isRoomName(t) ? "room" : H_SKIP.test(t) && !H_ROOMS.test(t) ? "skip" : H_ROOMS.test(t) ? "rooms" : H_RACK.test(t) && !looksLikeRoom(t) ? "rack"
      : H_JOB.test(t) ? "job" : H_FLOOR.test(t) && !looksLikeRoom(t) ? "floor" : looksLikeRoom(t) ? "room" : "other";
    if (kind === "floor") { setSection("rooms", level - 1); hroom = { name: t, level, items: [], area: null, floor: true }; return; }
    if (kind === "room") {                                                // a room heading with no "Rooms" heading above it
      if (section !== "rooms") setSection("rooms", level - 1); else closeH();
      hroom = { name: t, level, items: [], area }; return;
    }
    setSection(kind, level);
    if (kind === "skip" || kind === "other") out.skipped.push(`section “${t}”`);
  };
  for (let i = 0; i < lines.length; i++) {
    // an emoji leading a line is a bullet, and some say what the line is (📺 TV, 🔊 speakers)
    const raw = lines[i].replace(/^(\s*)((?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}][\u{FE0F}\u{200D}]*)+)\s*/u, (m, ind, em) => {
      const label = /📺|🖥|📽|🎞/u.test(em) ? "TV: " : /🔊|🔈|🔉|🎵|🎶|🎧|📢/u.test(em) ? "Speakers: " : "";
      const boldNext = /^\s*(\*\*|__)/.test(lines[i].slice(m.length));
      return boldNext && !label ? ind : `${ind}- ${label}`;
    });
    // setext headings ("Rooms\n=====")
    const setext = lines[i + 1] && /^\s*(=+|-{3,})\s*$/.test(lines[i + 1]) && raw.trim() && !/^\s*[-*+|>]/.test(raw) && !/\|/.test(raw) ? (lines[i + 1].trim()[0] === "=" ? 1 : 2) : 0;
    const h = raw.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/) || (setext ? [raw, "#".repeat(setext), raw.trim()] : null);
    if (setext) i++;
    if (h) { const t = plain(linkText(h[2])).replace(/[:.]+$/, "").trim(); if (t) heading(h[1].length, t); continue; }
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { table = null; continue; }
    if (/^\s*([-*_]\s*){3,}$/.test(line)) { table = null; continue; }    // a rule
    if (/^\s*>/.test(line) && !/^\s*>\s*[-*+]/.test(line)) {          // a quote / callout: kept as a note
      const t = plain(line.replace(/^\s*>\s*(\[![^\]]*\])?/, "")); if (t) (out.noteLines ||= []).push(t); continue; }
    // tables
    if (/^\s*\|.*\|\s*$/.test(line) || (/\|/.test(line) && lines[i + 1] && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]))) {
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map(c => plain(linkText(c)));
      if (cells.every(c => /^:?-{2,}:?$/.test(c) || !c)) continue;       // the separator row
      if (!table) { closeH(); table = { head: cells.map(c => c.toLowerCase()) }; continue; }
      tableRow(out, section, table.head, cells, area);
      continue;
    }
    table = null;
    // a bold line or a short "Something:" line is a heading too ("**Rack equipment:**")
    let pseudo = !/^\s*([-*+•]|\d{1,3}[.)])\s/.test(line) && (line.match(/^\s*(?:\*\*|__)([^*_]{2,60}?)(?:\*\*|__)\s*:?\s*$/) || line.match(/^\s*([A-Za-z][^:|.!?]{1,40}?):\s*$/)?.filter((x, i) => i !== 1 || x.trim().split(/\s+/).length <= 5));
    if (pseudo && pseudo.length < 2) pseudo = null;
    if (pseudo) { const t = plain(pseudo[1]).replace(/:$/, "").trim(); if (t && !(metaKey(t))) { heading(section === "none" ? 2 : 7, t); continue; } }
    const pl = plain(linkText(line));
    // "Rack: mrx 1140, atv4k qty2, mdx-16" / "Rack Equipment: A, B and C." — a whole rack on one line
    const inl = pl.match(/^(?:[-*+•]\s+|\d{1,3}[.)]\s+)?(rack(?:\s+(?:equipment|gear))?|equipment(?:\s+rack)?|head[- ]?end|gear|components|hardware|bom)\s*:\s*(.+)$/i);
    if (inl) { closeH(); for (const g of splitList(inl[2])) out.gear.push({ text: g, line: i + 1, rack: rackName }); continue; }
    const kv = pl.match(/^(?:[-*+•]\s+)?([A-Za-z][\w /&]{1,24}?)\s*:\s*(.+)$/);
    if (kv && (!["rooms", "rack"].includes(section) || (section === "rooms" && !room && !hroom && metaKey(kv[1]))) && metaLine(out.meta, `${kv[1]}: ${kv[2]}`)) continue;
    const bullet = line.match(/^(\s*)(?:[-*+•]|\d{1,3}(?:\.\d{1,3})+\.?|\d{1,3}[.)]|[a-z][.)])\s+(.*)$/i);
    const indent = bullet ? bullet[1].replace(/\t/g, "    ").length : 0;
    const body = plain(linkText(bullet ? bullet[2] : line));
    if (!body) continue;
    if (bullet && indent === 0 && /^(equipment|rack|gear|head ?end|equipment rack|rack equipment|hardware|central rack|main rack|system equipment)$/i.test(body)) { closeH(); setSection("rack", 7); continue; }
    // a line of gear models ("MRX540 MRX1140 MDX8 ATV4K x2 WattBox Sonos"): the rack, wherever it sits
    if (!bullet && section !== "rack" && gearTokens(body)) { closeH(); for (const g of gearTokens(body)) out.gear.push({ text: g, line: i + 1, rack: rackName }); continue; }
    if (section === "rooms") {
      if (hroom) {
        const last = hroom.items[hroom.items.length - 1];
        if (bullet && indent >= 2 && last) last.parts.push(body);
        else hroom.items.push({ text: body, sep: !!nameSep(body), parts: [] });
        continue;
      }
      const lead = line.match(/^\s*/)[0].replace(/\t/g, "    ").length;
      const yn = body.match(/^(?:name|room|zone|space)\s*:\s*(.+)$/i);                    // YAML: "- name: great_room"
      if (!yn && room && ((bullet && indent >= 2) || (!bullet && lead >= 2))) { room.parts.push(body); continue; }   // a detail under the room above
      // a describing line under a room ("- Guest viewing capability"): the room's, not a room of its own
      if (!yn && room && room.name && bullet && !nameSep(body) && !startsRoom(body) && !/^\d/.test(body)) { room.parts.push(body); continue; }
      closeRoom();
      room = yn ? { name: yn[1].replace(/[_-]+/g, " ").replace(/^["']|["']$/g, "").trim(), parts: [], area } : splitRoom(columns(body), [], area);
      continue;
    }
    if (section === "rack") {
      if (!bullet && body.split(/\s+/).length >= 8 && (/[.!?]$/.test(body) || SENTENCE.test(body))) { (out.noteLines ||= []).push(body); continue; }
      if (!bullet && /\S(?:\t|\s{2,})\S/.test(line.trim()) && line.trim().split(/\t|\s{2,}/).length >= 2) { for (const g of line.trim().split(/\t|\s{2,}/)) out.gear.push({ text: g, line: i + 1, rack: rackName }); continue; }
      if (!bullet && /,/.test(body) && splitList(body).length >= 2) { for (const g of splitList(body)) out.gear.push({ text: g, line: i + 1, rack: rackName }); continue; }
      if (!(bullet && indent >= 2 && out.gear.length && !looksLikeGear(body))) out.gear.push({ text: body, line: i + 1, rack: rackName }); continue; }
    if (section === "skip" || section === "skip-in-rooms") { (out.noteLines ||= []).push(body); continue; }
    if (bullet && indent === 0 && section !== "rooms" && section !== "rack" && !section.startsWith("skip")) {
      const sr = splitRoom(body);
      if (sr.bare) { closeH(); section = "rooms"; sectionLevel = 7; room = { ...sr, area }; continue; }
    }
    // "**Living Room:** 7.1 surround, 85" Sony" with no Rooms heading above it: a room all the same
    if (section !== "rooms" && section !== "rack" && section !== "skip" && section !== "skip-in-rooms" && indent === 0) {
      const ns = nameSep(body);
      if (ns && ns[1].trim().split(/\s+/).length <= 5 && (looksLikeRoom(ns[1]) || isRoomName(ns[1])) && ns[2] && !H_SKIP.test(ns[1])) {
        closeH(); section = "rooms"; sectionLevel = 7; room = splitRoom(body, [], area); continue;
      }
    }
    if (section === "none" && bullet) { (out.loose ||= []).push({ text: body, line: i + 1 }); continue; }
    if (section !== "skip" && section !== "skip-in-rooms") (out.prose ||= []).push({ text: body, raw: plain(linkText(line.replace(/\s{2,}|\t/g, " \u0001 "))), line: i + 1, section });
  }
  closeH();
  if (!out.rooms.length && out.titleRoom && (out.loose?.length || out.prose?.length)) {
    out.rooms.push({ name: out.titleRoom, parts: [...(out.loose || []).map(l => l.text), ...(out.prose || []).map(l => l.text)] }); out.loose = []; out.prose = [];
  }
  for (const r of out.rooms) if (r.area && !out.areas.includes(r.area)) out.areas.push(r.area);
  return out;
}
// "great-room    85-sony    7.1    surround": columns → "great room — 85 sony 7.1 surround" (none / null / - are blanks)
const columns = t => {
  const c = String(t).split(/\t|\s{2,}/).map(x => x.trim()).filter(Boolean);
  if (c.length < 3) return t;
  const rest = c.slice(1).filter(x => !/^(none|null|n\/a|-|—)$/i.test(x)).map(x => x.replace(/^(\d{2,3})-(?=[a-z])/i, (m, n) => `${n} `).replace(/\bproj\b/i, "projector"));
  return `${c[0].replace(/[_-]+/g, " ")} — ${rest.join(" ")}${c.slice(1).some(x => /^(none)$/i.test(x)) && !rest.some(x => /\d{2,3}/.test(x)) ? " no tv" : ""}`;
};
// a list said in one line: "A, B, and C." / "A; B" / "A and B"
const splitList = v => String(v).replace(/[.]\s*$/, "").split(/\s*(?:,|;|\s+and\s+|\s+&\s+|\s+plus\s+)\s*(?![^(]*\))/i).map(x => x.replace(/^(?:and|an?|the)\s+/i, "").trim()).filter(x => x.length > 1);
// "Family Room — 5.1, 75\" Sony" → the name and the rest (a spec label like "Speakers: 5.1" is not a name)
const SPEC_KEY = /^(speakers?|audio|sound|tv|display|video|screen|size|brand|notes?|scope|status|source|sources|feed|config(uration)?|system|equipment|gear|location|floor|level|qty|quantity)$/i;
const nameSep = t => { const m = String(t).match(/^(.{1,60}?)\s*(?::|—|–|\s-\s|=>|->|\|)\s*(.*)$/); return m && !/^\d/.test(m[1].trim()) && !SPEC_KEY.test(m[1].trim()) ? m : null; };
const nameAndParens = n => { const m = String(n).match(/^(.*?)\s*\(([^)]*)\)\s*$/); return m && m[1].trim() ? { name: m[1].trim(), parts: [m[2]] } : { name: String(n).trim(), parts: [] }; };
function splitRoom(text, parts = [], area = null) {
  const m = nameSep(text);
  // "1. Great Room" with its details nested under it: the line is just the name
  if (!m && parts.length === 0 && text.split(/\s+/).length <= 5 && !/\d{2}|\b(stereo|mono|surround|soundbar|atmos|speakers?|tv|projector|landscape|channel)\b/i.test(text) &&
      (new RegExp(`^(?:the\\s+)?${ROOM_PHRASE.source}$`, "i").test(text.trim()) || /^[\w'’ -]{1,24}\s+room$/i.test(text.trim()) || /^(master|primary|family|guest|great|living|media|game|bonus)(\s+\w+)?$/i.test(text.trim())))
    return { name: text, parts: [], area, bare: true };
  if (!m) return { name: "", parts: [text, ...parts], area };
  const np = nameAndParens(m[1]);
  return { name: np.name, parts: [...np.parts, ...(m[2] ? [m[2]] : []), ...parts], area };
}
const RACK_WORDS = /\b(equipment|head[- ]?end|gear|hardware|electronics|bill of materials|bom|av closet|mechanical)\b/i;
const H_FLOOR_STRICT = /\b(floor|level|upstairs|downstairs|exterior|outdoors?|outside|wing|grounds)\b/i;
const metaKey = t => /^(job|project|job name|project name|client|customer|owner|homeowner|address|site|platform|control|control system|control platform|automation|prepared by|drawn by|designer|date|prepared for|phone|email|quote|proposal|budget|estimate)$/i.test(t);
// sub-heading rooms keep collecting their lines
const looksLikeRoom = t => /\b(room|bed(room)?|bath|kitchen|dining|living|family|great|den|office|study|library|theater|theatre|media|cinema|gym|patio|deck|pool|spa|lounge|bar|game|play|kids?|nursery|guest|master|primary|suite|loft|garage|entry|foyer|hall|wine|cellar|basement|yard|backyard|front ?yard|lanai|porch|terrace|balcony|court|outdoor|bonus|flex|mud|laundry|nook|sunroom|conservatory|studio|workshop|closet|attic)\b/i.test(t);
// a line that opens with a room ("kitchen stereo", "master 65 sony") rather than describing one ("Guest viewing capability")
const startsRoom = t => { const x = String(t).replace(/^(?:the|our|your)\s+/i, ""); ROOM_PHRASE.lastIndex = 0; const m = ROOM_PHRASE.exec(x); ROOM_PHRASE.lastIndex = 0;
  return (m && m.index === 0) || /^(master|primary|family|great|media|game|bonus|living|guest)\s+(\d|stereo|mono|surround|soundbar|tv|projector|\d\.\d)/i.test(x); };
// one room's name ("Family Room", "TV Room", "Primary Suite"), not a heading about rooms ("Rooms", "Room-by-Room", "AV Design")
const isRoomName = t => (looksLikeRoom(t) || /^[\w'’ -]{1,24}\s+room$/i.test(t.trim())) && t.trim().split(/\s+/).length <= 5 &&
  !/\b(guest ?house|pool ?house|casita|adu|wing|level|floor|upstairs|downstairs|cottage|barn|annex)\b/i.test(t) &&
  !/\b(rooms|zones|spaces|areas|room[- ]by[- ]room|by room|program|distributed|systems?|design|plan|scope|equipment|summary|overview|schedule|list)\b/i.test(t);
const looksLikeGear = t => findish(t) || TYPE_GUESS.some(([re]) => re.test(t));
let CAT_FOR_READ = null; const findish = t => !!(CAT_FOR_READ && matchProduct(CAT_FOR_READ, t));

function metaLine(meta, l) {
  const m = String(l).match(/^\s*["']?([\w ]+?)["']?\s*:\s*(.+?)\s*$/); if (!m) return false;
  const k = m[1].toLowerCase().trim(), v = plain(m[2].replace(/^["']|["']$/g, ""));
  if (!v) return false;
  if (/^(job|project|job name|project name|name|title)$/.test(k)) meta.name ??= v;
  else if (/^(client|customer|owner|homeowner|client name|customer name)$/.test(k)) meta.client ??= v;
  else if (/^(address|site|location|job site|site address)$/.test(k)) meta.address ??= v;
  else if (/^(platform|control|control system|control platform|automation|automation platform|automation system|system)$/.test(k)) meta.platform ??= v;
  else if (/^(format|generator|schema)$/.test(k)) meta.format ??= v;
  else if (/^(prepared by|drawn by|designer|author)$/.test(k)) meta.by ??= v;
  else if (/^(date|prepared for|phone|email|e-mail|prepared|revision|rev|version|quote|quote #|proposal|proposal #|sales ?rep|salesperson|budget|total|estimate)$/.test(k)) meta.other ??= v;
  else return false;
  return true;
}

function tableRow(out, section, head, cells, area) {
  const col = re => head.findIndex(h => re.test(h));
  const get = i => i >= 0 ? cells[i] || "" : "";
  const roomCol = col(/^(room|zone|space|location|area|name|room name)s?$|room|zone/);
  const isGear = section === "rack" || (section !== "rooms" && roomCol < 0 && col(/model|product|part|sku|item|description|equipment/) >= 0);
  if (isGear) {
    const qty = get(col(/^(qty|quantity|count|#|units?|qnty)$/));
    const brand = get(col(/brand|manufacturer|mfr|make|maker|vendor/));
    const pick = (...res) => { for (const re of res) { const i = col(re); if (i >= 0) return i; } return -1; };
    const model = get(pick(/^model/, /model|part|sku/, /product|item/, /equipment|device/)) || get(col(/description|name/));
    const type = get(col(/type|category|kind|role|function|purpose/));
    const loc = get(col(/location|room|rack/));
    const text = [qty && /^\d+$/.test(qty.trim()) ? `${qty} x` : "", brand, model, type ? `(${type})` : ""].filter(Boolean).join(" ");
    if (noMoney(text).replace(/\d+ x/, "").trim()) out.gear.push({ text, loc, table: true });
    return;
  }
  if (section !== "rooms" && roomCol < 0) return;
  const name = get(roomCol >= 0 ? roomCol : 0);
  const keep = new Set([roomCol >= 0 ? roomCol : 0]);
  const spkI = col(/speaker|audio|sound|system|config|channels?|setup/), tvI = col(/^tv|tv|display|screen|video|size/), brI = col(/brand|make/);
  const flI = col(/floor|level/), scI = col(/scope|status|notes?|owner|ofe|prewire|comments?|remarks?/);
  const szI = head.findIndex((h, i) => i !== tvI && /^size|size|inch|diag/.test(h));
  const parts = [get(spkI), get(tvI), get(brI), notesWords(get(scI))];
  if (szI >= 0 && /\d{2,3}/.test(get(szI))) parts.push(`${get(szI).match(/\d{2,3}/)[0]} inch`);
  // a TV column with only a number is a size; "yes"/"no" means there is / isn't one
  if (tvI >= 0 && /^\s*(no|none|n\/a|-|—|–)\s*$/i.test(get(tvI))) parts[1] = "no tv";
  if (tvI >= 0 && /^\s*\d{2,3}\s*$/.test(get(tvI))) parts[1] = `${get(tvI).trim()} inch tv`;
  if (spkI >= 0 && /^\s*(no|none|n\/a|-|—|–)\s*$/i.test(get(spkI))) parts[0] = "no speakers";
  const other = head.map((h, i) => i).filter(i => ![roomCol, spkI, tvI, brI, flI, scI, szI, 0].includes(i) || (i === 0 && roomCol > 0)).filter(i => !keep.has(i));
  for (const i of other) parts.push(notesWords(get(i)));
  if (!name || /^(total|subtotal)$/i.test(name)) return;
  out.rooms.push({ name, parts: parts.filter(Boolean), area: get(flI) || area, table: true });
}
// from a notes column, only the words that change the design
// a room's "Label: value" line → the words that matter ("TV: None" = no TV; a long Notes line only keeps owner/brand words —
// "future prewire for surround expansion" in a note is not a future pre-wire room)
const NONE = /^\s*(none|no|n\/a|na|-|—|–|tbd|nothing)\.?\s*$/i;
function partText(p) {
  const m = String(p).match(/^\s*(speakers?|audio|sound|system|setup|tv|display|screen|video|projector|notes?|comments?|details?|remarks?|brand|scope|status|size|owner)\s*:\s*(.*)$/i);
  if (!m) return p;
  const k = m[1].toLowerCase(), v = m[2];
  if (/^(tv|display|screen|video|projector)$/.test(k)) return NONE.test(v) ? "no tv" : /^\s*\d{2,3}\s*$/.test(v) ? `${v.trim()} ${k === "projector" ? "projector" : "tv"}` : `${v}${k === "projector" ? " projector" : ""}`;
  if (/^(speakers?|audio|sound|system|setup)$/.test(k)) return NONE.test(v) ? "no speakers" : v;
  if (/^(notes?|comments?|details?|remarks?)$/.test(k)) return notesWords(v);
  return v;
}
const notesWords = v => String(v).trim().split(/\s+/).length <= 3 ? keywordsOnly(v)
  : (String(v).match(/\b(sony|samsung|lg|tcl|vizio|hisense|panasonic|sharp|seura|sunbrite|ofe|owner[- ]?(?:furnished|supplied|provided)|customer[- ]?(?:supplied|provided)|existing)\b/gi) || []).join(" ");
const keywordsOnly = s => (String(s).match(/\b(sony|samsung|lg|tcl|vizio|hisense|panasonic|sharp|seura|sunbrite|c[- ]seed|ofe|owner[- ]?(furnished|supplied|provided)|customer[- ]?(supplied|provided)|existing|re-?use|prewire|pre-wire|future|local|apps|avr|dante|bullet|matrix|projector)\b/gi) || []).join(" ");

/* ---------- gear: a line → a catalog product (or a typed box) ---------- */
export function matchProduct(catalog, line) {
  const t = noMoney(line).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const tries = [t, t.split(/\s+(?:—|–|-|:|\bfor\b|\bto\b|\bin\b|\bwith\b|\bat\b)\s+/i)[0]];
  const words = t.split(/\s+/);
  for (let n = Math.min(6, words.length); n >= 1; n--)
    for (let i = 0; i + n <= words.length; i++) {
      const w = words.slice(i, i + n).join(" "), c = w.replace(/[^A-Za-z0-9]/g, "");
      if ((c.length >= 4 && /\d/.test(c) && /[A-Za-z]/.test(c)) || /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+){2,}$/.test(w)) tries.push(w);   // model-number-ish
      else if (n >= 2 && c.length >= 6) tries.push(w);
    }
  const cx = x => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const modelish = x => { const c = cx(x); return (c.length >= 4 && /\d/.test(c) && /[a-z]/.test(c)) || (/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+){2,}$/.test(String(x).trim()) && c.length >= 8); };
  const names = c => [productName(c), c.partNo, c.model, ...(c.aliases || [])].filter(Boolean).map(cx).filter(n => n.length >= 3);
  for (const x of tries) {
    const ref = findProduct(catalog, x); if (!ref) continue;
    // "AVPro Edge" alone must not pick an AVPro product: without a model number, the line has to name the whole product
    if (modelish(x) || names(catalog.devices[ref]).some(n => cx(t).includes(n))) return ref;
  }
  return null;
}
/* a part number one or two characters off a catalog one (an AI's "AC-MXNET-1G-SW8P" for AC-MXNET-SW8P) */
export function nearProduct(catalog, line) {
  const cx = x => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const toks = noMoney(line).split(/\s+/).map(cx).filter(c => c.length >= 6 && /\d/.test(c) && /[a-z]/.test(c));
  let best = null;
  for (const [id, c] of Object.entries(catalog?.devices || {})) for (const n of [c.partNo, c.model].filter(Boolean).map(cx)) {
    if (n.length < 6) continue;
    for (const tk of toks) {
      if (tk.slice(0, 3) !== n.slice(0, 3)) continue;
      const d = lev(tk, n), lim = n.length >= 10 ? 3 : 2;
      if (d <= lim && (!best || d < best.d)) best = { id, d, tie: false };
      else if (best && d === best.d && best.id !== id) best.tie = true;
    }
  }
  return best && !best.tie ? best.id : null;
}
function lev(a, b) {
  const m = a.length, n = b.length; if (Math.abs(m - n) > 3) return 99;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
export function gearLine(catalog, text0) {
  let text = text0;
  // "1 | Synergy | Unspecified Rack | Apple TV 4K": the placeholder's last column names the box
  const cols = String(text).split("|").map(x => x.trim());
  if (cols.length >= 4 && /unspecified|placeholder/i.test(cols[2]) && cols[3]) text = `${cols[0]} x ${cols.slice(3).join(" ")}`;
  let t = noMoney(text).replace(/\s*\|\s*/g, " ").replace(/\(\s*[-–—,;:]?\s*\)/g, " ").replace(/\s+[-–—:]\s*$/, "").replace(/\s+/g, " ").trim();
  let qty = 1;
  const q = t.match(/^\s*(\d{1,3})\s*(?:x|×|pcs?\.?|ea\.?|units?)?\s+(?=\D)/i) || t.match(/\(\s*(?:qty|x|×)\s*:?\s*(\d{1,3})\s*\)/i) ||
    t.match(/\b(?:qty|quantity)\s*:?\s*(\d{1,3})\b/i) || t.match(/\s(?:x|×)\s*(\d{1,3})\s*$/i);
  if (q) { qty = Math.max(1, Math.min(24, +q[1])); t = t.replace(q[0], " ").trim(); }
  t = t.replace(/^[-–—:]\s*/, "").replace(/[-–—:,;.]+$/, "").replace(/\batv\s*4k\b|\batv4ks?\b|\batvs?\b/gi, "Apple TV 4K").replace(/\bmdx\s*-?\s*(8|16)\b/gi, (m, n) => `MDX-${n}`).trim();
  if (/^synergy\b/i.test(t)) return { skip: t };                         // Synergy's own items (pre-wire, interconnect) aren't boxes
  if (/^customer[- ]supplied\b/i.test(t)) return { ofe: t.replace(/^customer[- ]supplied\s*/i, "") || "Equipment" };
  const ref = matchProduct(catalog, t);
  if (ref && !TYPE_NAME[catalog.devices[ref].type]) return { auto: productName(catalog.devices[ref]) };   // an encoder, decoder, balun, cable, rack kit
  if (ref) return { qty, ref, name: productName(catalog.devices[ref]) };
  const near = nearProduct(catalog, t);
  if (near && !TYPE_NAME[catalog.devices[near].type]) return { auto: productName(catalog.devices[near]) };
  if (near) return { qty, ref: near, name: productName(catalog.devices[near]), near: t };
  if (RACK_ITSELF.test(t) && !TYPE_GUESS.some(([re, ty]) => ty !== "power" && re.test(t))) return { rack: t };
  if (NOT_RACK.test(t) && !TYPE_GUESS.some(([re]) => re.test(t))) return { skip: t };
  const type = TYPE_GUESS.find(([re]) => re.test(t))?.[1];
  if (!type) return { unknown: t };
  const name = t.split(/\s+(?:—|–|-|:|\bfor\b)\s+|\s*\(/i)[0].replace(/\s+(receiver|amplifier|amp|switch|box)$/i, (m, w) => /amp|receiver/i.test(w) ? m : m).slice(0, 60).trim();
  return { qty, type, name };
}

/* ---------- building: rooms + gear → commands → a job ---------- */
const roomText = r => {
  const name = noMoney(plain(r.name)).replace(/[,;]+/g, " ").replace(/\s+/g, " ").trim();
  const rest = r.parts.map(p => noMoney(plain(p))).join(" ").replace(/[,;]+/g, " ").replace(/\s+/g, " ").trim();
  return { name, rest };
};
export function importMarkdown(text, catalog) {
  CAT_FOR_READ = catalog;
  let doc;
  try { doc = readMarkdown(text); } finally { CAT_FOR_READ = null; }
  const notes = [], warnings = [], unmapped = [];
  // 1. JSON inside: a whole job / survey / takeoff wins (the last one that reads, the AI review's source block)
  const parsed = doc.fences.filter(f => !f.lang || /json|javascript|js|text/.test(f.lang)).map(f => looseJSON(f.body)).filter(v => v !== undefined);
  const whole = [...parsed].reverse().find(v => v && typeof v === "object" && !Array.isArray(v) && (v.generator === "SignalPath" || v.generator === "Blueprinted" || (Array.isArray(v.rooms) && v.rack)));
  const cmdLists = parsed.flatMap(v => Array.isArray(v) && v.length && v.every(c => c && typeof c === "object" && c.op) ? [v]
    : v && !Array.isArray(v) && Array.isArray(v.commands) ? [v.commands] : []);
  if (whole) {
    const res = importAny(structuredClone(whole));
    res.warnings = [...(res.warnings || [])]; res.notes = [...(res.notes || [])];
    // an AI that reviewed the job and answered with a command list: its changes run on the job, like ✦ AI's
    if (cmdLists.length && res.kind === "signalpath") {
      const plan = planCommands(res.job, 0, cmdLists.flat(), catalog);
      res.job = plan.job;
      const ok = plan.steps.filter(x => x.ok);
      res.notes.push(`${ok.length} of ${plan.steps.length} changes from the file applied${ok.length ? `: ${ok.map(x => x.text).slice(0, 6).join("; ")}${ok.length > 6 ? "…" : ""}` : ""}`);
      for (const x of plan.steps.filter(x => !x.ok)) res.warnings.push(`Change not applied — ${JSON.stringify(x.cmd)}: ${x.error}`);
    } else if (doc.rooms.length || doc.gear.length)
      res.warnings.push("The job came from the data block at the end of this file — edits written in the text above it aren't read. To change it, have the AI add a command list (```json {\"commands\": [...]}```) or edit the data block.");
    return { ...res, markdown: true };
  }
  // 2. the job: front matter / "Client:" lines
  const m = doc.meta;
  const job = skeletonJob(m.name || "Imported Job", m.client, m.address);
  job.job.revisions[0].description = "Imported from Markdown";
  if (m.platform) { const p = String(m.platform).toLowerCase(); const plat = /savant/.test(p) ? "savant" : /control ?4|c4/.test(p) ? "control4" : /josh/.test(p) ? "josh" : /crestron/.test(p) ? "crestron" : null; if (plat) job.solutions[0].platforms = [plat]; }
  const cmds = [], gearNote = [], autoNote = [], ofeNote = [];
  // racks the file names: the first names the main rack, each other one is a rack of its own (a pool house)
  const rackNames = [...new Set(doc.gear.map(g => g.rack).filter(Boolean))];
  if (rackNames[0]) job.solutions[0].racks[0].name = rackNames[0];
  rackNames.slice(1).forEach((n, k) => job.solutions[0].racks.push({ id: `rack-${k + 2}`, name: n, devices: [] }));
  const rackIdOf = n => n ? job.solutions[0].racks.find(r => r.name === n)?.id : undefined;
  // 3. gear first, so the rooms wire to it
  for (const g of doc.gear) {
    const r = gearLine(catalog, g.text), rackId = rackIdOf(g.rack);
    if (r.ref) { for (let k = 0; k < r.qty; k++) cmds.push({ op: "add_device", product: r.ref, _rack: rackId });
      if (r.near) warnings.push(`“${r.near}” isn't a catalog part — read as ${r.name}; check it`); }
    else if (r.type) { for (let k = 0; k < r.qty; k++) cmds.push({ op: "add_device", product: r.name, type: r.type, _rack: rackId }); if (!findProduct(catalog, r.name)) gearNote.push(r.name); }
    else if (r.auto) autoNote.push(r.auto);
    else if (r.ofe) ofeNote.push(r.ofe);
    else if (r.rack) notes.push(`Rack: “${r.rack}” — set the rack size on the Rack page`);
    else if (r.skip) unmapped.push(`not rack gear: ${r.skip}`);
    else unmapped.push(`gear not recognized: ${r.unknown}`);
  }
  if (autoNote.length) notes.push(`Left out — SignalPath adds these where they're needed: ${[...new Set(autoNote)].join(", ")}`);
  if (ofeNote.length) warnings.push(`Owner-supplied gear in the rack with no model (${ofeNote.join(", ")}) — add it on the Rack page if it matters`);
  if (gearNote.length) warnings.push(`Not in the catalog, added by type — link them to a product when you can: ${[...new Set(gearNote)].join(", ")}`);
  // 4. run it — the same runner as quick-add and ✦ AI. Gear first (so the rooms wire to it), then
  // one room at a time, so each room's name (as written) and floor land on the room it made
  let cur = job;
  const run = (cmd0, label) => {
    const { _rack, ...cmd } = cmd0;
    const plan = planCommands(cur, 0, [cmd], catalog);
    const st = plan.steps[0];
    if (st?.ok) {
      const had = new Set(cur.house.zones.map(z => z.id));
      if (_rack) {                                                          // add_device puts it in the first rack: move it to its own
        const before = new Set(cur.solutions[0].racks.flatMap(r => r.devices.map(d => d.id)));
        const s2 = plan.job.solutions[0], main = s2.racks[0], dest = s2.racks.find(r => r.id === _rack);
        if (dest && dest !== main) for (const d of main.devices.filter(d => !before.has(d.id))) { main.devices = main.devices.filter(x => x !== d); dest.devices.push(d); }
      }
      cur = plan.job; return cur.house.zones.filter(z => !had.has(z.id));
    }
    warnings.push(`${label}: ${st?.error || "couldn't add it"}`); return null;
  };
  let boxes = 0;
  let roomsIn = doc.rooms.length ? doc.rooms : (doc.loose || []).map(l => ({ name: "", parts: [l.text] }));
  // no structure at all (tech shorthand, an email): read it line by line / sentence by sentence
  if (!roomsIn.length && doc.prose?.length) {
    const pr = readProse(doc.prose.map(p => /\u0001/.test(p.raw || "") ? p.raw.replace(/\s*\u0001\s*/g, "    ") : p.text));
    roomsIn = pr.rooms;
    if (!doc.gear.length) for (const g of pr.gear) { const r = gearLine(catalog, g), rackId = undefined;
      if (r.ref) for (let k = 0; k < r.qty; k++) cmds.push({ op: "add_device", product: r.ref });
      else if (r.type) { for (let k = 0; k < r.qty; k++) cmds.push({ op: "add_device", product: r.name, type: r.type }); if (!findProduct(catalog, r.name)) gearNote.push(r.name); }
      else if (r.unknown) unmapped.push(`gear not recognized: ${r.unknown}`); }
    if (roomsIn.length) notes.push("No headings or lists in this text — read it sentence by sentence; check each room");
  }
  for (const r of roomsIn) for (const g of pqRoom(r.parts || [])?.gear || []) { const x = gearLine(catalog, g); if (x.ref) for (let k = 0; k < x.qty; k++) cmds.push({ op: "add_device", product: x.ref }); }
  for (const c of cmds) if (run(c, c.product)) boxes++;
  let rooms = 0;
  const areaId = name => {
    if (!name) return null;
    let a = cur.house.areas.find(x => x.name.toLowerCase() === String(name).toLowerCase());
    if (!a) { a = { id: `area-${cur.house.areas.length + 1}`, name: String(name) }; cur.house.areas.push(a); }
    return a.id;
  };
  // the biggest surround rooms are wired first, so a receiver the file lists goes to the room it was
  // bought for (an MRX 1140 to the 7.1.4 theater, not the 5.1 living room); the file's order comes back after
  const RANK = { "surround-7.1.4": 3, "surround-7.1": 2, "surround-5.1": 1 };
  roomsIn = roomsIn.flatMap(r => { const m = String(r.name || "").match(/^(.+?)\s+(?:\+|&)\s+(.+)$/);
    return m && looksLikeRoom(m[1]) && looksLikeRoom(m[2]) ? [{ ...r, name: m[1] }, { ...r, name: m[2], parts: [...r.parts] }] : [r]; });
  for (const r of roomsIn) r.parts = (r.parts || []).filter(p => { const m = String(p).match(/^\s*(?:location|floor|level)\s*:\s*(.{1,40})$/i); if (m) { r.area ||= m[1].trim(); return false; } return true; });
  const prepped = roomsIn.map((r, order) => {
    const pq = pqRoom(r.parts);                                           // a PlanQueue room: "- 5 | Synergy | Unspecified Speakers"
    const name = cleanName(r.name), rest = (pq ? [pq.text, ...pq.other] : r.parts).map(p => partText(noMoney(plain(p)))).join(" ").replace(/[,;]+/g, " ").replace(/\s+/g, " ").trim();
    r.pq = pq;
    let rank = 0; try { rank = RANK[parseQuickZone(`${name} ${rest}`).zone.endpoints.find(e => e.type === "speakers")?.config] || 0; } catch {}
    return { r, name, rest, order, rank };
  }).sort((a, b) => b.rank - a.rank || a.order - b.order);
  const orderOf = new Map();
  for (const { r, name, rest, order } of prepped) {
    if (!name && !rest) continue;
    let made;
    if (!name) {
      // no name of its own: the quick-add reader splits it (a loose line can hold several rooms)
      made = parseQuick(rest).some(p => !p.empty) ? run({ op: "add_zones", text: rest }, rest.slice(0, 60)) : null;
      if (!made) { unmapped.push(`not read as a room: ${rest.slice(0, 120)}`); continue; }
    } else {
      const p = rest ? parseQuickZone(`${name} ${rest}`) : null;
      if (p && !p.empty) made = run({ op: "add_zones", text: `${name} ${rest}` }, name);
      if ((!made || !made.length) && r.prose && !looksLikeRoom(name)) { unmapped.push(`not read as a room: ${(name + " " + rest).trim().slice(0, 120)}`); continue; }
      if (!made || !made.length) {
        // a room listed with nothing readable in it: keep the room (a walk lists rooms before gear)
        const id = freeZoneId(cur, name);
        const z = { id, name, scope: /\bprewire|pre-wire\b/i.test(rest) ? "prewire" : /\bfuture\b/i.test(rest) ? "future" : "included", endpoints: [],
          note: rest ? `from the file: “${rest.slice(0, 100)}” — not read as gear` : "listed with no gear — fill it in" };
        cur.house.zones.push(z); made = [z];
        if (rest) warnings.push(`${name}: couldn't read “${rest.slice(0, 80)}” — the room came in empty`);
      }
      if (made.length === 1) made[0].name = name;                         // the name as written, not what the reader kept
      if (r.pq && made.length === 1) {
        // a PlanQueue file has no TV sizes: the TV comes in at 65" flagged to confirm; owner gear per item
        for (const e of made[0].endpoints) {
          if (e.type === "display") { if (!r.pq.size) e.confirm = ["size"]; e.status = r.pq.tvOfe ? "ofe" : "new"; }
          if (e.type === "speakers") e.status = r.pq.spkOfe ? "ofe" : "new";
        }
        if (r.pq.tv && !r.pq.size) warnings.push(`${name}: TV size isn't in a PlanQueue file — drawn at 65", confirm it`);
      }
    }
    const aid = areaId(r.area);
    made.forEach((z, k) => { if (aid) z.area = aid; orderOf.set(z.id, order + k / 100); rooms++; });
  }
  cur.house.zones.sort((a, b) => (orderOf.get(a.id) ?? 1e9) - (orderOf.get(b.id) ?? 1e9));
  // notes that name a room: "pool deck prewire only", "customer provides master tv"
  for (const line of doc.noteLines || []) {
    const l = line.toLowerCase();
    const alias = n => [n, n.replace(/\bprimary\b/, "master"), n.replace(/\bmaster\b/, "primary")];
    const z = [...cur.house.zones].sort((a, b) => b.name.length - a.name.length).find(z => z.name.length >= 3 &&
      alias(z.name.toLowerCase()).some(n => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, c => "\\" + c)}\\b`).test(l)));
    if (!z) continue;
    const did = [];
    if (/\bpre-?wire\b/.test(l) && !/\bfuture\b.*\b(expansion|upgrade)\b/.test(l)) { z.scope = "prewire"; did.push("pre-wire"); }
    else if (/\bfuture\b/.test(l) && !/\b(expansion|upgrade|add)\b/.test(l)) { z.scope = "future"; did.push("future"); }
    if (/\b(customer|client|owner|homeowner)\s*(provides?|providing|supplies?|supplying|supplied|provided|furnish(?:es|ed|ing)?|owns)\b|\bofe\b|\bexisting\b/.test(l)) {
      const which = /\b(tv|display|screen|television|projector)\b/.test(l) ? ["display"] : /\bspeakers?\b/.test(l) ? ["speakers"] : ["display", "speakers"];
      for (const e of z.endpoints) if (which.includes(e.type)) { e.status = "ofe"; did.push(`${e.type === "display" ? "TV" : "speakers"} owner-supplied`); }
    }
    if (did.length) notes.push(`${z.name}: ${did.join(", ")} — from the note “${line.slice(0, 80)}”`);
  }
  if (cmdLists.length) for (const c of cmdLists.flat()) { const z = run(c, c.op); if (z) rooms += z.length; }
  if (cur.house.areas.length === 1) { for (const z of cur.house.zones) delete z.area; cur.house.areas = []; }   // one floor = no floors
  if (!rooms && !boxes) throw new Error("Nothing in that Markdown could be added — see Export → Design brief for an AI for the format.");
  notes.unshift(`Read from Markdown: ${cur.house.zones.length} room${cur.house.zones.length === 1 ? "" : "s"}, ${boxes} rack box${boxes === 1 ? "" : "es"}${cmdLists.length ? `, ${cmdLists.flat().length} commands` : ""} — wired the way quick-add would`);
  if (doc.skipped.length) notes.push(`Not read (not rooms or gear): ${doc.skipped.slice(0, 8).join(", ")}${doc.skipped.length > 8 ? "…" : ""}`);
  return { kind: "markdown", job: cur, notes, warnings, unmapped, counts: { rooms, boxes } };
}
/* text with no structure: a tech's shorthand lines ("master 77 samsung 5.1") go to the quick-add reader as they
   are; sentences ("In the great room we'll install a 7.1 system with an 85-inch Sony") give a room by its name
   and the specs around it; a sentence about the rack gives its list of gear */
const ROOM_MOD = "(?:great|primary|master|guest|home|kids?'?|kid's|children's|family|media|game|rec|recreation|living|dining|sun|bonus|play|music|wine|exercise|fitness|back|front|pool|outdoor|main|upper|lower|second|2nd|third|3rd|junior|jr|mud|powder|laundry|tv|bed|movie|screening|billiards?|card|craft|hobby|in-law|nanny|au pair|man|club|party|great)";
const ROOM_NOUN = "(?:room|bedroom|bed|bath(?:room)?|kitchen|dining|den|office|study|library|theater|theatre|cinema|gym|patio|deck|pool(?:\\s+area)?|spa|lounge|bar|nursery|suite|loft|garage|entry|foyer|basement|lanai|porch|terrace|balcony|court|yard|backyard|casita|cabana|gazebo|courtyard|veranda|sunroom|studio|workshop|closet|attic|hallway|hall)";
const ROOM_PHRASE = new RegExp(`\\b((?:${ROOM_MOD}\\s+){0,2}${ROOM_NOUN}(?:\\s+(?:#?\\d{1,2}|one|two|three))?)\\b`, "gi");
const SENTENCE = /\b(we'?ll|we are|we're|will|would|gets?|getting|has|have|having|install(?:ing)?|putting|put|designed|going|includes?|including|features?|recommend|specif(?:y|ying)|there'?s|is|are)\b/i;
// a line that's just gear models → its boxes ("ATV4K x2" stays together); null if it isn't one
function gearTokens(t) {
  const toks = String(t).trim().split(/\s+/);
  if (toks.length < 3) return null;
  const gearish = toks.filter(w => (/\d/.test(w) && /[a-z]/i.test(w) && !/^\d{2,3}("|''|in|inch)?$/i.test(w)) || /^(wattbox|sonos|netgear|unifi|mxnet|atv4k|kaleidescape|savant|directv|araknis|pakedge)$/i.test(w) || /^x\d+$/i.test(w)).length;
  ROOM_PHRASE.lastIndex = 0;
  if (gearish / toks.length < 0.6 || ROOM_PHRASE.test(t) || /\b(stereo|surround|soundbar|speakers?|tv|projector)\b/i.test(t)) { ROOM_PHRASE.lastIndex = 0; return null; }
  ROOM_PHRASE.lastIndex = 0;
  const out = [];
  for (let k = 0; k < toks.length; k++) { if (/^x\d+$/i.test(toks[k + 1] || "")) { out.push(`${toks[k]} ${toks[k + 1]}`); k++; } else if (!/^x\d+$/i.test(toks[k])) out.push(toks[k]); }
  return out;
}
export function readProse(lines) {
  const rooms = [], gear = [];
  for (const line of lines) {
    const t = String(line).trim(); if (!t) continue;
    const words = t.split(/\s+/).length;
    if (words <= 14 && !SENTENCE.test(t) && !/[.!?]\s+\S/.test(t)) {          // shorthand: one or more rooms, quick-add style
      if (/^(hi|hello|hey|thanks|thank you|best|regards|cheers|sincerely)\b/i.test(t)) continue;
      if (gearTokens(t)) { gear.push(...gearTokens(t)); continue; }
      rooms.push({ ...splitRoom(columns(t)), prose: true }); continue;
    }
    for (const sen of t.split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)) {
      const gearCue = /^\W*(?:(?:for|in|on|inside)\s+)?(?:the\s+)?(?:main\s+)?(?:rack|equipment(?:\s+rack)?|head[- ]?end)\b/i.test(sen);
      if (gearCue || (/\b(rack|equipment|head[- ]?end)\b/i.test(sen) && !ROOM_PHRASE.test(sen.replace(/\brack\s+room\b/i, "")))) {
        // "For the rack, we're specifying an Anthem MRX 1140 receiver, two Apple TV 4K boxes, …"
        const list = sen.replace(/^.*?\b(?:specifying|specify|spec(?:ing)?|includes?|including|is|are|will be|we'?ll (?:use|install|put in)|use|recommend(?:ing)?|needs?|has|have|gets?|:)\s+/i, "");
        for (const g of splitList(list)) gear.push(g.replace(/\b(two|three|four|five|six)\b/i, m => String({ two: 2, three: 3, four: 4, five: 5, six: 6 }[m.toLowerCase()]) + " x").replace(/\s+(?:for|to|as)\s+.*$/i, ""));
        ROOM_PHRASE.lastIndex = 0; continue;
      }
      ROOM_PHRASE.lastIndex = 0;
      const hits = [...sen.matchAll(ROOM_PHRASE)];
      if (!hits.length) continue;
      // "The kitchen and dining room get stereo": every room named before the first spec shares it
      const firstSpec = sen.search(/\d|\b(stereo|mono|surround|soundbar|atmos|speakers?|landscape|projector|tv|channel)\b/i);
      const named = [hits[0]];
      for (let k = 1; k < hits.length; k++) {
        const between = sen.slice(hits[k - 1].index + hits[k - 1][0].length, hits[k].index);
        if ((firstSpec < 0 || hits[k].index < firstSpec) && /^\s*(?:,|and|&|,\s*and|plus)\s*(?:the\s+)?$/i.test(between)) named.push(hits[k]); else break;
      }
      let rest = sen;
      for (const h of named) rest = rest.replace(h[0], " ");
      for (const h of named) rooms.push({ name: h[1].replace(/^(?:the|a|an|our|your)\s+/i, ""), parts: [rest], prose: true });
    }
  }
  return { rooms, gear };
}

/* a PlanQueue room's lines → the quick-add words for it (the reverse of the PlanQueue export) */
export function pqRoom(parts) {
  const items = [], other = [];
  for (const p of parts) {
    const c = String(p).split("|").map(x => x.trim());
    if (c.length >= 3 && /^\d{1,3}$/.test(c[0])) items.push({ qty: +c[0], mfr: c[1], model: c[2], extra: c.slice(3).join(" ") });
    else other.push(p);
  }
  for (const it of items) if (it.extra) other.push(it.extra);              // "| 5.1 surround", "| Samsung 75\"": what the line says it is
  if (!items.length) return null;
  const words = [];
  const isCust = it => /customer[- ]supplied/i.test(it.mfr);
  const spk = items.filter(it => /speakers?|subwoofer|\bsub\b|soundbar/i.test(it.model) && !/^prewire/i.test(it.model));
  const pre = items.filter(it => /^prewire/i.test(it.model));
  const tvs = items.filter(it => /\btv\b|television|display|projector/i.test(it.model) && !/^prewire/i.test(it.model));
  let spkOfe = false, tvOfe = false, size = null;
  if (spk.length) {
    const bar = spk.find(it => /soundbar/i.test(it.model)), sub = spk.filter(it => /sub/i.test(it.model)), main = spk.filter(it => !/sub|soundbar/i.test(it.model));
    // the export writes the sub as a second "Unspecified Speakers" line: [main, sub]
    let n = main[0]?.qty || 0, subs = sub.reduce((a, it) => a + it.qty, 0) + (main.length > 1 ? main.slice(1).reduce((a, it) => a + it.qty, 0) : 0);
    if (bar) words.push(subs ? "soundbar with sub" : "soundbar");
    else if (n === 5 && subs) words.push("5.1"); else if (n === 7 && subs) words.push("7.1"); else if (n === 11 && subs) words.push("7.1.4");
    else if (n === 2 && subs) words.push("2.1"); else if (n === 1 && !subs) words.push("mono"); else if (n) words.push(`${n} speakers`);
    spkOfe = spk.every(isCust);
  }
  for (const it of pre) {
    const m = it.model;
    if (/5\.1/.test(m)) words.push("5.1"); else if (/7\.2\.4|atmos/i.test(m)) words.push("7.1.4"); else if (/7\.1/.test(m)) words.push("7.1");
    else if (/landscape speakers/i.test(m)) words.push(`landscape ${it.qty}`); else if (/speaker pair/i.test(m)) words.push(`${it.qty * 2} speakers`);
    else if (/speaker single/i.test(m) && !words.some(w => /speakers|5\.1|7\.1/.test(w))) words.push(`${it.qty} speakers`);
    else if (/passive soundbar/i.test(m)) words.push("soundbar");
    else if (/\btv\b/i.test(m)) tvs.push({ qty: 1, mfr: "Synergy", model: "TV" });
  }
  if (pre.length) words.push("prewire");
  if (tvs.length) {
    const t = tvs[0], s = `${t.model} ${t.extra || ""}`.match(/\b(\d{2,3})(?=\D|$)/);
    size = s && +s[1] >= 32 && +s[1] <= 150 ? +s[1] : null;
    words.push(/projector/i.test(t.model) ? `projector ${size || 120}` : `${size || 65} tv`);
    if (!/^(synergy|unspecified|customer)/i.test(t.mfr) && BRANDISH.test(t.mfr)) words.push(t.mfr);
    tvOfe = isCust(t);
  }
  // rack gear written under a room ("1 | Synergy | Unspecified Rack | Anthem MRX 1140"): it goes in the rack
  const gear = items.filter(it => /unspecified rack|^rack$/i.test(it.model) && it.extra).map(it => `${it.qty} x ${it.extra}`);
  if (items.some(it => /apple ?tv/i.test(it.model))) words.push("local");
  if (items.some(it => /savant/i.test(it.mfr) && /remote/i.test(it.model))) words.push("savant remote");
  if (!spk.length && !pre.some(it => /speaker|surround|landscape|soundbar/i.test(it.model))) words.push("no speakers");
  return { text: words.join(" "), other: other.filter(o => !items.some(it => /unspecified rack|^rack$/i.test(it.model) && it.extra === o)), tv: tvs.length > 0, size, tvOfe, spkOfe, gear };
}
const BRANDISH = /^(sony|samsung|lg|tcl|vizio|hisense|panasonic|sharp|seura|sunbrite|c seed|epson|jvc)$/i;
// a room's name as written: no prices, no list punctuation, no trailing colon; all-lowercase gets capitals
const cleanName = n => { let t = noMoney(plain(n)).replace(/[,;:]+$/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  return t && t === t.toLowerCase() ? t.replace(/\b[a-z]/g, c => c.toUpperCase()) : t; };
const freeZoneId = (job, name) => { const b = "z-" + (String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "room"); let id = b, n = 2;
  const taken = new Set(job.house.zones.flatMap(z => [z.id, ...(z.endpoints || []).map(e => e.id)])); while (taken.has(id)) id = `${b}-${n++}`; return id; };
const titleish = s => String(s).replace(/\b\w/g, c => c.toUpperCase());

/* JSON the way AIs actually write it: comments, trailing commas, smart quotes, single quotes on keys */
export function looseJSON(s) {
  let t = String(s ?? "").trim();
  if (!t) return undefined;
  try { return JSON.parse(t); } catch {}
  t = t.replace(/^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)\s*)+/, "");      // leading comment lines
  const at = t.search(/[[{]/); if (at < 0) return undefined; t = t.slice(at);
  let u = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str || "")
    .replace(/,\s*([}\]])/g, (m, b) => b)
    .replace(/([{,]\s*)'([^'\n]*)'\s*:/g, (m, a, k) => `${a}"${k}":`).replace(/([{,]\s*)([A-Za-z_][\w]*)\s*:/g, (m, a, k) => `${a}"${k}":`)
    .replace(/:\s*'([^'\n]*)'/g, (m, v) => `: ${JSON.stringify(v)}`);
  try { return JSON.parse(u); } catch { return undefined; }
}

/* ---------- the brief another AI (or a tech) writes to ---------- */
export function designBrief(catalog) {
  const byType = {};
  for (const c of Object.values(catalog?.devices || {})) if (c.type && !(c.flags || []).includes("legacy")) (byType[c.type] ||= []).push(productName(c));
  const list = Object.entries(byType).map(([t, l]) => `- ${t}: ${l.sort().join("; ")}`).join("\n");
  return `---
format: ${MD_FORMAT}
job: Smith Residence
client: John Smith
address: 123 Main St, Irvine CA
platform: Savant
---

# Smith Residence — AV design

<!-- How to write a design SignalPath can import. Keep the headings. One room per line.
     Rooms: name, then what's in it — speakers (stereo / 2.1 / 5.1 / 7.1 / 7.1.4 / soundbar / landscape 8 / 4 ceiling speakers),
     TV size + brand (75" Sony), "projector 120", and any of: prewire, future, OFE (owner supplies it), local (Apple TV at the TV),
     apps (the TV's own apps), avr (the room's own receiver feeds the TV).
     Rack: one box per line, "2 x" for more than one. Use the product names below where you can.
     No prices — SignalPath ignores them. -->

## Rooms

### Main Floor
- Family Room — 5.1 surround, 75" Sony
- Kitchen — stereo, 4 ceiling speakers
- Dining — stereo

### Upstairs
- Primary Bedroom — stereo, 65" Samsung
- Bedroom 2 — 55" TV, prewire

### Exterior
- Patio — landscape 8, 65" SunBrite
- Pool — stereo

## Rack
- Anthem MDX-16
- AVPro Edge AC-MXNET-SW8P
- 3 x Apple TV 4K
- WattBox WB-800VPS-IPVM-12

## Notes
Anything else goes here — SignalPath shows it as not read.

<!-- Catalog products (use these names):
${list}
-->
`;
}
