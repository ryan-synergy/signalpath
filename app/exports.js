/* ---------- exports.js — Markdown out ----------
   Two Markdown files from one job:
   1. planQueueFiles(): the PlanQueue proposal import, to Ryan's format sheet of
      2026-09-28 (planq-import-format.md): a front matter block holding ONLY
      `planqueue: proposal-import/1`, `# Project Title`, `## Room` headers, and
      `- qty | Manufacturer | Model` lines — no notes, tables, floors or prose,
      and no mandatory lines (EWR, PM fee, materials: added in PlanQueue).
      Everything a note used to say is said with PlanQueue's own items instead:
      owner/provider gear → Customer-Supplied (TV / Speakers / Soundbar /
      Subwoofer / Equipment); unpicked speakers → Synergy "Unspecified Speakers"
      with the count as qty (sub on its own line); a TV with no model → Synergy
      "Unspecified TV"; pre-wire rooms → Synergy's "Prewire - …" items. A job with
      pre-wire-only rooms still gives two files (systems + "— Pre-Wire").
   2. aiReviewMarkdown(): everything an agent needs to review the design —
      rooms and how each is fed, rack gear with specs and usage, open items,
      licensing, connections, wire list, the quote lines — and the full job as
      a ```json block at the end (SignalPath imports that block back).
   Pure: job + catalog in, text out. */

import { loadJob, validate, advise, effectiveJob, expandChannels } from "./engine.js";
import { wireRuns } from "./pages.js";
import { readHookup, bulletFor } from "./hookup.js";
import { vocabularyText } from "./commands.js";
import { NET_ROLE_NAME, companionSku } from "./network.js";
import { isAsBuilt, asBuiltChanges } from "./asbuilt.js";
import { describeNode, adapterName, isOutdoorZone, SPEAKER_SETUP, STATUS_NAME, SCOPE_NAME, PLATFORM_NAME, AUDIO_NET_NAME, signalName } from "./names.js";

// Synergy's own PlanQueue items (manufacturer "Synergy") — placeholders and pre-wire
const SYN = model => ({ mfr: "Synergy", model });
// [speakers, subs] a speaker set stands for
export function speakerCounts(ep) {
  const c = ep?.config || "stereo";
  if (c === "mono") return [1, 0];
  if (c === "stereo") return [Math.max(1, Math.floor(+ep.count) || 2), 0];
  if (c === "2.1") return [2, 1];
  const m = c.match(/^surround-(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (m) return [+m[1] + (+m[3] || 0), +m[2]];
  if (c === "soundbar") return [1, 0];
  if (c === "soundbar-sub") return [1, 1];
  if (c === "landscape") return [Math.max(1, Math.floor(+ep.satCount) || 8), ep.buriedSub ? 1 : 0];
  return [Math.max(1, Math.floor(+ep.count) || 2), 0];
}
// a pre-wire room's speakers as Synergy's pre-wire items: [item, qty]
export function prewireItems(ep, passiveBar = false) {
  const c = ep?.config || "stereo", [n, sub] = speakerCounts(ep);
  const pairs = (k, extraSingles = 0) => [...(Math.floor(k / 2) ? [["Prewire - Speaker Pair", Math.floor(k / 2)]] : []),
    ...(k % 2 + extraSingles ? [["Prewire - Speaker Single", k % 2 + extraSingles]] : [])];
  if (c === "surround-5.1") return [["Prewire - 5.1 Surround Sound", 1]];
  if (c === "surround-7.1") return [["Prewire - 7.1 Surround Sound", 1]];
  if (c === "surround-7.1.4") return [["Prewire - 7.2.4 Surround Sound (Atmos)", 1]];   // Synergy's Atmos pre-wire item
  if (c === "landscape") return [["Prewire - Landscape Speakers", n], ...(sub ? [["Prewire - Landscape Subwoofer", sub]] : [])];
  if (c.startsWith("soundbar")) return [...(passiveBar ? [["Prewire - Passive Soundbar (LCR)", 1]] : []), ...(sub ? [["Prewire - Speaker Single", sub]] : [])];   // a powered bar rides the TV pre-wire
  return pairs(n, sub);   // mono, stereo, 2.1 (pair + a single for the sub), anything else
}
const clean = s => String(s ?? "").replace(/\s*\|\s*/g, " / ").replace(/\s+/g, " ").trim();   // a "|" would split the line

/* ---------- what a box is, for the quote ---------- */
function fromCatalog(c) {
  // partNo is the PlanQueue SKU where PlanQueue carries the product (catalog synced to its 2026-09-28 export);
  // notInPlanQueue = the manufacturer's part number, which imports as a "needs SKU" line
  return { mfr: c.brand, model: c.partNo || c.model, unsure: !!c.partNoUnsure || !c.partNo, provider: !!c.provider, pqMissing: !!c.notInPlanQueue };
}
// brands spelled the way the manufacturer does, longest first so "AVPro Edge" beats "AVPro"
const BRANDS = ["James Loudspeaker", "Bowers & Wilkins", "AVPro Edge", "AudioControl", "Kaleidescape", "Josh.ai", "Control4", "Crestron",
  "Ubiquiti", "Sonance", "Savant", "Anthem", "Araknis", "Lutron", "Marantz", "McIntosh", "Pro-Ject", "Samsung", "Klipsch", "Yamaha",
  "Denon", "Triad", "Sonos", "Apple", "Epson", "Rega", "Luma", "Sony", "Roku", "JVC", "LG"].sort((a, b) => b.length - a.length);
const brandOf = m => BRANDS.find(b => new RegExp(`^${b.replace(/[.+&]/g, "\\$&")}\\b`, "i").test(m));
// gear with no catalog link: best guess from how it's named on the drawing
function guessProduct(d) {
  const raw = String(d.model || "").trim();
  const m = d.type === "source" ? raw.replace(/\s+\d+$/, "") : raw;   // numbered copies ("Apple TV 2") are one product; "Axion 8" is a model
  if (/apple\s*tv/i.test(m)) return { mfr: "Apple", model: "APPLE TV 4K 128", unsure: true };
  if (/cable/i.test(m)) return { mfr: "Cable Provider", model: "Cable Box", provider: true };
  if (/directv/i.test(m)) return { mfr: "DirecTV", model: "Receiver", provider: true };
  if (/dish/i.test(m)) return { mfr: "Dish", model: "Receiver", provider: true };
  if (/roku/i.test(m)) return { mfr: "Roku", model: "Ultra", unsure: true };
  const ax = m.match(/\baxion[\s-]*(4|8)\b/i);                  // AVPro's Axion matrix, as PlanQueue carries it
  if (ax) return { mfr: "AVPro Edge", model: `AC-AXION-${ax[1]}` };
  if (/kaleidescape/i.test(m)) return { mfr: "Kaleidescape", model: "K0701-0000", unsure: true };   // Strato V, the current player
  if (/xbox|playstation|ps5|nintendo|game/i.test(m)) return { mfr: "Unspecified", model: m || "Game Console", unsure: true };
  if (d.type === "avr" || /receiver/i.test(m)) return { mfr: "Unspecified", model: "AV Receiver", unsure: true };
  if (d.type === "amp") return { mfr: "Unspecified", model: "Amplifier", unsure: true };
  if (d.type === "avbSwitch") return { mfr: "Unspecified", model: "AVB Switch (Avnu-certified)", unsure: true };
  if (d.type === "networkSwitch") return { mfr: "Unspecified", model: "Network Switch", unsure: true };
  const b = brandOf(m);
  if (b) return { mfr: b, model: m.slice(b.length).trim() || m, unsure: true };
  return { mfr: "Unspecified", model: m || d.type, unsure: true };
}

/* ---------- walk the job into rooms of quote lines ---------- */
function quoteRooms(job, sol, catalog, adv) {
  const cat = id => catalog?.devices?.[id];
  const rooms = new Map();   // "floor\u0000room" → {floor, room, scope, lines: Map}
  const areaName = id => job.house.areas?.find(a => a.id === id)?.name;
  const floorOf = z => areaName(z.area) || (isOutdoorZone(z) ? "Exterior" : "Floor 1");
  // one line per product per room. The file carries no notes, so owner-supplied and
  // provider gear become PlanQueue's own Customer-Supplied items; `part` keeps a sub
  // on its own line even when it prints like the speakers
  const add = (floor, room, scope, p, { qty = 1, part = "", ofe = false } = {}) => {
    const k = floor + "\u0000" + room;
    if (!rooms.has(k)) rooms.set(k, { floor, room, scope, lines: new Map() });
    const line = ofe || p.provider ? { mfr: "Customer-Supplied", model: p.customer || "Equipment" } : { mfr: clean(p.mfr), model: clean(p.model) };
    const key = [line.mfr, line.model, part].join("|");
    const L = rooms.get(k).lines;
    if (L.has(key)) L.get(key).qty += qty; else L.set(key, { qty, ...line });
  };

  // the rack(s)
  for (const r of sol.racks || []) {
    const room = r.name || "Equipment Rack", floor = areaName(r.area) || "Floor 1";
    for (const d of r.devices || []) {
      const c = cat(d.catalogRef);
      add(floor, room, "included", c ? fromCatalog(c) : guessProduct(d), { ofe: d.status === "ofe" });
    }
    // adapters on rack gear ride in the rack: encoders on sources AND decoders feeding a receiver or amp
    // (2026-10-02: only encoders were listed, so an MXNet decoder into an MRX or MDX dropped off the quote
    // while the takeoff page counted it)
    for (const e of (sol.companions || []).filter(e => (r.devices || []).some(d => d.id === e.serves))) {
      const c = cat(companionSku(e, sol, catalog));
      add(floor, room, "included", fromCatalog(c));
    }
  }
  // the control platform's host/controller, as the licensing advisor picked it
  for (const lic of adv?.licensing || []) {
    if (!lic.pick || lic.solution !== sol.id) continue;
    const mfr = { savant: "Savant", josh: "Josh.ai", control4: "Control4" }[lic.platform] || PLATFORM_NAME[lic.platform] || lic.platform;
    add(areaName(sol.racks?.[0]?.area) || "Floor 1", sol.racks?.[0]?.name || "Equipment Rack", "included",
      { mfr, model: (String(lic.pick).match(/\b[A-Z]{2,}-?\d{2,}[A-Z0-9-]*\b/) || [String(lic.pick).replace(/^\d+×\s*/, "")])[0] });
  }
  // the rooms
  for (const z of job.house.zones) {
    const scope = z.scope || "included";
    if (scope === "future") continue;                          // not part of this proposal
    const floor = floorOf(z);
    const prewire = scope === "prewire";
    for (const ep of z.endpoints || []) {
      if (ep.type === "display") {
        // a Bullet Train run pre-wires as Synergy's Bullet Train TV item
        const bullet = (sol.connections || []).some(c => c.to === ep.id && c.signal === "video" && c.run === "bullet");
        if (prewire) { add(floor, z.name, scope, SYN(bullet ? "Prewire - TV (Bullet Train)" : "Prewire - TV (Standard)")); continue; }
        if (bullet) { const b = bulletFor(z), c = b.ref && cat(b.ref); add(floor, z.name, scope, c ? fromCatalog(c) : { mfr: "AVPro Edge", model: "Bullet Train 10K AOC HDMI (length?)", unsure: true }); }
        const ofe = ep.status === "ofe", tv = ep.displayType !== "projector";
        const p = ofe ? { customer: tv ? "TV" : "Equipment" }
          : ep.model ? { mfr: ep.brand || "Unspecified", model: ep.model }
          : tv ? SYN("Unspecified TV") : { mfr: ep.brand || "Unspecified", model: "Projector" };
        add(floor, z.name, scope, p, { ofe });
      } else if (ep.type === "speakers") {
        const [n, sub] = speakerCounts(ep), bar = String(ep.config || "").startsWith("soundbar");
        if (prewire) {
          const passive = (sol.connections || []).some(c => c.to === ep.id && c.signal === "speaker");   // an amp/AVR drives it
          for (const [item, q] of prewireItems(ep, passive)) add(floor, z.name, scope, SYN(item), { qty: q, part: item });
        } else if (ep.status === "ofe") {
          if (n) add(floor, z.name, scope, { customer: bar ? "Soundbar" : "Speakers" }, { ofe: true, qty: n });
          if (sub) add(floor, z.name, scope, { customer: "Subwoofer" }, { ofe: true, qty: sub });
        } else {
          if (n) add(floor, z.name, scope, SYN("Unspecified Speakers"), { qty: n });
          if (sub) add(floor, z.name, scope, SYN("Unspecified Speakers"), { qty: sub, part: "sub" });   // the sub on its own line
        }
      }
    }
    if (prewire) continue;
    // what sits at the TV: extenders, decoders, Dante encoders
    for (const comp of (sol.companions || []).filter(c => z.endpoints?.some(e => e.id === c.serves))) {
      const ref = companionSku(comp, sol, catalog);   // the AVPro balun kit (off an AXION, just its receiver), decoders, AXIS
      const p = ref && cat(ref) ? fromCatalog(cat(ref))
        : { mfr: "Unspecified", model: comp.type === "balun" ? "HDBaseT Extender Set" : `${adapterName(comp)} Set`, unsure: true };
      add(floor, z.name, scope, p);
    }
    // the TV's eARC extender kit (audio back to the receiver)
    for (const c of (sol.connections || []).filter(c => c.earcKit && c.signal === "audioReturn" && z.endpoints?.some(e => e.id === c.from)))
      add(floor, z.name, scope, cat("avpro-ac-aex-dearc-kit") ? fromCatalog(cat("avpro-ac-aex-dearc-kit")) : { mfr: "AVPro Edge", model: "AC-AEX-DEARC-KIT", unsure: true });
    for (const d of (sol.localDevices || []).filter(d => d.zone === z.id)) {
      const c = cat(d.catalogRef);
      add(floor, z.name, scope, c ? fromCatalog(c) : guessProduct(d), { ofe: d.status === "ofe" });
    }
    // billable room remotes
    if (z.remote === "savant") add(floor, z.name, scope, { mfr: "Savant", model: "Pro Remote", unsure: true });
    if (z.remote === "josh") add(floor, z.name, scope, { mfr: "Josh.ai", model: "Josh Remote", unsure: true });
  }
  return [...rooms.values()];
}

/* the file: front matter (planqueue key only) → # title → ## rooms → product lines. Nothing else. */
function planQueueText(job, rooms, suffix = "") {
  const J = job.job || {};
  const client = String(J.client?.name || "").trim(), known = client && client !== "Customer Name";
  const addr = String(J.client?.address || "").trim();
  const title = (known ? [client, addr].filter(Boolean).join(" — ") : (J.name || "Proposal")) + suffix;
  const out = ["---", "planqueue: proposal-import/1", "---", "", `# ${clean(title)}`, ""];
  // rooms in floor order (first seen, Exterior last); floors aren't in the file, so a
  // room name that repeats on two floors carries its floor to stay unique
  const floors = [...new Set(rooms.map(r => r.floor))].sort((a, b) => (a === "Exterior") - (b === "Exterior"));
  const ordered = floors.flatMap(f => rooms.filter(r => r.floor === f && r.lines.size));
  const seen = name => ordered.filter(r => r.room === name).length;
  for (const r of ordered) {
    out.push(`## ${clean(seen(r.room) > 1 ? `${r.room} (${r.floor})` : r.room)}`, "");
    for (const l of r.lines.values()) out.push(`- ${l.qty} | ${l.mfr} | ${l.model}`);
    out.push("");
  }
  return out.join("\n").replace(/\n+$/, "\n");
}

/* one file, or two when the job has pre-wire-only rooms */
export function planQueueFiles(job, solIndex, catalog) {
  const eff = effectiveJob(job, solIndex);
  const { job: J, ix } = loadJob(eff);
  const sol = J.solutions[solIndex] || J.solutions[0];
  const adv = advise(J, ix, catalog);
  const rooms = quoteRooms(J, sol, catalog, adv);
  const sys = rooms.filter(r => r.scope !== "prewire"), pre = rooms.filter(r => r.scope === "prewire");
  const files = [];
  if (sys.some(r => r.lines.size)) files.push({ type: "technology-systems", text: planQueueText(J, sys) });
  if (pre.some(r => r.lines.size)) files.push({ type: "technology-prewire", text: planQueueText(J, pre, " — Pre-Wire") });
  return files;
}

/* ---------- the AI review file ---------- */
const mdCell = s => clean(s).replace(/\*/g, "\\*");
const table = (head, rows) => rows.length
  ? [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map(r => `| ${r.map(mdCell).join(" | ")} |`)].join("\n")
  : "_none_";
const ioText = io => Object.entries(io || {}).filter(([, n]) => n).map(([k, n]) => `${n}× ${k}`).join(", ") || "—";

export function aiReviewMarkdown(job, solIndex, catalog, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const eff = effectiveJob(job, solIndex);
  const { job: J, ix } = loadJob(eff);
  const sol = J.solutions[solIndex] || J.solutions[0];
  const v = validate(J, ix), adv = advise(J, ix, catalog);
  const mine = x => !x.solution || x.solution === sol.id;
  const nm = id => describeNode(J, sol, id).label;
  const cat = id => catalog?.devices?.[id];
  const devs = (sol.racks || []).flatMap(r => (r.devices || []).map(d => ({ ...d, rack: r.name })));
  const gens = [...new Set(devs.map(d => cat(d.catalogRef)?.gen).filter(Boolean))];
  const JJ = J.job || {};
  const o = [];
  o.push("---", "generator: SignalPath", "export: ai-review/1", `job: ${clean(JJ.name)}`,
    `client: ${clean(JJ.client?.name)}`, `site: ${clean(JJ.client?.address)}`, `stage: ${clean(JJ.stage)}`,
    `revision: ${(JJ.revisions || []).length || 1}`, `solution: ${clean(sol.name)}`,
    `control_platform: ${clean((sol.platforms || []).map(p => PLATFORM_NAME[p] || p).join(", ") || "not set")}`,
    `audio_network: ${clean(AUDIO_NET_NAME[sol.audioNetwork || ""] || sol.audioNetwork)}`,
    `video_distribution: ${clean(gens.length ? gens.map(g => ({ "1g": "MXNet 1G", "1g-ev2": "MXNet 1G EVO II", "10g": "MXNet 10G" }[g] || g)).join(", ") : devs.some(d => d.type === "videoMatrix") ? "HDMI matrix" : "none")}`,
    `catalog_as_of: ${clean(catalog?.asOf || JJ.catalogSnapshot?.asOf || "")}`, `exported: ${today}`, "---", "");
  o.push(`# ${clean(JJ.name)} — design review`, "");
  o.push("> For an AI reviewer. Everything below is generated from the SignalPath job; the JSON block at the end is the",
    "> source of truth (SignalPath imports it back). To propose changes, reply with SignalPath command lines — the",
    "> vocabulary is at the bottom — so they can be previewed, checked and undone before anything changes.", "");

  const zones = J.house.zones;
  const tvs = zones.flatMap(z => (z.endpoints || []).filter(e => e.type === "display"));
  const spks = zones.flatMap(z => (z.endpoints || []).filter(e => e.type === "speakers"));
  o.push("## Summary", "",
    `- ${zones.length} zones (${zones.filter(z => (z.scope || "included") === "prewire").length} pre-wire only, ${zones.filter(z => z.scope === "future").length} future)`,
    `- ${tvs.length} displays, ${spks.length} speaker sets`,
    `- ${devs.length} rack devices, ${(sol.companions || []).length} adapters, ${(sol.localDevices || []).length} in-room devices, ${(sol.connections || []).length} connections`,
    `- Checks: ${v.errors.length} errors, ${v.warnings.length} warnings, ${(adv.notes || []).filter(mine).length} advisor notes`, "");

  // open items first — what a reviewer should chase
  const confirms = zones.flatMap(z => (z.endpoints || []).filter(e => e.confirm?.length).map(e => `${z.name} ${e.type === "display" ? "TV" : "speakers"}: confirm ${e.confirm.join(", ")}`));
  if (isAsBuilt(job)) {
    const ab = job.job.asBuilt, ch = asBuiltChanges(job);
    o.push("## As-built changes", "", `As-built of "${clean(ab.fromName)}" (${clean(ab.fromSolution)}), started ${ab.started}. Numbers match the revision clouds on the drawing.`, "",
      ...(ch.length ? ch.map(c => `- △${c.n} (${c.action}) ${clean(c.text)}`) : ["- Built as proposed — no changes."]), "");
  }
  o.push("## Open items", "");
  if (!v.errors.length && !v.warnings.length && !confirms.length) o.push("_Nothing flagged._");
  for (const e of v.errors) o.push(`- **Error:** ${e.msg}`);
  for (const w of v.warnings) o.push(`- Warning: ${w.msg}`);
  for (const c of confirms) o.push(`- Confirm: ${c}`);
  o.push("", "### Advisor notes", "");
  const notes = (adv.notes || []).filter(mine);
  o.push(notes.length ? notes.map(n => `- ${n.msg}`).join("\n") : "_none_", "");

  o.push("## Rooms", "");
  const areaName = id => J.house.areas?.find(a => a.id === id)?.name;
  for (const z of zones) {
    const h = readHookup(J, sol, z);
    o.push(`### ${clean(z.name)}`, "");
    const meta = [areaName(z.area) && `area: ${areaName(z.area)}`, `scope: ${SCOPE_NAME[z.scope || "included"] || z.scope}`, z.remote && `remote: ${z.remote}`].filter(Boolean);
    o.push(`- ${meta.join(" · ")}`);
    for (const e of z.endpoints || []) {
      if (e.type === "display") o.push(`- Display: ${[e.brand, e.model, e.size && `${e.size}"`, e.displayType === "projector" ? "projector" : "TV"].filter(Boolean).join(" ")} — ${STATUS_NAME[e.status || "new"] || e.status}${e.confirm?.length ? ` — confirm ${e.confirm.join(", ")}` : ""}`);
      else if (e.type === "speakers") o.push(`- Speakers: ${SPEAKER_SETUP[e.config || "stereo"] || e.config}${e.config === "landscape" ? ` (${e.satCount || 8} satellites${e.buriedSub ? " + buried sub" : ""})` : e.count ? ` (${e.count})` : ""} — ${STATUS_NAME[e.status || "new"] || e.status}`);
    }
    if (h.video) o.push(`- Video: ${nm(h.video.from)}${h.video.via ? ` via ${nm(h.video.via)}` : " (direct)"}${h.earc ? " · eARC back over the HDMI" : ""}`);
    else if (h.tv) o.push(`- Video: **not fed**`);
    if (h.tv && h.audioBack && h.audioBack !== "none") o.push(`- TV audio back: ${h.audioBack}${h.ret ? ` → ${nm(h.ret.to)}` : ""}`);
    if (h.dante) o.push(`- Dante: ${nm(h.dante.via)} → ${h.dante.to.map(nm).join(", ") || "no amp"}`);
    if (h.spk) o.push(h.speakers ? `- Speakers driven by: ${nm(h.speakers.from)}${h.speakers.channels ? ` outputs ${h.speakers.channels}` : ""}` : `- Speakers driven by: **nothing**`);
    for (const d of (sol.localDevices || []).filter(d => d.zone === z.id)) o.push(`- In the room: ${d.model || d.id} (${d.location || "at display"})${d.status === "ofe" ? " — customer supplied" : ""}`);
    if (z.note) o.push(`- Note: ${clean(z.note)}`);
    o.push("");
  }

  o.push("## Rack", "");
  const ioOf = id => (adv.io || []).filter(x => x.device === id && mine(x));
  o.push(table(["Box", "Product", "Status", "Inputs", "Outputs", "In use"], devs.map(d => {
    const c = cat(d.catalogRef);
    const use = [...ioOf(d.id).map(x => `${x.kind} ${x.used}/${x.capacity}${x.over ? " OVER" : ""}`),
      ...(adv.amps || []).filter(a => a.amp === d.id && mine(a)).map(a => `zones ${a.zonesUsed}/${a.zonesTotal ?? "?"}`)].join("; ");
    return [d.model || d.id, c ? `${c.brand} ${c.partNo || c.model}${c.partNoUnsure ? " (part no. unsure)" : ""}${c.notInPlanQueue ? " (not in PlanQueue)" : ""}` : "not in catalog",
      STATUS_NAME[d.status || "new"] || d.status, c ? ioText(c.inputs) : "—", c ? ioText(c.outputs) : "—", use || "—"];
  })), "");
  const comps = sol.companions || [];
  if (comps.length) o.push("### Adapters", "", table(["Adapter", "Serves"], comps.map(c => [adapterName(c), nm(c.serves)])), "");

  o.push("## Licensing", "");
  const lic = (adv.licensing || []).filter(mine);
  o.push(lic.length ? lic.map(l => [`- **${PLATFORM_NAME[l.platform] || l.platform}:** ${l.pick || "no pick"}`, ...(l.lines || []).filter(Boolean).map(x => `  - ${clean(x)}`), ...(l.warns || []).map(x => `  - ⚠ ${clean(x)}`)].join("\n")).join("\n") : "_No control platform set._", "");

  o.push("## Network & power", "");
  const nets = (adv.network || []).filter(mine);
  for (const p of nets) {
    o.push(`### ${p.virtual ? "House network (no LAN switch on the job)" : `${clean(p.model)} — ${NET_ROLE_NAME[p.role]}`}`, "",
      p.virtual ? `${p.used} Ethernet ports needed.` : p.known ? `${p.copper} RJ45 + ${p.sfp} SFP · ${p.used} used · ${p.over ? `${p.over} short` : `${p.spare} spare`}${p.poeBudgetW ? ` · PoE budget ${p.poeBudgetW} W` : ""}` : `${p.used} connections (port count not in the catalog)`, "",
      table(["Port", "Device", "Location", "Network", "Power"], p.rows.map(r => [r.port ?? "NO PORT", r.what, r.where, r.net, r.power || "—"])), "");
  }
  const pw = (adv.power || []).find(mine);
  if (pw) o.push("### Rack power (outlets)", "",
    `${pw.units.length ? pw.units.map(u => `${u.model} (${u.outlets ?? "?"} outlets)`).join(" + ") : "No power conditioner on the job"} · ${pw.need} outlets needed · ${pw.supply == null ? (pw.pick ? `suggest ${pw.pick.qty > 1 ? pw.pick.qty + " × " : ""}${pw.pick.model}` : "size unknown") : pw.short ? `${pw.short} short` : `${pw.supply - pw.need} spare`}`, "",
    table(["Device", "Outlets", "Note"], [...pw.loads.map(l => [l.what, String(l.outlets), l.why || "—"]), ...pw.poe.map(p => [p.what, "0", "PoE from its switch"])]), "");
  if (pw) o.push(`Load: ~${pw.noWatts.length ? "at least " : ""}${pw.typicalW} W typical / ${pw.maxW} W max against ${pw.circuitW} W continuous (${pw.circuits > 1 ? `${pw.circuits} × ` : ""}${pw.circuitA}A)${pw.noWatts.length ? ` — no wattage on file for ${pw.noWatts.join(", ")}` : ""}`, "");
  for (const r of (adv.racks || []).filter(mine)) o.push(`### Rack elevation — ${clean(r.name)} (${r.size}U)`, "",
    `${r.used}U used · ${r.over ? `${r.over}U over` : `${r.spare}U spare`}${r.unknown.length ? ` · height unknown: ${r.unknown.join(", ")}` : ""}`, "",
    ...r.items.map(i => `- ${i.guess ? "?U (drawn as 1U)" : `${i.u}U`} ${i.label}`), "");
  if (!nets.length && !pw) o.push("_No switches or rack power on this job._", "");

  o.push("## Connections", "", table(["From", "To", "Signal", "Details"], (sol.connections || []).map(c => [nm(c.from), nm(c.to),
    c.dante ? "Dante audio (network)" : signalName(c.signal),
    [c.channels && `outputs ${c.channels}`, c.earc && "eARC", c.backup && "optical backup", c.earcKit && "eARC extender kit", c.scope && c.scope !== "included" && SCOPE_NAME[c.scope]].filter(Boolean).join(", ")])), "");

  o.push("## Wire list", "", table(["Run", "Cable", "From", "To", "Carries", "Ends at"],
    wireRuns(J, ix, { solution: solIndex }).map(r => [r.id, r.cable, r.from, r.to, r.carries, r.term])), "");

  o.push("## Quote lines (as sent to PlanQueue)", "");
  for (const f of planQueueFiles(job, solIndex, catalog)) o.push(`### ${f.type}`, "", "```markdown", f.text.trimEnd(), "```", "");

  o.push("## SignalPath command vocabulary", "", "```text", vocabularyText().trimEnd(), "```", "");
  o.push("## Source data (SignalPath job)", "", "```json", JSON.stringify(job, null, 2), "```", "");
  return o.join("\n");
}
