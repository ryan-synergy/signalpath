/* SignalPath Engine — headless core (Milestone 0)
   Layers: load → validate → advise → place → route → render(SVG)
   Pure functions, no DOM. Spec: ../DESIGN.md (FROZEN 2026-09-17). */

export const SIGNAL_COLORS = {
  video: "#d22b1f",
  audio: "#2b6cb8",
  speaker: "#2b6cb8",
  network: "#2f9e44",
  audioReturn: "#e8842c",
  prewire: "#a7a7a7",
};

export const READABILITY_ZONE_CEILING = 24; // one 11x17 page, per spec §"Readability budget"

/* ---------- load & index ---------- */

export function loadJob(raw) {
  const job = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (job.generator !== "SignalPath") throw new Error("not a SignalPath file (generator)");
  if (job.schemaVersion !== 1) throw new Error("unsupported schemaVersion " + job.schemaVersion);
  const ix = indexJob(job);
  return { job, ix };
}

export function indexJob(job) {
  const ix = { zonesById: {}, endpointsById: {}, endpointZone: {}, devicesById: {}, deviceRack: {}, solutions: [] };
  for (const z of job.house.zones) {
    ix.zonesById[z.id] = z;
    for (const e of z.endpoints || []) {
      ix.endpointsById[e.id] = e;
      ix.endpointZone[e.id] = z.id;
    }
  }
  for (const sol of job.solutions || []) {
    const s = { sol, devices: {}, companions: {}, locals: {} };
    for (const r of sol.racks || []) for (const d of r.devices || []) { s.devices[d.id] = d; ix.deviceRack[d.id] = r.id; }
    for (const d of sol.localDevices || []) s.locals[d.id] = d;
    for (const c of sol.companions || []) s.companions[c.id] = c;
    ix.solutions.push(s);
  }
  return ix;
}

const nodeInSolution = (s, ix, id) =>
  s.devices[id] || s.companions[id] || s.locals[id] || ix.endpointsById[id] || null;

/* ---------- per-solution endpoint overrides ----------
   A solution may reinterpret House zones/endpoints without forking them:
   sol.overrides = { zones: {zid: patch}, endpoints: {eid: patch} }.
   Patches are sparse field sets; ids and endpoint existence stay House-owned. */

export function effectiveHouse(house, sol) {
  const ov = sol?.overrides;
  if (!ov || (!Object.keys(ov.zones || {}).length && !Object.keys(ov.endpoints || {}).length)) return house;
  const patch = (obj, p) => {
    if (!p) return obj;
    const { id, endpoints, ...rest } = p;
    const out = { ...obj, ...rest };
    if (out.confirm?.length) {                    // an override answers its own confirm flag
      out.confirm = out.confirm.filter(f => !(f in rest));
      if (!out.confirm.length) delete out.confirm;
    }
    return out;
  };
  return {
    ...house,
    zones: house.zones.map(z => {
      const zp = (ov.zones || {})[z.id];
      const eps = (z.endpoints || []).map(e => patch(e, (ov.endpoints || {})[e.id]));
      if (!zp && eps.every((e, i) => e === z.endpoints[i])) return z;
      return { ...patch(z, zp), endpoints: eps };
    }),
  };
}

export function effectiveJob(job, solIndex = 0) {
  const h = effectiveHouse(job.house, (job.solutions || [])[solIndex]);
  return h === job.house ? job : { ...job, house: h };
}

/* ---------- validate ---------- */

export function validate(job, ix = indexJob(job)) {
  const errors = [], warnings = [];
  const E = (code, msg) => errors.push({ code, msg });
  const W = (code, msg) => warnings.push({ code, msg });

  // unique ids across zones/endpoints
  const seen = new Set();
  const uniq = (id, kind) => { if (seen.has(id)) E("dup-id", `${kind} id duplicated: ${id}`); seen.add(id); };
  job.house.zones.forEach(z => { uniq(z.id, "zone"); (z.endpoints || []).forEach(e => uniq(e.id, "endpoint")); });

  // duplicate zone names -> soft warn (spec: allowed, warned)
  const names = {};
  job.house.zones.forEach(z => { names[z.name] = (names[z.name] || 0) + 1; });
  Object.entries(names).filter(([, n]) => n > 1)
    .forEach(([n]) => W("dup-zone-name", `zone name used ${names[n]}x: "${n}"`));

  // areas / homeRack refs
  const areaIds = new Set((job.house.areas || []).map(a => a.id));
  job.house.zones.forEach(z => { if (z.area && !areaIds.has(z.area)) E("bad-area", `zone ${z.id} references missing area ${z.area}`); });

  // confirm flags roll-up (info-level warning: Needs Confirmation box)
  job.house.zones.forEach(z => (z.endpoints || []).forEach(e => {
    if (e.confirm?.length) W("confirm", `${z.name}: confirm ${e.confirm.join(", ")} on ${e.type}`);
  }));

  for (const s of ix.solutions) {
    const sol = s.sol;
    // overrides must point at real House objects (stale after a zone/endpoint delete)
    for (const zid of Object.keys(sol.overrides?.zones || {}))
      if (!ix.zonesById[zid]) W("stale-override", `${sol.name || sol.id}: override for missing zone ${zid}`);
    for (const eid of Object.keys(sol.overrides?.endpoints || {}))
      if (!ix.endpointsById[eid]) W("stale-override", `${sol.name || sol.id}: override for missing endpoint ${eid}`);
    // device ids are per-solution namespaces: unique within the solution and vs the House,
    // but sibling solutions may reuse ids (duplicate-as-new clones the gear set)
    const seenSol = new Set(seen);
    const solIds = new Set([...Object.keys(s.devices), ...Object.keys(s.companions), ...Object.keys(s.locals)]);
    solIds.forEach(id => { if (seenSol.has(id)) E("dup-id", `device id duplicated: ${id}`); seenSol.add(id); });

    // companions serve real things
    for (const c of sol.companions || []) {
      if (!nodeInSolution(s, ix, c.serves)) E("bad-serves", `companion ${c.id} serves missing ${c.serves}`);
    }
    // local devices reference real zones
    for (const d of sol.localDevices || []) {
      if (!ix.zonesById[d.zone]) E("bad-zone-ref", `local device ${d.id} references missing zone ${d.zone}`);
    }

    // connection endpoints exist
    for (const c of sol.connections || []) {
      if (!nodeInSolution(s, ix, c.from)) E("bad-conn", `connection from missing node: ${c.from}`);
      if (!nodeInSolution(s, ix, c.to)) E("bad-conn", `connection to missing node: ${c.to}`);
      if (!SIGNAL_COLORS[c.signal]) E("bad-signal", `unknown signal "${c.signal}" on ${c.from}→${c.to}`);
    }

    // orphan endpoints: every endpoint must be fed (be `to` of >=1 edge)
    const fed = new Set((sol.connections || []).map(c => c.to));
    for (const eid of Object.keys(ix.endpointsById)) {
      if (!fed.has(eid)) E("orphan-endpoint", `endpoint never fed: ${eid} (${ix.endpointZone[eid]})`);
    }
    // sources should feed something
    const used = new Set((sol.connections || []).map(c => c.from));
    for (const d of Object.values(s.devices)) {
      if (d.type === "source" && !used.has(d.id)) W("unused-source", `source ${d.id} feeds nothing`);
    }

    // amp channel collisions + zone capacity
    const byAmp = {};
    for (const c of sol.connections || []) {
      if (c.signal === "speaker" && s.devices[c.from]) (byAmp[c.from] ||= []).push(c);
    }
    for (const [ampId, feeds] of Object.entries(byAmp)) {
      const amp = s.devices[ampId];
      const taken = {};
      for (const f of feeds) {
        for (const ch of expandChannels(f.channels)) {
          if (taken[ch]) E("ch-collision", `${ampId} ch ${ch}: ${taken[ch]} vs ${f.to}`);
          taken[ch] = f.to;
        }
      }
      if (amp?.zones && feeds.length > amp.zones)
        E("amp-over", `${ampId}: ${feeds.length} zones assigned, capacity ${amp.zones}`);
    }

    // scope coherence: prewire/future zone endpoints should have matching-scope feeds
    for (const c of sol.connections || []) {
      const zid = ix.endpointZone[c.to];
      if (!zid) continue;
      const zScope = sol.overrides?.zones?.[zid]?.scope || ix.zonesById[zid].scope || "included";
      const cScope = c.scope || "included";
      if (zScope !== "included" && cScope === "included")
        W("scope-mismatch", `feed to ${c.to} not tagged ${zScope} (zone ${zid} is ${zScope})`);
    }
  }

  // readability budget
  const zoneCount = job.house.zones.length;
  if (zoneCount > READABILITY_ZONE_CEILING)
    W("readability", `${zoneCount} zones exceeds one-page ceiling (~${READABILITY_ZONE_CEILING}) — sheet will scale below comfortable print size`);

  return { errors, warnings, ok: errors.length === 0 };
}

export function expandChannels(spec) {
  if (spec == null) return [];
  const out = [];
  for (const part of String(spec).split(",")) {
    const m = part.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
    if (!m) continue;
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let i = a; i <= b; i++) out.push(i);
  }
  return out;
}

/* ---------- place ----------
   Pure geometry: job → tile coordinates. Zero routing here — wires are the
   route layer's job; place() only reserves the corridors they will need.
   Global convention (spec §4, binding): racks stack in a LEFT column; video
   zones ride the TOP band; audio-only zones fill right/bottom-right.
   Coordinates are "drawing space" — same nominal units as the mocks
   (sheet 1632×1056). render() scales the drawing to fit the content field. */

export const SHEET = {
  width: 1632, height: 1056,
  outerFrame: { x: 10, y: 10, w: 1612, h: 1036 },
  content: { x: 16, y: 16, w: 1444, h: 1024 },
  titleBlock: { x: 1460, y: 16, w: 162, h: 1024 },
};

const PL = {
  marginX: 50, topY: 60, areaHeaderY: 46,
  cardTitleH: 36, cardPad: 25, cardGapX: 30, rowGapY: 30, cardBottomPad: 24,
  cardMinW: 130, cardMinH: 140, groupGapX: 30, captionH: 18,
  videoRowGapY: 88, // wrapped video rows: chip strip (38) + feed lanes below each card
  areaGapX: 80, secondaryClusterMaxW: 700,
  colA: 80, colB: 260, colC: 470,                 // rack device columns (absolute, aligned across racks)
  smallTile: { w: 100, h: 22, pitch: 70 },
  chassisTile: { w: 150, h: 64, pitch: 84 },
  ampTile: { w: 170, h: 84, pitch: 104 },
  rackPadTop: 50, rackPadBottom: 30, rackGapY: 30,
  chip: { w: 54, h: 18 },
  lanePitch: 14, corridorQuantum: 56, topCorridorMin: 120, rightCorridorMin: 90,
  legendRowW: 140, legendH: 56,
};

const SPK = 32, SPK_PITCH = 34; // speaker icon diameter / center pitch

function speakerGroupSize(ep) {
  const cfg = ep.config || "stereo";
  const cap = s => (ep.status === "ofe" ? "OFE " : "") + s;
  if (cfg === "mono") return { w: SPK, h: SPK, caption: cap("1 Speaker") };
  if (cfg === "2.1" || cfg === "stereo-2.1") return { w: SPK_PITCH * 3 - 2, h: SPK, caption: cap("2.1 Speakers") };
  if (cfg === "surround-5.1") return { w: SPK_PITCH * 3 - 2, h: 70, caption: cap("5.1 Surround") };
  if (cfg === "surround-7.1" || cfg === "surround-7.1.4") return { w: SPK_PITCH * 4 - 2, h: 70, caption: cap(cfg.slice(9) + " Surround") };
  if (cfg.startsWith("soundbar")) return { w: 90, h: SPK, caption: cap(cfg === "soundbar-sub" ? "Soundbar + Sub" : "Soundbar") };
  if (cfg === "landscape") {
    const sats = ep.satCount || 4, subs = ep.buriedSub ? 1 : 0;
    return { w: sats * 26 + subs * 34, h: SPK, caption: cap(`Landscape ${sats}${subs ? "+" + subs : ""}`) };
  }
  const n = ep.count || 2;
  return { w: SPK_PITCH * n - 2, h: SPK, caption: cap(`${n} Speakers`) };
}

function displaySize(ep) {
  const inches = ep.size || 55;
  const w = Math.round(inches * 1.6), h = Math.round(w * 0.567);
  const brand = [ep.status === "ofe" ? "OFE" : "New", ep.brand].filter(Boolean).join(" ");
  return { w, h, caption: "1 Display", brand, sizeText: `${inches}"` };
}

/* Card geometry: groups run left→right [speakers, display]; a local
   "at-display" source sits under the display footprint (the touch-the-TV
   exception renders from this slot). Card sizes to contents (compactness rule). */
function zoneCard(zone, localsInZone) {
  const groups = [];
  for (const ep of zone.endpoints || []) {
    if (ep.type === "speakers") groups.push({ epId: ep.id, kind: "speakers", ...speakerGroupSize(ep) });
  }
  for (const ep of zone.endpoints || []) {
    if (ep.type === "display") groups.push({ epId: ep.id, kind: "display", ...displaySize(ep) });
  }
  let x = PL.cardPad, contentBottom = 0;
  for (const g of groups) {
    g.x = x; g.y = PL.cardTitleH;
    g.cx = x + g.w / 2;
    let bottom = g.y + g.h;
    if (g.kind === "display" && localsInZone.length) {
      g.local = { x: g.cx - PL.smallTile.w / 2, y: bottom + 12, ...PL.smallTile, deviceId: localsInZone[0].id, label: localsInZone[0].model };
      bottom = g.local.y + g.local.h + PL.captionH;
    }
    g.captionY = bottom + PL.captionH;
    contentBottom = Math.max(contentBottom, g.captionY);
    x += g.w + PL.groupGapX;
  }
  const w = Math.max(PL.cardMinW, x - PL.groupGapX + PL.cardPad);
  const h = Math.max(PL.cardMinH, contentBottom + PL.cardBottomPad);
  // widen: center content when min width won
  const innerW = x - PL.groupGapX - PL.cardPad;
  if (w > innerW + 2 * PL.cardPad - 1) {
    const shift = (w - innerW) / 2 - PL.cardPad;
    for (const g of groups) { g.x += shift; g.cx += shift; if (g.local) g.local.x += shift; }
  }
  return { w, h, groups };
}

function deviceTileSpec(d, inCount = 0) {
  // avbSwitch rides col A (mock-sheet draws Savant AVB with the sources) so its
  // module feeds enter col B left edges cleanly
  if (d.type === "source" || d.type === "avbSwitch") return { col: "A", ...PL.smallTile, kind: "small", pitch: PL.smallTile.pitch };
  const base = d.type === "amp" ? { col: "C", ...PL.ampTile, kind: "amp" } : { col: "B", ...PL.chassisTile, kind: "chassis" };
  // uniform chassis height — except a hub whose left edge must seat all its
  // input ports at legible pitch (an SW12 draws big; it IS the hub);
  // +28 leaves one spare port slot for the router's retry tier
  const h = Math.max(base.h, inCount * 12 + 28);
  return { ...base, h, pitch: h + 20 };
}

const quant = (need, min) => Math.max(min, Math.ceil(need / PL.corridorQuantum) * PL.corridorQuantum);

export function place(job, ix = indexJob(job), opts = {}) {
  const s = ix.solutions[opts.solution ?? 0];
  if (!s) throw new Error("no solution to place");
  const sol = s.sol;
  // view filter (e.g. hideSignals: ["network"]): hidden wires get no corridor
  // capacity, no ports, no legend row — validation still sees the full system
  const hiddenSignals = new Set(opts.hideSignals || []);
  const visConns = (sol.connections || []).filter(c => !hiddenSignals.has(c.signal));
  const out = { sheet: SHEET, racks: [], zones: [], chips: [], corridors: [], areaHeaders: [], legend: null, warnings: [] };

  /* -- classify zones, preserve input order (layout stability) -- */
  const areas = job.house.areas || [];
  const multiArea = areas.length > 1;
  const primaryAreaId = areas.length ? (sol.racks?.[0]?.area || areas[0].id) : null;
  const clusters = []; // [{areaId, name, video:[], audio:[]}] — cluster 0 = primary
  const clusterFor = z => {
    const aid = multiArea ? (z.area || primaryAreaId) : null;
    let c = clusters.find(c => c.areaId === aid);
    if (!c) {
      c = { areaId: aid, name: areas.find(a => a.id === aid)?.name || null, video: [], audio: [] };
      clusters.push(c);
    }
    return c;
  };
  if (!multiArea) clusters.push({ areaId: null, name: null, video: [], audio: [] });
  for (const z of job.house.zones) {
    const c = clusterFor(z);
    (z.endpoints || []).some(e => e.type === "display") ? c.video.push(z) : c.audio.push(z);
  }
  // primary cluster first, others in area order
  clusters.sort((a, b) => {
    const rank = c => (c.areaId === primaryAreaId || c.areaId === null) ? -1 : areas.findIndex(x => x.id === c.areaId);
    return rank(a) - rank(b);
  });

  /* -- pass 1: measure zone cards; count inbound feeds per zone (each wrapped
     row's strip must seat its chips AND its feed lanes — demand-sized) -- */
  const cardOf = {}, zoneInbound = {};
  for (const c of visConns) {
    const zid = ix.endpointZone[c.to] || (s.companions[c.to] && ix.endpointZone[s.companions[c.to].serves]);
    if (!zid || s.locals[c.from]) continue;
    if (s.companions[c.from] && ix.endpointsById[s.companions[c.from].serves]) continue; // chip stub
    zoneInbound[zid] = (zoneInbound[zid] || 0) + 1;
  }
  const rowGapFor = rowZones => Math.max(PL.videoRowGapY,
    38 + 12 * (rowZones.reduce((n, z) => n + (zoneInbound[z.id] || 0), 0) + 1));
  for (const z of job.house.zones) {
    const locals = Object.values(s.locals).filter(d => d.zone === z.id && d.location === "at-display");
    cardOf[z.id] = zoneCard(z, locals);
  }

  /* -- primary top band: video zones of cluster 0, rows wrapping at content right -- */
  const primary = clusters[0];
  {
    let x = PL.marginX, y = PL.topY, rowH = 0, rowZones = [];
    for (const z of primary.video) {
      const c = cardOf[z.id];
      if (x + c.w > SHEET.content.x + SHEET.content.w - PL.marginX && x > PL.marginX) {
        y += rowH + rowGapFor(rowZones); x = PL.marginX; rowH = 0; rowZones = [];
      }
      placeZone(out, z, c, x, y, "top");
      rowZones.push(z);
      x += c.w + PL.cardGapX; rowH = Math.max(rowH, c.h);
    }
    var topBandBottom = primary.video.length ? y + rowH : PL.topY - PL.rowGapY;
    var topBandRight = primary.video.length ? Math.max(...out.zones.map(z => z.x + z.w)) : PL.marginX;
  }

  /* -- demand-sized column gaps: the intra-rack corridors are first-class
     too — vertical lane capacity between columns is reserved from actual
     wire counts, never hoped for -- */
  const devColOf = {};
  for (const r of sol.racks || []) for (const d of r.devices || []) devColOf[d.id] = deviceTileSpec(d).col;
  let bcDemand = 2, abDemand = 3;
  const inCount = {};
  for (const c of visConns) {
    const fCol = devColOf[c.from], tCol = devColOf[c.to];
    if (devColOf[c.to] != null) inCount[c.to] = (inCount[c.to] || 0) + 1;
    if (fCol != null) inCount["out:" + c.from] = (inCount["out:" + c.from] || 0) + 1;
    const toZoneSide = ix.endpointsById[c.to] || (s.companions[c.to] && !devColOf[s.companions[c.to]?.serves]);
    if (fCol === "B" && (toZoneSide || s.companions[c.to])) bcDemand++;
    if (fCol === "B" && tCol === "B") { bcDemand++; abDemand++; }
    if (fCol === "B" && tCol === "C") bcDemand++;
    if (ix.endpointsById[c.from]) abDemand++;                       // audio return descends the AB gap
    if (s.companions[c.from] && devColOf[s.companions[c.from].serves] === "A") abDemand++; // ENC-chip outputs
  }
  const gapAB = Math.max(80, abDemand * 12 + 24);
  const gapBC = Math.max(60, bcDemand * 12 + 24);
  const colBx = PL.colA + PL.smallTile.w + gapAB;
  const colCx = colBx + PL.chassisTile.w + gapBC;

  /* -- corridors sized BEFORE dependent placement (corridors are first-class) -- */
  const epZoneOf = id => ix.endpointZone[id] || (s.companions[id] && ix.endpointZone[s.companions[id].serves]) || s.locals[id]?.zone;
  const crossings = { top: 0, right: 0 };
  const clusterInbound = {}; // areaId -> feeds entering that cluster (sizes its gutter)
  for (const c of visConns) {
    const zid = epZoneOf(c.to) || epZoneOf(c.from);
    if (!zid) continue;
    if (s.locals[c.from]) continue; // local link lives inside the card
    // a chip parked at the card (balun/DEC serving an endpoint) feeds it via a
    // short stub — the corridor crossing was already counted on the feed INTO the chip
    if (s.companions[c.from] && ix.endpointsById[s.companions[c.from].serves]) continue;
    const cl = clusters.find(cl => cl.video.some(z => z.id === zid) || cl.audio.some(z => z.id === zid));
    const isVideoZone = cl?.video.some(z => z.id === zid);
    if (cl === primary && isVideoZone) crossings.top++;
    else crossings.right++;
    if (cl && cl !== primary) clusterInbound[cl.areaId] = (clusterInbound[cl.areaId] || 0) + 1;
  }
  const topCorridorH = quant(crossings.top * PL.lanePitch + 40, PL.topCorridorMin);
  // the right corridor's VERTICAL lanes serve col-C risers bound for the top
  // band (east-bound feeds only cross it horizontally)
  let colCRisers = 2;
  for (const c of visConns) {
    const tzid = epZoneOf(c.to);
    if (devColOf[c.from] === "C" && tzid && primary.video.some(z => z.id === tzid)) colCRisers++;
  }
  const rightCorridorW = quant(colCRisers * PL.lanePitch + 36, PL.rightCorridorMin);

  /* -- racks: left column, stacked, device columns vertically aligned -- */
  let rackY = topBandBottom + topCorridorH;
  let rackRight = PL.marginX;
  for (const r of sol.racks || []) {
    const cols = { A: rackY + PL.rackPadTop, B: rackY + PL.rackPadTop, C: rackY + PL.rackPadTop };
    const placed = [];
    let usedC = false, maxTileBottom = rackY + PL.rackPadTop;
    for (const d of r.devices || []) {
      const t = deviceTileSpec(d, Math.max(inCount[d.id] || 0, inCount["out:" + d.id] || 0));
      const x = t.col === "A" ? PL.colA : t.col === "B" ? colBx : colCx;
      if (t.col === "C") usedC = true;
      placed.push({ id: d.id, model: d.model, kind: t.kind, col: t.col, x, y: cols[t.col], w: t.w, h: t.h, type: d.type });
      maxTileBottom = Math.max(maxTileBottom, cols[t.col] + t.h + (t.kind === "small" ? PL.captionH : 0));
      cols[t.col] += t.pitch;
    }
    const w = (usedC ? colCx + PL.ampTile.w : colBx + PL.chassisTile.w) + PL.rackPadBottom - PL.marginX;
    const h = maxTileBottom - rackY + PL.rackPadBottom;
    out.racks.push({ id: r.id, name: r.name, x: PL.marginX, y: rackY, w, h, devices: placed });
    rackRight = Math.max(rackRight, PL.marginX + w);
    rackY += h + PL.rackGapY;
  }
  const rackBottom = rackY - PL.rackGapY;

  /* -- primary audio band: rows to the right of the rack column, near the amps --
     wraps on its own width budget (the drawing scales; a fixed sheet-edge wrap
     would collapse wide racks into a single column) */
  {
    const bandX = rackRight + rightCorridorW;
    const bandMaxW = Math.max(680, Math.ceil(Math.sqrt(primary.audio.length)) * 170);
    let x = bandX, y = topBandBottom + topCorridorH + 240, rowH = 0;
    if (!out.racks.length) y = topBandBottom + topCorridorH;
    for (const z of primary.audio) {
      const c = cardOf[z.id];
      if (x + c.w > bandX + bandMaxW && x > bandX) {
        y += rowH + PL.rowGapY; x = bandX; rowH = 0;
      }
      placeZone(out, z, c, x, y, "audio");
      x += c.w + PL.cardGapX; rowH = Math.max(rowH, c.h);
    }
  }

  /* -- secondary clusters: full stacks to the right (video row, audio rows below) -- */
  out.clusters = [{ areaId: primaryAreaId, x0: PL.marginX, x1: Math.max(topBandRight, ...out.zones.map(z => z.x + z.w), rackRight) }];
  let clusterX = out.clusters[0].x1;
  for (const cl of clusters.slice(1)) {
    // gutter before each cluster sized for the feeds that must rise through it
    clusterX += Math.max(PL.areaGapX, (clusterInbound[cl.areaId] || 0) * 12 + 32);
    const startX = clusterX;
    let x = startX, y = PL.topY, rowH = 0, right = startX, rowZones = [];
    for (const z of cl.video) {
      const c = cardOf[z.id];
      if (x + c.w > startX + PL.secondaryClusterMaxW && x > startX) { y += rowH + rowGapFor(rowZones); x = startX; rowH = 0; rowZones = []; }
      placeZone(out, z, c, x, y, "cluster");
      rowZones.push(z);
      x += c.w + PL.cardGapX; rowH = Math.max(rowH, c.h); right = Math.max(right, x - PL.cardGapX);
    }
    y += (cl.video.length ? rowH + Math.max(70, rowGapFor(rowZones) - 12) : 0); x = startX; rowH = 0; rowZones = [];
    for (const z of cl.audio) {
      const c = cardOf[z.id];
      if (x + c.w > startX + PL.secondaryClusterMaxW && x > startX) { y += rowH + rowGapFor(rowZones); x = startX; rowH = 0; rowZones = []; }
      placeZone(out, z, c, x, y, "cluster");
      rowZones.push(z);
      x += c.w + PL.cardGapX; rowH = Math.max(rowH, c.h); right = Math.max(right, x - PL.cardGapX);
    }
    out.areaHeaders.push({ areaId: cl.areaId, name: (cl.name || "").toUpperCase(), cx: (startX + right) / 2, y: PL.areaHeaderY });
    out.clusters.push({ areaId: cl.areaId, x0: startX, x1: right });
    clusterX = right;
  }
  if (multiArea && primary.video.length + primary.audio.length) {
    const pri = out.zones.filter(z => z.band !== "cluster");
    const right = Math.max(rackRight, ...pri.map(z => z.x + z.w));
    out.areaHeaders.unshift({
      areaId: primaryAreaId,
      name: (areas.find(a => a.id === primaryAreaId)?.name || "").toUpperCase(),
      cx: (PL.marginX + right) / 2, y: PL.areaHeaderY,
    });
  }

  /* -- companion chips (obstacles for the router) --
     Rack-serving chips try slots in order (beside → staggered down → below the
     device) until one is collision-free vs devices and earlier chips. */
  const allDevices = out.racks.flatMap(r => r.devices);
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const chipFits = r => !allDevices.some(d => hit(r, d)) && !out.chips.some(c => hit(r, c));
  for (const comp of sol.companions || []) {
    const chip = { id: comp.id, type: comp.type, ...PL.chip };
    const servedEp = ix.endpointsById[comp.serves];
    if (servedEp) {
      // balun/DEC under the display it serves, aligned with the endpoint (boundary principle)
      const pz = out.zones.find(z => z.id === ix.endpointZone[comp.serves]);
      const slot = pz?.groups.find(g => g.epId === comp.serves);
      if (pz && slot) { chip.x = pz.x + slot.cx - PL.chip.w / 2; chip.y = pz.y + pz.h + 20; }
    } else {
      // serves a rack device: ENC to the right of its source, DEC to the left of its target
      const dev = allDevices.find(d => d.id === comp.serves);
      if (dev) {
        const cy = dev.y + dev.h / 2 - PL.chip.h / 2;
        const bx = comp.type === "enc" ? dev.x + dev.w + 24 : dev.x - PL.chip.w - 24;
        const candidates = [
          { x: bx, y: cy },                                        // beside, centered
          { x: bx, y: cy + 26 }, { x: bx, y: cy + 52 },            // beside, staggered down
          { x: dev.x + dev.w / 2 - PL.chip.w / 2, y: dev.y + dev.h + 8 }, // tucked below
          { x: bx, y: cy - 26 },                                   // beside, staggered up
        ];
        const pick = candidates.find(p => chipFits({ ...p, w: PL.chip.w, h: PL.chip.h }));
        if (pick) { chip.x = pick.x; chip.y = pick.y; }
        else { chip.x = bx; chip.y = cy; out.warnings.push({ code: "chip-crowded", msg: `chip ${comp.id} placed with overlap — no free slot near ${comp.serves}` }); }
      }
    }
    if (chip.x == null) { chip.x = PL.marginX; chip.y = rackBottom + 40; out.warnings.push({ code: "chip-unanchored", msg: `chip ${comp.id} had no served tile` }); }
    out.chips.push(chip);
  }

  /* -- corridor boxes (reserved routing space) -- */
  out.corridors.push({
    id: "top", orientation: "h", lanes: crossings.top, pitch: PL.lanePitch,
    x: PL.marginX, y: topBandBottom, w: Math.max(topBandRight, rackRight) - PL.marginX, h: topCorridorH,
  });
  out.corridors.push({
    id: "right", orientation: "v", lanes: colCRisers, pitch: PL.lanePitch,
    x: rackRight, y: topBandBottom + topCorridorH, w: rightCorridorW, h: Math.max(rackBottom - (topBandBottom + topCorridorH), 0),
  });

  /* -- dynamic legend: only signal types present on the sheet -- */
  const present = [...new Set(visConns.map(c => (c.scope || "included") !== "included" ? "prewire" : c.signal === "speaker" ? "audio" : c.signal))];
  const order = ["video", "audio", "audioReturn", "network", "prewire"];
  const rows = order.filter(k => present.includes(k));
  const lw = 24 + rows.length * PL.legendRowW;
  out.legend = { rows, w: lw, h: PL.legendH, x: SHEET.content.x + SHEET.content.w - lw - 60, y: SHEET.content.y + SHEET.content.h - PL.legendH - 6 };

  /* -- bounds + fit scale (one-page rule: drawing scales, never splits) -- */
  const rects = [...out.zones, ...out.racks, ...out.chips];
  const maxX = Math.max(...rects.map(r => r.x + r.w), PL.marginX);
  const maxY = Math.max(...rects.map(r => r.y + r.h), PL.topY);
  out.bounds = { x: 0, y: 0, w: maxX + PL.marginX, h: maxY + 40 };
  out.fitScale = Math.min(1, SHEET.content.w / out.bounds.w, (SHEET.content.h - PL.legendH - 20) / out.bounds.h);
  if (out.fitScale < 0.75) out.warnings.push({ code: "scale", msg: `drawing fits at ${Math.round(out.fitScale * 100)}% — captions may print small` });

  return out;
}

function placeZone(out, zone, card, x, y, band) {
  out.zones.push({
    id: zone.id, name: zone.name, scope: zone.scope || "included", band,
    x, y, w: card.w, h: card.h,
    groups: card.groups.map(g => ({ ...g })),
  });
}

/* ---------- route ----------
   The §4 rule set as a structured channel router. Placement is canonical
   (racks left, zones top/right), so every connection falls into a known class;
   each class builds candidate orthogonal paths, validated against an obstacle
   set (devices, chips, cards — wires never pierce them) and a lane registry
   (no co-linear overlaps; 12px pitch). Nesting comes from port ordering
   (farthest destination → top exit port), hops from a crossing post-pass. */

const RT = { lane: 12, pad: 2, clear: 9, portPitch: 12, portInset: 8, hopR: 6, hopMerge: 20 };

export function route(job, ix, placement, opts = {}) {
  const s = ix.solutions[opts.solution ?? 0];
  const sol = s.sol;
  const P = placement;
  const hiddenSignals = new Set(opts.hideSignals || []);
  const visConns = (sol.connections || []).filter(c => !hiddenSignals.has(c.signal));
  const out = { wires: [], groups: [], warnings: [] };
  const dbg = (o, entry) => {
    if (!opts.debug) return;
    (out.debug ||= {});
    const k = `${o.c.from}→${o.c.to}`;
    ((out.debug[k] ||= [])).length < 80 && out.debug[k].push(entry);
  };

  /* --- lookup tables --- */
  const devById = {}; for (const r of P.racks) for (const d of r.devices) devById[d.id] = d;
  const chipById = {}; for (const c of P.chips) chipById[c.id] = c;
  const zoneByEp = epId => P.zones.find(z => z.id === ix.endpointZone[epId]);
  const slotOf = epId => { const pz = zoneByEp(epId); const g = pz.groups.find(g => g.epId === epId); return { pz, g, cx: pz.x + g.cx }; };
  const rackRight = P.racks.length ? Math.max(...P.racks.map(r => r.x + r.w)) : 0;
  const rackTop = P.racks.length ? Math.min(...P.racks.map(r => r.y)) : 0;
  const rackBottom = P.racks.length ? Math.max(...P.racks.map(r => r.y + r.h)) : 0;
  const corRight = P.corridors.find(c => c.id === "right");
  // column gap channels from the ACTUAL placement (gaps are demand-sized)
  const allDevs = P.racks.flatMap(r => r.devices);
  const colX = col => { const xs = allDevs.filter(d => d.col === col).map(d => d.x); return xs.length ? Math.min(...xs) : null; };
  const colBx = colX("B") ?? PL.colA + PL.smallTile.w + 80;
  const colCx = colX("C") ?? colBx + PL.chassisTile.w + 60;
  const gapABx = [PL.colA + PL.smallTile.w + 6, colBx - 6];
  const gapBCx = [colBx + PL.chassisTile.w + 6, colCx - 6];
  const westMarginX = [18, PL.marginX - 6];                        // last-resort channel left of everything
  const riserRange = [rackRight + 6, rackRight + (corRight?.w || 90) - 6];
  // gutter west of a cluster (the area gap) — riser channel for cluster-bound feeds
  const gutterFor = tx => {
    const cl = (P.clusters || []).find(c => tx >= c.x0 && tx <= c.x1 + 40);
    if (!cl) return [Math.max(rackRight + 10, tx - 200), tx - 12];
    const i = (P.clusters || []).indexOf(cl);
    if (i === 0) return [Math.max(rackRight + 10, tx - 200), tx - 12];
    const prev = P.clusters[i - 1].x1;
    return [prev + 8, cl.x0 - 8];
  };

  /* --- obstacles (wires terminate ON edges; interiors shrink by pad) --- */
  const obstacles = [
    ...P.racks.flatMap(r => r.devices.map(d => ({ id: d.id, x: d.x, y: d.y, w: d.w, h: d.h }))),
    ...P.chips.map(c => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h })),
    ...P.zones.map(z => ({ id: z.id, x: z.x, y: z.y, w: z.w, h: z.h })),
  ];
  const segBlocked = (x1, y1, x2, y2, skip) => {
    const sx = Math.min(x1, x2), ex = Math.max(x1, x2), sy = Math.min(y1, y2), ey = Math.max(y1, y2);
    for (const o of obstacles) {
      if (skip && skip.has(o.id)) continue;
      if (sx < o.x + o.w - RT.pad && ex > o.x + RT.pad && sy < o.y + o.h - RT.pad && ey > o.y + RT.pad) return o.id;
    }
    return null;
  };
  const pathBlocked = (pts, skip) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const b = segBlocked(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], skip);
      if (b) return b;
    }
    return null;
  };

  /* --- lane registry: no co-linear overlaps between nets --- */
  const usedH = [], usedV = []; // {c, a1, a2, net}
  const conflicts = (used, c, a1, a2, net) => {
    const lo = Math.min(a1, a2), hi = Math.max(a1, a2);
    return used.some(u => u.net !== net && Math.abs(u.c - c) < RT.clear && Math.min(u.a2, hi) - Math.max(u.a1, lo) > -2);
  };
  const alloc = (used, desired, a1, a2, net, dir, blockedFn, range) => {
    const maxK = range ? Math.max(14, Math.ceil((range[1] - range[0]) / RT.lane) + 1) : 14;
    for (let k = 0; k <= maxK; k++) {
      for (const sgn of dir === 0 ? (k ? [1, -1] : [1]) : [dir]) {
        const c = desired + sgn * k * RT.lane;
        if (range && (c < range[0] || c > range[1])) continue;
        if (!conflicts(used, c, a1, a2, net) && !(blockedFn && blockedFn(c))) return c;
        if (dir !== 0) break;
      }
      if (dir !== 0 && (desired + dir * k * RT.lane < (range?.[0] ?? -1e9) || desired + dir * k * RT.lane > (range?.[1] ?? 1e9))) break;
    }
    return null;
  };
  const registerPath = (pts, net) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      if (y1 === y2) usedH.push({ c: y1, a1: Math.min(x1, x2), a2: Math.max(x1, x2), net });
      else usedV.push({ c: x1, a1: Math.min(y1, y2), a2: Math.max(y1, y2), net });
    }
  };
  const pathRegisterable = (pts, net) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      if (y1 === y2 ? conflicts(usedH, y1, x1, x2, net) : conflicts(usedV, x1, y1, y2, net)) return false;
    }
    return true;
  };

  /* --- port managers --- */
  const leftPorts = {}, rightPorts = {}, portPlan = {}; // reserved exits per wire
  // small tiles get a slimmer inset so two ports still clear the co-linear pitch
  const portSpan = dev => {
    const inset = Math.min(RT.portInset, Math.max(4, Math.floor(dev.h / 4)));
    return [dev.y + inset, dev.y + dev.h - inset];
  };
  const takePort = (store, dev, desired) => {
    const list = store[dev.id] ||= [];
    const [min, max] = portSpan(dev);
    let y = Math.max(min, Math.min(max, desired));
    let tries = 0;
    while (list.some(u => Math.abs(u - y) < 10) && tries++ < 20) {
      y += RT.lane; if (y > max) y = min;
    }
    list.push(y);
    return y;
  };
  const takeLeftPort = (dev, desired) => takePort(leftPorts, dev, desired);
  const takeRightPort = (dev, desired) => takePort(rightPorts, dev, desired);

  /* --- shared lane scanner: a lane is only taken when the whole path built on
     it clears obstacles and the registry (joint validation) --- */
  const scanLane = (desired, dir, range, xa, xb, net, ok) => {
    if (range[1] < range[0]) return null;
    const maxK = Math.max(14, Math.ceil((range[1] - range[0]) / RT.lane) + 1);
    for (let k = 0; k <= maxK; k++) {
      for (const sgn of dir === 0 ? (k ? [1, -1] : [1]) : [dir]) {
        const y = desired + sgn * k * RT.lane;
        if (y < range[0] || y > range[1]) { if (dir !== 0) break; else continue; }
        if (!conflicts(usedH, y, xa, xb, net) && ok(y)) return y;
        if (dir !== 0) break;
      }
    }
    return null;
  };

  const wireId = c => `${c.from}→${c.to}`;
  let nWire = 0;

  /* sibling nesting is INVIOLABLE (rule precedence §4): a candidate that would
     cross an already-committed wire of the same fan-out is rejected outright */
  const ptsSegs = pts => {
    const segs = [];
    for (let i = 1; i < pts.length; i++) segs.push({ x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1], vert: pts[i - 1][0] === pts[i][0] });
    return segs;
  };
  // score a candidate by how many existing wires it would cross (hops it costs)
  const countCrossings = cand => {
    let n = 0;
    const mine = ptsSegs(cand);
    for (const w of out.wires) for (const t of ptsSegs(w.pts)) for (const s of mine) {
      if (s.vert === t.vert) continue;
      const v = s.vert ? s : t, h = s.vert ? t : s;
      const hx1 = Math.min(h.x1, h.x2), hx2 = Math.max(h.x1, h.x2);
      const vy1 = Math.min(v.y1, v.y2), vy2 = Math.max(v.y1, v.y2);
      if (v.x1 > hx1 + 1 && v.x1 < hx2 - 1 && h.y1 > vy1 + 1 && h.y1 < vy2 - 1) n++;
    }
    return n;
  };

  const crossesSiblings = (cand, groupNets) => {
    if (!groupNets.length) return false;
    const mine = ptsSegs(cand);
    for (const w of out.wires) {
      if (!groupNets.includes(w.net)) continue;
      for (const t of ptsSegs(w.pts)) for (const s of mine) {
        if (s.vert === t.vert) continue;
        const v = s.vert ? s : t, h = s.vert ? t : s;
        const hx1 = Math.min(h.x1, h.x2), hx2 = Math.max(h.x1, h.x2);
        const vy1 = Math.min(v.y1, v.y2), vy2 = Math.max(v.y1, v.y2);
        if (v.x1 > hx1 + 1 && v.x1 < hx2 - 1 && h.y1 > vy1 + 1 && h.y1 < vy2 - 1)
          return { sib: w.id, at: [v.x1, h.y1], seg: [s.x1, s.y1, s.x2, s.y2] };
      }
    }
    return false;
  };
  const commit = (conn, cls, pts, extra = {}) => {
    const clean = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
    const w = { id: wireId(conn), net: nWire++, cls, signal: conn.signal, scope: conn.scope || "included", from: conn.from, to: conn.to, pts: clean, hops: [], ...extra };
    // a fallback is known-bad geometry: draw it, but never let it poison the
    // registry and starve later (valid) wires
    if (!cls.endsWith("-fallback")) registerPath(clean, w.net);
    out.wires.push(w);
    return w;
  };

  /* --- terminal helpers --- */
  const feedsToEp = {}; // epId -> count of boundary feeds (for return straddle offsets)
  for (const c of visConns) {
    const comp = s.companions[c.to];
    const ep = ix.endpointsById[c.to] || (comp && ix.endpointsById[comp.serves]);
    if (ep && !s.locals[c.from]) feedsToEp[ep.id] = (feedsToEp[ep.id] || 0) + 1;
  }

  // resolve a zone-bound target: land on the card border (or the chip parked
  // under it) at the x aligned with the endpoint — the boundary principle
  const zoneTarget = conn => {
    const comp = s.companions[conn.to];
    if (comp && ix.endpointsById[comp.serves]) {
      const chip = chipById[conn.to];
      const { pz } = slotOf(comp.serves);
      return { tx: chip.x + chip.w / 2, landY: chip.y + chip.h, cardTop: pz.y, cardBot: pz.y + pz.h, pz, chipId: chip.id };
    }
    const { pz, cx } = slotOf(conn.to);
    const tx = conn.signal === "audioReturn" ? cx + RT.lane : cx;
    return { tx, landY: null, cardTop: pz.y, cardBot: pz.y + pz.h, pz };
  };

  /* ============ pass 1: fixed-geometry stubs (no allocation) ============ */
  const done = new Set();
  visConns.forEach((conn, i) => {
    const comp = s.companions[conn.from];
    if (comp && ix.endpointsById[comp.serves] && ix.endpointsById[conn.to]) {
      // chip parked at the card → its endpoint: short stub dying into the border
      const chip = chipById[conn.from];
      const { pz } = slotOf(conn.to);
      commit(conn, "stub", [[chip.x + chip.w / 2, chip.y], [chip.x + chip.w / 2, pz.y + pz.h]]);
      done.add(i);
    } else if (s.locals[conn.from] && ix.endpointsById[conn.to]) {
      // in-room source touches its display: the local-source exception
      const { pz, g } = slotOf(conn.to);
      const lt = pz.groups.flatMap(gr => gr.local ? [gr.local] : []).find(l => l.deviceId === conn.from);
      if (lt) commit(conn, "local", [[pz.x + lt.x + lt.w / 2, pz.y + lt.y], [pz.x + g.cx, pz.y + g.y + g.h]], { insideCard: pz.id });
      else out.warnings.push({ code: "no-local-slot", msg: `local ${conn.from} has no slot` });
      done.add(i);
    }
  });

  /* ============ pass 2: right-edge fan-out plans (nesting rule) ============ */
  // classify a zone-bound conn's approach region
  const regionOf = t => {
    if (t.pz.band === "top") return "top";
    if (t.pz.band === "audio") return "audio";
    return "cluster";
  };
  const plans = []; // per source device: ordered wires + port ys
  for (const r of P.racks) for (const d of r.devices) {
    const outs = visConns.map((c, i) => ({ c, i })).filter(({ c, i }) => c.from === d.id && !done.has(i));
    if (!outs.length) continue;
    const zone = [], other = [];
    for (const o of outs) {
      const comp = s.companions[o.c.to];
      const isZone = ix.endpointsById[o.c.to] || (comp && ix.endpointsById[comp.serves]);
      (isZone ? zone : other).push(o);
    }
    for (const o of zone) { o.t = zoneTarget(o.c); o.region = regionOf(o.t); o.down = d.y + d.h / 2 < o.t.cardTop; }
    // nesting: farthest destination → top port for downward drops; the mirror
    // (nearest first) when the wire rises UP onto a card bottom border
    // nesting across stacked rows: ports go shallow-row-first (top), and riser
    // allocation direction makes deep rows take the risers nearer the rack /
    // gutter edge, so no riser ever pierces a shallower row's lane.
    const west = zone.filter(o => o.region === "top")
      .sort((a, b) => (b.t.cardTop - a.t.cardTop) || (a.t.tx - b.t.tx)); // deep ROW first → west riser
    const eastDown = zone.filter(o => o.region !== "top" && o.down).sort((a, b) => b.t.tx - a.t.tx);
    const eastUp = zone.filter(o => o.region !== "top" && !o.down)
      .sort((a, b) => (a.t.cardTop - b.t.cardTop) || (a.t.tx - b.t.tx)); // shallow ROW first → west riser
    const east = [...eastDown, ...eastUp];
    // if a col-C device sits in this device's row band, east stubs must exit
    // around it — give the east group the top ports in that case
    const cObstacle = (r.devices || []).some(d2 => d2.col === "C" && d2.x > d.x &&
      d2.y < d.y + d.h && d2.y + d2.h > d.y);
    const ordered = cObstacle && east.length ? [...east, ...west, ...other] : [...west, ...east, ...other];
    const [min, max] = portSpan(d);
    const mid = (min + max) / 2, n = ordered.length;
    const pitch = n > 1 ? Math.min(RT.portPitch, Math.max(10, (max - min) / (n - 1))) : RT.portPitch;
    ordered.forEach((o, k) => {
      o.portY = Math.max(min, Math.min(max, mid + (k - (n - 1) / 2) * pitch));
      (rightPorts[d.id] ||= []).push(o.portY);
      portPlan[wireId(o.c)] = o.portY;   // pass-4 classes reuse their reserved exit
    });
    plans.push({ dev: d, ordered, west, east, other });
  }

  /* ============ pass 3: rigid non-zone wires FIRST (short structural runs
     claim their channels; zone feeds are flexible and relaxable) ============ */
  visConns.forEach((conn, i) => {
    if (done.has(i)) return;
    const compTo = s.companions[conn.to];
    if (ix.endpointsById[conn.to] || (compTo && ix.endpointsById[compTo.serves])) return; // zone-bound: pass 4
    const fromDev = devById[conn.from], toDev = devById[conn.to];
    const fromChip = chipById[conn.from], toChip = chipById[conn.to];

    if (fromDev && toDev) { routeRackToRack(conn, fromDev, toDev); done.add(i); return; }
    if (fromDev && toChip) { routeDevToChip(conn, fromDev, toChip); done.add(i); return; }
    if (fromChip && toDev) { routeChipToDev(conn, fromChip, toDev); done.add(i); return; }
    if (ix.endpointsById[conn.from] && toDev) return; // audio returns route LAST (pass 4c) so they can dodge the corridor
    out.warnings.push({ code: "unrouted", msg: `no route class for ${wireId(conn)}` });
  });

  /* ============ pass 4a: WEST wires — ONE global river-ordered pass ============
     All top-band feeds across every device, sorted by drop-x: westmost drop
     takes the TOP corridor lane and the EASTMOST riser of its channel. For
     right-side risers over left-side drops this ordering is crossing-free
     across fan-out groups — the least-hops rule applied at corridor scale. */
  const westNetsByDev = {};
  const allWest = plans.flatMap(plan => plan.west.map(o => ({ plan, o }))); // plan order (farthest-first within device) — measured better than global river order
  for (const { plan, o } of allWest) {
    const d = plan.dev;
    const sx = d.x + d.w;
    const westNets = westNetsByDev[d.id] ||= [];
    {
      const { tx, landY, cardBot } = o.t;
      const land = landY ?? cardBot;                 // chip bottom or card bottom border
      const skip = new Set([d.id, o.t.chipId].filter(Boolean));
      // riser channel by source column: colB uses gapBC, colC/right uses the right corridor
      const rr = d.col === "B" ? gapBCx : riserRange;
      const corTop = P.corridors.find(c => c.id === "top");
      const laneLo = land + 14;
      const laneHi = (corTop?.y ?? land) + (corTop?.h ?? 200) - 8;
      let pts = null, usedRelax = false;
      // riser channels in preference order: the column/corridor channel, then the
      // gutter east of the whole top band (row-1 targets in a multi-row band are
      // reachable only via the between-rows strip entered from the band's east end).
      // If nesting starves the wire, retry with the sibling constraint relaxed —
      // a bridged sibling crossing beats unroutable geometry (last resort).
      const topBandRightX = Math.max(...P.zones.filter(z => z.band === "top").map(z => z.x + z.w), rackRight);
      for (const relax of [false, true]) {
        for (const rrTry of [rr, [topBandRightX + 8, topBandRightX + 90]]) {
          scanLane(laneHi, -1, [laneLo, laneHi], Math.min(tx, rrTry[0]), Math.max(tx, rrTry[1]), nWire, y => {
            const riserX = alloc(usedV, rrTry[0], Math.min(y, o.portY), Math.max(y, o.portY), nWire, +1,
              x => segBlocked(x, Math.min(y, o.portY), x, Math.max(y, o.portY), skip), rrTry);
            if (riserX == null) { dbg(o, { y, fail: "riser", rrTry }); return false; }
            const cand = [[sx, o.portY], [riserX, o.portY], [riserX, y], [tx, y], [tx, land]];
            const bl = pathBlocked(cand, skip);
            if (bl) { dbg(o, { y, riserX, fail: "blocked:" + bl }); return false; }
            if (!pathRegisterable(cand, nWire)) { dbg(o, { y, riserX, fail: "registry" }); return false; }
            if (!relax) { const sib = crossesSiblings(cand, westNets); if (sib) { dbg(o, { y, riserX, fail: "sibling", sib }); return false; } }
            pts = cand;
            return true;
          });
          if (pts) break;
        }
        if (pts) { usedRelax = relax; break; }
      }
      if (pts && !usedRelax) westNets.push(commit(o.c, "zone-west", pts, { group: d.id + "-west" }).net);
      else if (pts) { commit(o.c, "zone-west", pts, { group: d.id + "-west", relaxed: true }); out.warnings.push({ code: "route-relaxed", msg: wireId(o.c) }); }
      else { commit(o.c, "zone-west-fallback", [[sx, o.portY], [tx, o.portY], [tx, land]], { group: d.id }); out.warnings.push({ code: "route-fallback", msg: wireId(o.c) }); }
      done.add(o.i);
    }
  }

  /* ============ pass 4b: EAST wires per plan ============ */
  for (const plan of plans) {
    const d = plan.dev;
    const sx = d.x + d.w;
    const eastNets = [];
    const westNets = westNetsByDev[d.id] || [];
    // EAST (audio band / clusters): straight-east-then-turn; else stage via the
    // gutter west of the target; else escape the rack row through the BC gap.
    // Risers advance monotonically per (group × gutter) so a later sibling's
    // riser can never sit on the wrong side of an earlier one (nesting).
    const riserTrack = {};
    for (const o of plan.east) {
      const { tx, landY, cardTop, cardBot } = o.t;
      const skip = new Set([d.id, o.t.chipId].filter(Boolean));

      const finishFrom = (px, py, prefix, inverted = false, relax = false) => {
        const sibNets = relax ? [] : eastNets;
        const above = py < cardTop;
        const land = landY ?? (above ? cardTop : cardBot);
        let pts = [...prefix, [px, py], [tx, py], [tx, land]];
        if (!pathBlocked(pts, skip) && pathRegisterable(pts, nWire) && !crossesSiblings(pts, sibNets)) return pts;
        const gutter = gutterFor(tx);
        let found = null;
        const tryStaged = (landAt, rng, desired, dir) => {
          // pre-check span = the ACTUAL lane segment (riser gutter → target),
          // not the whole wire extent — anything wider false-conflicts.
          // A below-rack escape nests MIRRORED: east-most riser first, lanes
          // scanned upward (later siblings higher + wester = no crossings).
          const rk = gutter[0] + (inverted ? "i" : "n");
          const prev = riserTrack[rk];
          const rDesired = inverted
            ? Math.min(gutter[1] - 6, prev != null ? prev - 12 : gutter[1] - 6)
            : Math.max(gutter[0] + 6, prev != null ? prev + 12 : gutter[0] + 6);
          const rRange = inverted ? [gutter[0], rDesired] : [rDesired, gutter[1]];
          scanLane(desired, inverted ? -dir : dir, rng, Math.min(gutter[0], tx), Math.max(gutter[1], tx), nWire, y => {
            const riserX = alloc(usedV, rDesired, Math.min(py, y), Math.max(py, y), nWire, inverted ? -1 : +1,
              x => segBlocked(x, Math.min(py, y), x, Math.max(py, y), skip), rRange);
            if (riserX == null) { dbg(o, { y, fail: "riser" }); return false; }
            const cand = [...prefix, [px, py], [riserX, py], [riserX, y], [tx, y], [tx, landAt]];
            const bl = pathBlocked(cand, skip);
            if (bl) { dbg(o, { y, riserX, fail: "blocked:" + bl }); return false; }
            if (!pathRegisterable(cand, nWire)) {
              if (opts.debug) {
                for (let i = 0; i < cand.length - 1; i++) {
                  const [x1, y1] = cand[i], [x2, y2] = cand[i + 1];
                  const used = y1 === y2 ? usedH : usedV;
                  const c0 = y1 === y2 ? y1 : x1, a1 = y1 === y2 ? Math.min(x1, x2) : Math.min(y1, y2), a2 = y1 === y2 ? Math.max(x1, x2) : Math.max(y1, y2);
                  const hit = used.find(u => u.net !== nWire && Math.abs(u.c - c0) < RT.clear && Math.min(u.a2, a2) - Math.max(u.a1, a1) > -2);
                  if (hit) { dbg(o, { y, riserX, fail: "registry", seg: [x1, y1, x2, y2], vs: { c: hit.c, a1: hit.a1, a2: hit.a2, net: hit.net, id: out.wires.find(w => w.net === hit.net)?.id } }); break; }
                }
              }
              return false;
            }
            const sib = crossesSiblings(cand, sibNets); if (sib) { dbg(o, { y, riserX, fail: "sibling", sib }); return false; }
            found = cand;
            riserTrack[rk] = riserX;
            return true;
          });
          return found;
        };
        if (above) tryStaged(land, [Math.max(20, cardTop - 320), cardTop - 14], cardTop - 26, -1);
        else tryStaged(land, [cardBot + 14, cardBot + 340], cardBot + 40, +1);
        // starved strip: a plain border target may land on the OPPOSITE border
        // (feeds over the top of the band) — chips can't flip, their stub is fixed
        if (!found && landY == null)
          tryStaged(above ? cardBot : cardTop,
            above ? [cardBot + 14, cardBot + 340] : [Math.max(20, cardTop - 320), cardTop - 14],
            above ? cardBot + 40 : cardTop - 26, above ? +1 : -1);
        return found;
      };

      let why = "";
      let pts = null, usedRelax = false;
      // last-resort tier: a pinned exit port (6px foreign near-miss) may retry
      // on an adjacent port
      const basePort = o.portY;
      const [pmin, pmax] = portSpan(d);
      for (const dp of [0, -12, 12, -24, 24]) {
        const pv = basePort + dp;
        if (pv < pmin || pv > pmax) continue;
        if (dp !== 0 && (rightPorts[d.id] || []).some(u => u !== basePort && Math.abs(u - pv) < 10)) continue;
        o.portY = pv;
      for (const relax of [false, true]) {
        pts = finishFrom(sx, o.portY, [], false, relax);
        if (!pts) why += relax ? "relaxed direct/staged failed; " : "direct/staged failed; ";
        if (!pts && (segBlocked(sx + 2, o.portY, tx, o.portY, skip) || conflicts(usedH, o.portY, sx, tx, nWire))) {
          // the exit row is walled (col-C neighbor) or lane-pinned: duck through
          // the nearest vertical channel onto a highway below (preferred) or
          // above the rack, continue east from there
          const exChan = gapBCx;
          for (const hyDesired of [rackBottom + 16, rackTop - 16]) {
            const dir = hyDesired > o.portY ? +1 : -1;
            const hy = alloc(usedH, hyDesired, colBx, tx, nWire, dir,
              y => segBlocked(colBx, y, tx, y, skip), null);
            if (hy == null) { why += "escape hy null; "; continue; }
            // descend on the EAST side of the channel — clear of the west-group
            // stubs that hug the west risers
            const ex = alloc(usedV, exChan[1] - 6, Math.min(o.portY, hy), Math.max(o.portY, hy), nWire, -1,
              x => segBlocked(x, Math.min(o.portY, hy), x, Math.max(o.portY, hy), skip), exChan);
            if (ex == null) { why += "escape ex null; "; continue; }
            pts = finishFrom(ex, hy, [[sx, o.portY], [ex, o.portY]], !relax && hy > o.portY, relax);
            if (!pts) why += `escape finish failed hy=${hy}; `;
            if (pts) break;
          }
        }
        if (pts) { usedRelax = relax; break; }
      }
      if (pts) { if (dp !== 0) (rightPorts[d.id] ||= []).push(pv); break; }
      }
      if (!pts) o.portY = basePort;
      if (pts && !usedRelax) eastNets.push(commit(o.c, "zone-east", pts, { group: d.id + "-east" }).net);
      else if (pts) { commit(o.c, "zone-east", pts, { group: d.id + "-east", relaxed: true }); out.warnings.push({ code: "route-relaxed", msg: wireId(o.c) }); }
      else {
        // flyover of last resort: dive beside the device, ride below the whole
        // drawing, rise at the target — legal (checked) if inelegant
        const land = landY ?? cardBot;
        let fb = null;
        for (const vx of [sx + 8, sx + 20, sx + 32]) {
          for (const bigY of [P.bounds.h - 10, P.bounds.h + 30, P.bounds.h + 70]) {
            const cand = [[sx, o.portY], [vx, o.portY], [vx, bigY], [tx, bigY], [tx, land]];
            if (!pathBlocked(cand, skip) && pathRegisterable(cand, nWire)) { fb = cand; break; }
          }
          if (fb) break;
        }
        if (fb) { commit(o.c, "zone-east", fb, { group: d.id + "-east", relaxed: true }); out.warnings.push({ code: "route-relaxed", msg: wireId(o.c) + " (flyover)" }); }
        else {
          commit(o.c, "zone-east-fallback", [[sx, o.portY], [tx, o.portY], [tx, land]], { group: d.id });
          out.warnings.push({ code: "route-fallback", msg: wireId(o.c), why });
        }
      }
      done.add(o.i);
    }
    if (westNets.length > 1) out.groups.push({ dev: d.id + "-west", nets: westNets });
    if (eastNets.length > 1) out.groups.push({ dev: d.id + "-east", nets: eastNets });
  }

  function tryCommit(conn, cls, cands, skip) {
    for (const pts of cands) {
      if (!pts || pts.some(p => p[0] == null || p[1] == null)) continue;
      if (!pathBlocked(pts, skip) && pathRegisterable(pts, nWire)) return commit(conn, cls, pts);
    }
    const pts = cands.find(Boolean);
    if (pts && !pts.some(p => p[0] == null || p[1] == null)) {
      out.warnings.push({ code: "route-fallback", msg: wireId(conn) });
      return commit(conn, cls + "-fallback", pts);
    }
    out.warnings.push({ code: "unrouted", msg: wireId(conn) });
    return null;
  }

  function routeRackToRack(conn, a, b) {
    const sx = a.x + a.w, skip = new Set([a.id, b.id]);
    const rackOf = t => P.racks.find(r => r.devices.some(d => d.id === t.id));
    // right-edge ↔ right-edge staple (inter-rack switch trunk, or same-column wrap target)
    if (b.x <= a.x && b.x + b.w >= a.x + a.w * 0.5 && rackOf(a) !== rackOf(b)) {
      // stacked racks, aligned columns: tight staple beside the aligned devices
      const sy = portPlan[wireId(conn)] ?? takeRightPort(a, a.y + a.h / 2);
      const ty = takeRightPort(b, b.y + b.h / 2);
      const gx = alloc(usedV, sx + 14, Math.min(sy, ty), Math.max(sy, ty), nWire, +1,
        x => segBlocked(x, Math.min(sy, ty), x, Math.max(sy, ty), skip), [sx + 8, sx + 80]);
      tryCommit(conn, "staple", [gx != null ? [[sx, sy], [gx, sy], [gx, ty], [b.x + b.w, ty]] : null], skip);
      return;
    }
    const sy = portPlan[wireId(conn)] ?? takeRightPort(a, a.y + a.h / 2);
    if (b.x >= sx) {
      // rightward flow into the next column: straight, else Z in the gap, else a
      // double-jog through a free inter-row level; the entry port scans the
      // target's left edge until the whole path checks out
      const gap = b.col === "C" ? gapBCx : gapABx;
      const [tmin, tmax] = portSpan(b);
      const tyDesired = Math.max(tmin, Math.min(tmax, sy));
      let committed = null;
      for (let k = 0; k <= Math.ceil((tmax - tmin) / RT.lane) + 1 && !committed; k++) {
        for (const sgn of k ? [1, -1] : [1]) {
          const ty = tyDesired + sgn * k * RT.lane;
          if (ty < tmin || ty > tmax || (leftPorts[b.id] || []).some(u => Math.abs(u - ty) < 10)) continue;
          const cands = [];
          if (sy === ty) cands.push([[sx, sy], [b.x, ty]]);
          const zx = alloc(usedV, (gap[0] + gap[1]) / 2, Math.min(sy, ty), Math.max(sy, ty), nWire, 0,
            x => segBlocked(x, Math.min(sy, ty), x, Math.max(sy, ty), skip), gap);
          if (zx != null) cands.push([[sx, sy], [zx, sy], [zx, ty], [b.x, ty]]);
          // double-jog (col A → C, or when the single Z is starved)
          const my = alloc(usedH, sy, gapABx[0], gapBCx[1], nWire, 0,
            y => segBlocked(gapABx[0], y, gapBCx[1], y, skip), [rackTop + 26, rackBottom - 10]);
          const gap1 = a.col === "A" ? gapABx : gapBCx;
          const abx = my != null ? alloc(usedV, (gap1[0] + gap1[1]) / 2, Math.min(sy, my), Math.max(sy, my), nWire, 0,
            x => segBlocked(x, Math.min(sy, my), x, Math.max(sy, my), skip), gap1) : null;
          const bcx = my != null ? alloc(usedV, gap[1] - 6, Math.min(my, ty), Math.max(my, ty), nWire, -1,
            x => segBlocked(x, Math.min(my, ty), x, Math.max(my, ty), skip), gap) : null;
          if (my != null && abx != null && bcx != null && Math.abs(abx - bcx) > 6)
            cands.push([[sx, sy], [abx, sy], [abx, my], [bcx, my], [bcx, ty], [b.x, ty]]);
          for (const cand of cands) {
            if (!cand || pathBlocked(cand, skip) || !pathRegisterable(cand, nWire)) continue;
            (leftPorts[b.id] ||= []).push(ty);
            committed = commit(conn, "intra", cand);
            break;
          }
          if (committed) break;
        }
      }
      if (!committed) {
        const ty = takeLeftPort(b, sy);
        tryCommit(conn, "intra", [[[sx, sy], [(sx + b.x) / 2, sy], [(sx + b.x) / 2, ty], [b.x, ty]]], skip);
      }
    } else {
      // same column (or leftward): wrap over the top of the column
      const ty = takeLeftPort(b, sy);
      const rack = rackOf(b) || rackOf(a);
      const overY = alloc(usedH, rack.y + 26, gapABx[0], gapBCx[1], nWire, +1,
        y => segBlocked(gapABx[0], y, gapBCx[1], y, skip), [rack.y + 26, rack.y + PL.rackPadTop - 4]);
      const upX = alloc(usedV, (gapBCx[0] + gapBCx[1]) / 2, overY ?? rack.y, sy, nWire, 0,
        x => overY != null && segBlocked(x, overY, x, sy, skip), gapBCx);
      const dnX = alloc(usedV, (gapABx[0] + gapABx[1]) / 2, overY ?? rack.y, ty, nWire, 0,
        x => overY != null && segBlocked(x, overY, x, ty, skip), gapABx);
      tryCommit(conn, "wrap", [
        overY != null && upX != null && dnX != null ?
          [[sx, sy], [upX, sy], [upX, overY], [dnX, overY], [dnX, ty], [b.x, ty]] : null,
      ], skip);
    }
  }

  function routeDevToChip(conn, a, chip) {
    const sx = a.x + a.w, ccy = chip.y + chip.h / 2;
    const sy = portPlan[wireId(conn)] ?? takeRightPort(a, a.y + a.h / 2);
    const skip = new Set([a.id, chip.id]);
    if (chip.x >= sx) {
      // chip to the right (ENC beside its source): straight or tiny Z into its left edge
      const mx = alloc(usedV, sx + RT.lane, Math.min(sy, ccy), Math.max(sy, ccy), nWire, 0, null, [sx + 4, chip.x - 4]);
      tryCommit(conn, "chip-feed", [
        Math.abs(sy - ccy) < 1 ? [[sx, sy], [chip.x, ccy]] : null,
        mx != null ? [[sx, sy], [mx, sy], [mx, ccy], [chip.x, ccy]] : null,
      ], skip);
    } else {
      // chip west or below: exit right, ride a gap channel, approach the chip top
      const cx = chip.x + chip.w / 2;
      const gx = alloc(usedV, (gapBCx[0] + gapBCx[1]) / 2, 0, 1, nWire, 0, null, gapBCx);
      const belowChip = chip.x + chip.w > a.x;   // tucked under a device, not west of the column
      if (belowChip) {
        // tucked-below chip (e.g. DEC feeding the amp it sits under)
        const laneY = alloc(usedH, chip.y + chip.h / 2, Math.min(gx ?? sx, chip.x), sx + 20, nWire, 0,
          y => segBlocked(Math.min(gx ?? sx, chip.x), y, sx, y, skip), null);
        const gx2 = gx != null && laneY != null ? alloc(usedV, gx, Math.min(sy, laneY), Math.max(sy, laneY), nWire, 0,
          x => segBlocked(x, Math.min(sy, laneY), x, Math.max(sy, laneY), skip), gapBCx) : null;
        tryCommit(conn, "chip-feed", [
          gx2 != null && laneY != null ? [[sx, sy], [gx2, sy], [gx2, laneY], [chip.x, laneY]] : null,
        ], skip);
      } else {
        // chip west (DEC left of a col-B device): over an inter-row gap, drop to
        // chip top — lane and gap channel validated jointly per candidate; a
        // pinned exit port may retry on an adjacent one
        let pts = null;
        const [smin, smax] = portSpan(a);
        for (const dsy of [0, -12, 12, -24, 24]) {
          const syv = sy + dsy;
          if (syv < smin || syv > smax) continue;
          if (dsy !== 0 && (rightPorts[a.id] || []).some(u => u !== sy && Math.abs(u - syv) < 10)) continue;
          // badge exemption: the chip accepts its feed on top OR bottom edge —
          // whichever inter-row strip has a free lane
          scanLane(chip.y - 14, 0, [Math.min(a.y, chip.y - 40), chip.y + chip.h + 60], cx, gapBCx[1], nWire, y => {
            if (y >= chip.y - 3 && y <= chip.y + chip.h + 3) return false; // never through the chip band
            const landAt = y < chip.y ? chip.y : chip.y + chip.h;
            const gx2 = alloc(usedV, gapBCx[1] - 6, Math.min(syv, y), Math.max(syv, y), nWire, -1,
              x => segBlocked(x, Math.min(syv, y), x, Math.max(syv, y), skip), gapBCx);
            if (gx2 == null) return false;
            const cand = [[sx, syv], [gx2, syv], [gx2, y], [cx, y], [cx, landAt]];
            if (pathBlocked(cand, skip) || !pathRegisterable(cand, nWire)) return false;
            pts = cand;
            return true;
          });
          if (!pts && chip.y > a.y - 100) {
            // wrap over the column top and drop straight onto the chip
            const rack2 = P.racks.find(rk => rk.devices.some(dd => dd.id === a.id)) || P.racks[0];
            const overY = alloc(usedH, rack2.y + 26, cx, gapBCx[1], nWire, +1,
              y => segBlocked(cx, y, gapBCx[1], y, skip), [rack2.y + 26, rack2.y + PL.rackPadTop - 4]);
            const gx3 = overY != null ? alloc(usedV, gapBCx[1] - 6, Math.min(syv, overY), Math.max(syv, overY), nWire, -1,
              x => segBlocked(x, Math.min(syv, overY), x, Math.max(syv, overY), skip), gapBCx) : null;
            if (overY != null && gx3 != null) {
              const cand = [[sx, syv], [gx3, syv], [gx3, overY], [cx, overY], [cx, chip.y]];
              if (!pathBlocked(cand, skip) && pathRegisterable(cand, nWire)) pts = cand;
            }
          }
          if (pts) { if (dsy !== 0) (rightPorts[a.id] ||= []).push(syv); break; }
        }
        tryCommit(conn, "chip-feed", [pts], skip);
      }
    }
  }

  function routeChipToDev(conn, chip, b) {
    // chip badge output exits toward the device it feeds (badge exemption)
    const ccy = chip.y + chip.h / 2, skip = new Set([chip.id, b.id]);
    const chipR = chip.x + chip.w;
    const ty = takeLeftPort(b, ccy);
    const cands = [];
    if (chipR <= b.x) {
      if (Math.abs(ty - ccy) < 1) cands.push([[chipR, ccy], [b.x, ty]]);
      if (b.x - chipR >= 20) {
        const mx = alloc(usedV, (chipR + b.x) / 2, Math.min(ccy, ty), Math.max(ccy, ty), nWire, 0,
          x => segBlocked(x, Math.min(ccy, ty), x, Math.max(ccy, ty), skip), [chipR + 4, b.x - 4]);
        if (mx != null) cands.push([[chipR, ccy], [mx, ccy], [mx, ty], [b.x, ty]]);
      }
      // tight squeeze (chip parked right beside the hub): exit the chip's LEFT
      // edge and ride the AB gap to the input row
      const wx = alloc(usedV, Math.min(gapABx[1], chip.x - 10), Math.min(ccy, ty), Math.max(ccy, ty), nWire, -1,
        x => segBlocked(x, Math.min(ccy, ty), x, Math.max(ccy, ty), skip), [gapABx[0], Math.min(gapABx[1], chip.x - 4)]);
      if (wx != null) cands.push([[chip.x, ccy], [wx, ccy], [wx, ty], [b.x, ty]]);
    } else {
      // chip below/right of its device: rise into the left edge via the west gap
      const gap = b.col === "C" ? gapBCx : gapABx;
      const wx = alloc(usedV, gap[1] - 6, Math.min(ccy, ty), Math.max(ccy, ty), nWire, -1,
        x => segBlocked(x, Math.min(ccy, ty), x, Math.max(ccy, ty), skip), gap);
      if (wx != null) cands.push([[chip.x, ccy], [wx, ccy], [wx, ty], [b.x, ty]]);
    }
    tryCommit(conn, "chip-out", cands, skip);
  }

  function routeReturn(conn, b) {
    // audio return: starts at the border aligned with the display, wraps to the
    // input module's LEFT edge — least-hops around the corridor bundles
    const { pz, cx } = slotOf(conn.from);
    const compChip = (sol.companions || []).find(c => c.serves === conn.from);
    const chipHalf = compChip ? (chipById[compChip.id]?.w ?? 0) / 2 + 8 : 0;
    const sx0 = feedsToEp[conn.from] ? cx + Math.max(RT.lane, chipHalf) : cx;
    const skip = new Set([pz.id, b.id]);
    const corTop = P.corridors.find(c => c.id === "top");
    // hug the strip just under the source card, above the corridor's feed lanes
    // — the return crosses only the drops it can't avoid (least-hops)
    const laneLo = pz.y + pz.h + 14;
    // range reaches below the rack too — a return from a far cluster may have to
    // travel under everything to reach the AB gap
    const laneHi = Math.max(corTop ? corTop.y + corTop.h - 6 : pz.y + pz.h + 220, rackBottom + 320);
    const ty = takeLeftPort(b, b.y + b.h / 2);
    // gather every valid (lane, channel) candidate and take the one that costs
    // the fewest hops — returns route last, so the corridor is fully known
    let best = null, bestCost = Infinity, seen = 0;
    scanLane(laneLo, +1, [laneLo, laneHi], gapABx[0], sx0, nWire, y => {
      for (const range of [gapABx, westMarginX]) {
        const wx = alloc(usedV, range === gapABx ? (range[0] + range[1]) / 2 : range[1],
          Math.min(y, ty), Math.max(y, ty), nWire, range === gapABx ? 0 : -1,
          x => segBlocked(x, Math.min(y, ty), x, Math.max(y, ty), skip), range);
        if (wx == null) continue;
        const cand = [[sx0, pz.y + pz.h], [sx0, y], [wx, y], [wx, ty], [b.x, ty]];
        if (pathBlocked(cand, skip) || !pathRegisterable(cand, nWire)) continue;
        const cost = countCrossings(cand);
        if (cost < bestCost) { best = cand; bestCost = cost; }
        seen++;
      }
      return seen >= 10 || bestCost === 0; // stop early on a clean lane, else sample up to 10
    });
    tryCommit(conn, "return", [best], skip);
  }

  /* ============ pass 4c: audio returns — last, so they can dodge everything ============ */
  visConns.forEach((conn, i) => {
    if (done.has(i)) return;
    const toDev = devById[conn.to];
    if (ix.endpointsById[conn.from] && toDev) { routeReturn(conn, toDev); done.add(i); return; }
    out.warnings.push({ code: "unrouted", msg: `no route class for ${wireId(conn)}` });
  });

  /* ============ pass 5: crossings → hops ============ */
  computeHops(out);
  if (opts.debug) out.channels = { h: usedH, v: usedV };  // registered segments, for the congestion overlay
  return out;
}

function computeHops(out) {
  // collect segments
  const segs = [];
  out.wires.forEach(w => w.pts.forEach((p, i) => {
    if (i === 0) return;
    const [x1, y1] = w.pts[i - 1], [x2, y2] = p;
    segs.push({ w, si: i - 1, x1, y1, x2, y2, vert: x1 === x2 });
  }));
  const crossings = [];
  for (const a of segs) for (const b of segs) {
    if (a.w.net >= b.w.net || a.vert === b.vert) continue;
    const v = a.vert ? a : b, h = a.vert ? b : a;
    const hx1 = Math.min(h.x1, h.x2), hx2 = Math.max(h.x1, h.x2);
    const vy1 = Math.min(v.y1, v.y2), vy2 = Math.max(v.y1, v.y2);
    if (v.x1 > hx1 + 1 && v.x1 < hx2 - 1 && h.y1 > vy1 + 1 && h.y1 < vy2 - 1)
      crossings.push({ v, h, x: v.x1, y: h.y1 });
  }
  // ownership: a segment crossing an adjacent same-signal bundle bridges it
  // wide; otherwise the vertical hops (matches the mocks)
  const byV = new Map(), byH = new Map();
  for (const c of crossings) {
    (byV.get(c.v) ?? byV.set(c.v, []).get(c.v)).push(c);
    (byH.get(c.h) ?? byH.set(c.h, []).get(c.h)).push(c);
  }
  const clusterKeyed = (list, coord) => {
    const sorted = [...list].sort((a, b) => a[coord] - b[coord]);
    const groups = [];
    for (const c of sorted) {
      const g = groups[groups.length - 1];
      if (g && c[coord] - g[g.length - 1][coord] <= RT.hopMerge && c === c) g.push(c); else groups.push([c]);
    }
    return groups;
  };
  const assigned = new Set();
  // wide bridges: a horizontal crossing ≥2 clustered same-signal verticals
  for (const [h, list] of byH) {
    for (const g of clusterKeyed(list, "x")) {
      if (g.length >= 2 && g.every(c => c.v.w.signal === g[0].v.w.signal)) {
        h.w.hops.push({ si: h.si, x: (g[0].x + g[g.length - 1].x) / 2, y: g[0].y, w: g[g.length - 1].x - g[0].x + 2 * RT.hopR, orient: "h" });
        g.forEach(c => assigned.add(c));
      }
    }
  }
  for (const [v, list] of byV) {
    for (const g of clusterKeyed(list, "y")) {
      const rest = g.filter(c => !assigned.has(c));
      if (!rest.length) continue;
      if (rest.length >= 2 && rest.every(c => c.h.w.signal === rest[0].h.w.signal)) {
        v.w.hops.push({ si: v.si, x: rest[0].x, y: (rest[0].y + rest[rest.length - 1].y) / 2, w: rest[rest.length - 1].y - rest[0].y + 2 * RT.hopR, orient: "v" });
      } else {
        rest.forEach(c => v.w.hops.push({ si: v.si, x: c.x, y: c.y, w: 2 * RT.hopR, orient: "v" }));
      }
      rest.forEach(c => assigned.add(c));
    }
  }
  out.crossings = crossings.length;
}

/* ---------- render ----------
   The finished SVG sheet: placement + routed wires drawn in the approved
   mock-sheet.svg language (grid frame, dashed cards, icon glyphs, chips,
   colored runs with hop arcs, dynamic legend, vertical Synergy title block).
   Pure string builder — no DOM. */

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// SVG path for a routed wire with hop arcs spliced in:
// vertical hops bulge RIGHT (sweep 1 downward, 0 upward);
// horizontal hops bulge UP (sweep 0 right→left, 1 left→right)
export function wireD(w) {
  let d = `M${w.pts[0][0]} ${w.pts[0][1]}`;
  for (let i = 1; i < w.pts.length; i++) {
    const [x1, y1] = w.pts[i - 1], [x2, y2] = w.pts[i];
    const hops = (w.hops || []).filter(h => h.si === i - 1)
      .sort((a, b) => x1 === x2 ? (y2 > y1 ? a.y - b.y : b.y - a.y) : (x2 > x1 ? a.x - b.x : b.x - a.x));
    for (const h of hops) {
      const r = h.w / 2;
      if (x1 === x2) {
        const dir = y2 > y1 ? 1 : -1, sweep = y2 > y1 ? 1 : 0;
        d += `L${x1} ${h.y - dir * r}A${r} ${r} 0 0 ${sweep} ${x1} ${h.y + dir * r}`;
      } else {
        const dir = x2 > x1 ? 1 : -1, sweep = x2 > x1 ? 1 : 0;
        d += `L${h.x - dir * r} ${y1}A${r} ${r} 0 0 ${sweep} ${h.x + dir * r} ${y1}`;
      }
    }
    d += `L${x2} ${y2}`;
  }
  return d;
}

const LEGEND_LABELS = { video: "Video", audio: "Audio", audioReturn: "Audio Return", network: "Network", prewire: "Pre-wire" };
const fmtDate = iso => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${+m[2]}/${+m[3]}/${m[1].slice(2)}` : esc(iso); };

export function render(job, ix, P, rt, opts = {}) {
  const s = ix.solutions[opts.solution ?? 0];
  const sol = s.sol;
  const out = [];
  const push = (...x) => out.push(...x);

  push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET.width} ${SHEET.height}" font-family="'Avenir Next', Avenir, Futura, 'Helvetica Neue', sans-serif">`);

  /* defs: grid, TV gradient, speaker/sub glyphs, logo sphere clip */
  push(`<defs>
  <pattern id="gp" width="60" height="60" patternUnits="userSpaceOnUse">
    <path d="M12 0V60M24 0V60M36 0V60M48 0V60M0 12H60M0 24H60M0 36H60M0 48H60" stroke="#f0f1f4" stroke-width="1" fill="none"/>
    <path d="M0.5 0V60M0 0.5H60" stroke="#e3e5eb" stroke-width="1" fill="none"/>
  </pattern>
  <linearGradient id="tvg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d6e4f2"/><stop offset="1" stop-color="#9dbcd9"/></linearGradient>
  <g id="spk"><circle r="16" fill="#2d2d2d" stroke="#151515"/><circle r="9.5" fill="#8f8f8f" stroke="#3a3a3a"/><circle r="3" fill="#2d2d2d"/></g>
  <g id="spks"><circle r="10" fill="#2d2d2d" stroke="#151515"/><circle r="6" fill="#8f8f8f" stroke="#3a3a3a"/><circle r="1.8" fill="#2d2d2d"/></g>
  <g id="sub"><rect x="-15" y="-15" width="30" height="30" rx="3" fill="#2d2d2d" stroke="#151515"/><circle r="9" fill="#8f8f8f" stroke="#3a3a3a"/><circle r="2.6" fill="#2d2d2d"/></g>
</defs>`);

  /* sheet frame */
  push(`<rect width="${SHEET.width}" height="${SHEET.height}" fill="#fff"/>`);
  push(`<rect x="${SHEET.content.x}" y="${SHEET.content.y}" width="${SHEET.content.w}" height="${SHEET.content.h}" fill="url(#gp)"/>`);
  push(`<rect x="${SHEET.outerFrame.x}" y="${SHEET.outerFrame.y}" width="${SHEET.outerFrame.w}" height="${SHEET.outerFrame.h}" fill="none" stroke="#444" stroke-width="1.5"/>`);
  push(`<rect x="${SHEET.content.x}" y="${SHEET.content.y}" width="${SHEET.content.w}" height="${SHEET.content.h}" fill="none" stroke="#777"/>`);

  /* drawing space */
  push(`<g transform="translate(${SHEET.content.x} ${SHEET.content.y}) scale(${P.fitScale})">`);

  for (const h of P.areaHeaders)
    push(`<text x="${h.cx}" y="${h.y}" text-anchor="middle" font-size="13" letter-spacing="4" fill="#8a8a8a" font-weight="600">${esc(h.name)}</text>`);

  /* racks + devices */
  for (const r of P.racks) {
    push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="#8a8a8a" stroke-width="1.4" stroke-dasharray="7 5"/>`);
    push(`<text x="${r.x + 14}" y="${r.y + 24}" font-size="20" font-weight="700" fill="#111">${esc(r.name)}</text>`);
    for (const d of r.devices) {
      const dev = s.devices[d.id] || {};
      if (d.kind === "small") {
        const rx = dev.sourceType === "appletv" || dev.sourceType === "streamer" ? 8 : 3;
        push(`<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" rx="${rx}" fill="#1e1e1e"/>`);
        push(`<circle cx="${d.x + 9}" cy="${d.y + d.h / 2}" r="2.3" fill="#3fbf5a"/>`);
        push(faceGlyph(dev, d.x + d.w - 18, d.y + d.h / 2));
        push(`<text x="${d.x + d.w / 2}" y="${d.y + d.h + 15}" text-anchor="middle" font-size="12" fill="#333">${esc(d.model)}</text>`);
      } else if (d.kind === "amp") {
        push(`<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" rx="3" fill="#1c1c1c" stroke="#0d0d0d"/>`);
        const [brand, ...restName] = String(d.model || "").split(" ");
        push(`<text x="${d.x + d.w / 2}" y="${d.y + 16}" text-anchor="middle" font-size="11" fill="#ddd">${esc(brand)}</text>`);
        // channel strip: used (blue), reserved (gray), spare (outline)
        const zones = dev.zones || 8;
        const feeds = (sol.connections || []).filter(c => c.from === d.id && c.signal === "speaker");
        const slot = {};
        for (const f of feeds) {
          const ch = expandChannels(f.channels)[0] || 1;
          slot[Math.min(zones, Math.ceil(ch / 2))] = (f.scope || "included") !== "included" ? "res" : "used";
        }
        const pitch = Math.min(18, (d.w - 32) / zones), x0 = d.x + d.w / 2 - (zones - 1) * pitch / 2 - 3.5;
        for (let k = 1; k <= zones; k++) {
          const x = x0 + (k - 1) * pitch;
          const st = slot[k];
          push(st === "used" ? `<rect x="${x}" y="${d.y + 26}" width="7" height="11" fill="#3b82c4"/>` :
               st === "res" ? `<rect x="${x}" y="${d.y + 26}" width="7" height="11" fill="#8c8c8c"/>` :
                              `<rect x="${x}" y="${d.y + 26}" width="7" height="11" fill="none" stroke="#666"/>`);
          push(`<text x="${x + 3.5}" y="${d.y + 48}" text-anchor="middle" font-size="8" fill="#9aa">${k}</text>`);
        }
        push(`<text x="${d.x + d.w / 2}" y="${d.y + d.h - 10}" text-anchor="middle" font-size="11" fill="#eee">${esc(restName.join(" ") || d.model)}</text>`);
        push(`<circle cx="${d.x + d.w - 12}" cy="${d.y + d.h - 12}" r="2.2" fill="#3fbf5a"/>`);
      } else {
        push(`<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" rx="3" fill="#262626" stroke="#101010"/>`);
        const [brand, ...restName] = String(d.model || "").split(" ");
        push(`<text x="${d.x + d.w / 2}" y="${d.y + 17}" text-anchor="middle" font-size="11" fill="#ddd">${esc(brand)}</text>`);
        // faceplate identity cues (squint-test assists, never the identifier)
        const my = d.y + d.h / 2 + 3;
        if (dev.type === "avr") {
          push(`<rect x="${d.x + 14}" y="${my - 5}" width="34" height="10" rx="2" fill="#0d1116" stroke="#3a3f46" stroke-width="0.8"/>`);
          push(`<circle cx="${d.x + d.w - 24}" cy="${my}" r="8" fill="#161616" stroke="#7a7a7a" stroke-width="1.3"/>`);
          push(`<line x1="${d.x + d.w - 24}" y1="${my - 2}" x2="${d.x + d.w - 24}" y2="${my - 7}" stroke="#9a9a9a" stroke-width="1.3"/>`);
        } else if (dev.type === "videoMatrix") {
          for (let gi = 0; gi < 3; gi++) for (let gj = 0; gj < 3; gj++)
            push(`<circle cx="${d.x + d.w / 2 - 6 + gj * 6}" cy="${my - 6 + gi * 6}" r="1.3" fill="#8f8f8f"/>`);
        } else if (dev.type === "avSwitch") {
          for (let gi = 0; gi < 6; gi++)
            push(`<rect x="${d.x + d.w / 2 - 19 + gi * 6.5}" y="${my - 2}" width="4" height="4" fill="none" stroke="#8f8f8f" stroke-width="0.9"/>`);
        }
        push(`<text x="${d.x + d.w / 2}" y="${d.y + d.h - 10}" text-anchor="middle" font-size="10.5" fill="#eee">${esc(restName.join(" ") || "")}</text>`);
        push(`<circle cx="${d.x + d.w - 12}" cy="${d.y + d.h - 10}" r="2.2" fill="#3fbf5a"/>`);
      }
    }
  }

  /* zone cards */
  for (const z of P.zones) {
    const gray = z.scope !== "included";
    push(`<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" fill="none" stroke="${gray ? "#b5b5b5" : "#8a8a8a"}" stroke-width="1.4" stroke-dasharray="7 5"/>`);
    push(`<text x="${z.x + z.w / 2}" y="${z.y + 24}" text-anchor="middle" font-size="18" font-weight="700" fill="${gray ? "#999" : "#111"}">${esc(z.name)}</text>`);
    for (const g of z.groups) {
      const gx = z.x + g.x, gy = z.y + g.y;
      if (g.kind === "display") {
        push(`<rect x="${gx}" y="${gy}" width="${g.w}" height="${g.h}" fill="url(#tvg)" stroke="#556" stroke-width="1.2"/>`);
        push(`<text x="${gx + g.w / 2}" y="${gy + g.h / 2 - 3}" text-anchor="middle" font-size="11" fill="#233">${esc(g.brand)}</text>`);
        push(`<text x="${gx + g.w / 2}" y="${gy + g.h / 2 + 13}" text-anchor="middle" font-size="12" font-weight="600" fill="#233">${esc(g.sizeText)}</text>`);
        if (g.local) {
          const l = g.local, ldev = s.locals[l.deviceId] || {};
          push(`<rect x="${z.x + l.x}" y="${z.y + l.y}" width="${l.w}" height="${l.h}" rx="8" fill="#1e1e1e"/>`);
          push(faceGlyph(ldev, z.x + l.x + l.w - 15, z.y + l.y + l.h / 2) ||
               `<circle cx="${z.x + l.x + l.w - 11}" cy="${z.y + l.y + l.h / 2}" r="2.4" fill="#cfcfcf"/>`);
          push(`<text x="${z.x + l.x + l.w / 2}" y="${z.y + l.y + l.h / 2 + 3}" text-anchor="middle" font-size="8.5" fill="#bbb">${esc(l.label)}</text>`);
        }
      } else {
        push(speakerGlyphs(ix.endpointsById[g.epId], gx, gy, g.w));
      }
      push(`<text x="${z.x + g.cx}" y="${z.y + g.captionY}" text-anchor="middle" font-size="11.5" fill="#333">${esc(g.caption)}</text>`);
    }
  }

  /* annotations: small red notes near their zone */
  for (const a of sol.annotations || []) {
    const z = P.zones.find(z => z.id === a.near);
    if (z) push(`<text x="${z.x + z.w / 2}" y="${z.y + z.h + 52}" text-anchor="middle" font-size="10" fill="#b32017">${esc(a.text)}</text>`);
  }

  /* wires (under chips so badges sit inline on their runs) */
  push(`<g fill="none" stroke-width="2.2" stroke-linecap="round">`);
  for (const w of rt.wires) {
    const color = w.scope !== "included" ? SIGNAL_COLORS.prewire
      : SIGNAL_COLORS[w.signal === "speaker" ? "audio" : w.signal] || "#555";
    push(`<path class="wire" data-wire="${esc(w.id)}" d="${wireD(w)}" stroke="${color}"/>`);
  }
  push(`</g>`);

  /* companion chips */
  for (const c of P.chips) {
    push(`<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="2" fill="#1e1e1e"/>`);
    push(`<text x="${c.x + c.w / 2}" y="${c.y + 13}" text-anchor="middle" font-size="10" fill="#eee">${esc(c.type.toUpperCase())}</text>`);
    push(`<circle cx="${c.x + c.w - 6}" cy="${c.y + c.h / 2}" r="1.8" fill="#3fbf5a"/>`);
  }
  push(`</g>`); // end drawing space

  /* dynamic legend */
  const lg = P.legend;
  push(`<rect x="${lg.x}" y="${lg.y}" width="${lg.w}" height="${lg.h}" fill="#fff" stroke="#777"/>`);
  push(`<text x="${lg.x + 12}" y="${lg.y + 16}" font-size="10" font-weight="700" fill="#555" letter-spacing="1">LEGEND</text>`);
  lg.rows.forEach((k, i) => {
    const x = lg.x + 12 + i * 140;
    push(`<path d="M${x} ${lg.y + 36}H${x + 32}" stroke="${SIGNAL_COLORS[k]}" stroke-width="3" fill="none"/>`);
    push(`<text x="${x + 38}" y="${lg.y + 40}" font-size="11.5" fill="#333">${LEGEND_LABELS[k] || k}</text>`);
  });

  /* title block (vertical right edge, per the approved mock) */
  const tb = { x: SHEET.titleBlock.x, y: SHEET.titleBlock.y, w: 156, h: SHEET.titleBlock.h };
  const J = job.job || {};
  const [addr1, ...addrRest] = String(J.client?.address || "").split(",");
  const stage = (J.stage || "proposal").toLowerCase();
  const stageTxt = stage === "asbuilt" || stage === "as-built" ? "AS-BUILT" : "PROPOSAL";
  const stageCol = stageTxt === "AS-BUILT" ? "#2f7a3a" : "#b32017";
  const revs = (J.revisions || []).slice(-4);
  const lastDate = revs.length ? revs[revs.length - 1].date : J.catalogSnapshot?.asOf;
  const cx = tb.x + tb.w / 2;
  push(`<rect x="${tb.x}" y="${tb.y}" width="${tb.w}" height="${tb.h}" fill="#fff" stroke="#444" stroke-width="1.2"/>`);
  push(`<line x1="${tb.x}" y1="300" x2="${tb.x + tb.w}" y2="300" stroke="#444"/>`);
  // logo mark removed for now (text-only wordmark until the authentic logo file lands)
  const co = { name: "SYNERGY", tagline: "AUDIO VIDEO SYSTEMS",
    info: "300 El Camino Real · Tustin, CA 92780 · P: 714-505-2003 · www.synergy.tv", ...(opts.company || {}) };
  push(`<text transform="rotate(-90 ${tb.x + 56} 160)" x="${tb.x + 56}" y="160" text-anchor="middle" font-size="26" font-weight="700" letter-spacing="7" fill="#111">${esc(co.name)}</text>`);
  push(`<text transform="rotate(-90 ${tb.x + 88} 160)" x="${tb.x + 88}" y="160" text-anchor="middle" font-size="9" letter-spacing="2.6" fill="#444">${esc(co.tagline)}</text>`);
  push(`<text transform="rotate(-90 ${tb.x + 118} 160)" x="${tb.x + 118}" y="160" text-anchor="middle" font-size="7.5" fill="#666">${esc(co.info)}</text>`);
  push(`<line x1="${tb.x}" y1="470" x2="${tb.x + tb.w}" y2="470" stroke="#444"/>`);
  push(`<text transform="rotate(-90 ${tb.x + 52} 385)" x="${tb.x + 52}" y="385" text-anchor="middle" font-size="14" font-weight="700" fill="#111">${esc(J.client?.name || "")}</text>`);
  push(`<text transform="rotate(-90 ${tb.x + 76} 385)" x="${tb.x + 76}" y="385" text-anchor="middle" font-size="11" fill="#333">${esc(addr1.trim())}</text>`);
  push(`<text transform="rotate(-90 ${tb.x + 96} 385)" x="${tb.x + 96}" y="385" text-anchor="middle" font-size="11" fill="#333">${esc(addrRest.join(",").trim())}</text>`);
  push(`<text x="${tb.x + 8}" y="486" font-size="8" fill="#777">Project</text>`);
  push(`<text x="${tb.x + 8}" y="500" font-size="11" fill="#111">${esc(J.name || "")}</text>`);
  push(`<line x1="${tb.x}" y1="510" x2="${tb.x + tb.w}" y2="510" stroke="#999" stroke-width="0.7"/>`);
  push(`<text x="${tb.x + 8}" y="524" font-size="8" fill="#777">Drawing</text>`);
  push(`<text x="${tb.x + 8}" y="538" font-size="11" fill="#111">AV Schematic — ${esc(sol.name || "")}</text>`);
  push(`<line x1="${tb.x}" y1="548" x2="${tb.x + tb.w}" y2="548" stroke="#444"/>`);
  push(`<rect x="${tb.x + 18}" y="558" width="120" height="24" fill="none" stroke="${stageCol}" stroke-width="1.6"/>`);
  push(`<text x="${cx}" y="575" text-anchor="middle" font-size="13" font-weight="700" letter-spacing="2" fill="${stageCol}">${stageTxt}</text>`);
  push(`<line x1="${tb.x}" y1="592" x2="${tb.x + tb.w}" y2="592" stroke="#444"/>`);
  push(`<text x="${cx}" y="606" text-anchor="middle" font-size="9" font-weight="700" letter-spacing="1" fill="#333">REVISIONS</text>`);
  push(`<g stroke="#999" stroke-width="0.7">`);
  for (let i = 0; i <= 4; i++) push(`<line x1="${tb.x}" y1="${612 + i * 22}" x2="${tb.x + tb.w}" y2="${612 + i * 22}"/>`);
  push(`<line x1="${tb.x + 18}" y1="612" x2="${tb.x + 18}" y2="700"/><line x1="${tb.x + 76}" y1="612" x2="${tb.x + 76}" y2="700"/><line x1="${tb.x + 136}" y1="612" x2="${tb.x + 136}" y2="700"/></g>`);
  revs.forEach((rv, i) => {
    const y = 626 + i * 22;
    push(`<g font-size="8.5" fill="#333"><text x="${tb.x + 9}" y="${y}" text-anchor="middle">${esc(rv.rev)}</text><text x="${tb.x + 47}" y="${y}" text-anchor="middle">${fmtDate(rv.date)}</text><text x="${tb.x + 106}" y="${y}" text-anchor="middle">${esc(String(rv.description || "").slice(0, 16))}</text><text x="${tb.x + 146}" y="${y}" text-anchor="middle">${esc(rv.by || "")}</text></g>`);
  });
  const fields = [["Date", fmtDate(lastDate)], ["Scale", "None"], ["Drawn by", esc(J.drawnBy || "SignalPath")], ["Sheet", opts.sheet || "1 of 3"]];
  let fy = 712;
  push(`<line x1="${tb.x}" y1="${fy}" x2="${tb.x + tb.w}" y2="${fy}" stroke="#444"/>`);
  for (const [label, val] of fields) {
    push(`<text x="${tb.x + 8}" y="${fy + 16}" font-size="8" fill="#777">${label}</text>`);
    push(`<text x="${cx}" y="${fy + 36}" text-anchor="middle" font-size="13" fill="#111">${val}</text>`);
    fy += 48;
    push(`<line x1="${tb.x}" y1="${fy}" x2="${tb.x + tb.w}" y2="${fy}" stroke="#444"/>`);
  }
  push(`<text transform="rotate(-90 ${cx} 972)" x="${cx}" y="972" text-anchor="middle" font-size="7" fill="#999">Design intent only — not engineering / construction documentation</text>`);
  push(`</svg>`);
  return out.join("\n");
}

/* icon layouts per speaker config (positions relative to the group rect) */
/* small-tile faceplate cue, centered at (cx, cy) — one quiet glyph per source
   type so a rack of black boxes passes the squint test */
function faceGlyph(dev, cx, cy) {
  switch (dev.sourceType) {
    case "appletv":
      return `<rect x="${cx - 8}" y="${cy - 5.5}" width="16" height="11" rx="3" fill="none" stroke="#fff" stroke-width="1"/>` +
             `<text x="${cx}" y="${cy + 3}" text-anchor="middle" font-size="7.5" font-weight="600" fill="#fff">tv</text>`;
    case "streamer":
      return `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="12" fill="#cfcfcf">♪</text>`;
    case "turntable":
      return `<circle cx="${cx - 2}" cy="${cy}" r="7.5" fill="#2d2d2d" stroke="#6a6a6a" stroke-width="1"/>` +
             `<circle cx="${cx - 2}" cy="${cy}" r="1.4" fill="#8f8f8f"/>` +
             `<line x1="${cx + 7}" y1="${cy - 7}" x2="${cx + 2.5}" y2="${cy - 0.5}" stroke="#8f8f8f" stroke-width="1.3"/>`;
    case "cable":
      return `<rect x="${cx - 9}" y="${cy - 5}" width="18" height="10" rx="1.5" fill="#08130a" stroke="#1e3320" stroke-width="0.8"/>` +
             `<text x="${cx}" y="${cy + 3}" text-anchor="middle" font-size="7" font-family="Menlo, monospace" fill="#3fbf5a">02</text>`;
    case "kaleidescape":
      return `<path d="M${cx - 4} ${cy - 5}L${cx + 5} ${cy}L${cx - 4} ${cy + 5}Z" fill="#cfcfcf"/>`;
  }
  if (dev.type === "avbSwitch")
    return [0, 1, 2, 3].map(i =>
      `<rect x="${cx - 12 + i * 6.5}" y="${cy - 2}" width="4" height="4" fill="none" stroke="#8f8f8f" stroke-width="0.9"/>`).join("");
  return "";
}

function speakerGlyphs(ep, gx, gy, gw) {
  const cfg = ep?.config || "stereo";
  const use = (id, x, y) => `<use href="#${id}" x="${gx + x}" y="${gy + y}"/>`;
  const row = (ids, y) => ids.map((id, i) => use(id, 16 + i * 34, y)).join("");
  if (cfg === "mono") return use("spk", 16, 16);
  if (cfg === "surround-5.1") return row(["spk", "spk", "spk"], 16) + row(["spk", "sub", "spk"], 54);
  if (cfg === "surround-7.1" || cfg === "surround-7.1.4")
    return row(["spk", "spk", "spk", "spk"], 16) + `<g transform="translate(${gx + 17},0)">` + row(["spk", "sub", "spk"], 54) + `</g>`;
  if (cfg === "2.1" || cfg === "stereo-2.1") return row(["spk", "sub", "spk"], 16);
  if (cfg.startsWith("soundbar")) {
    const barW = cfg === "soundbar-sub" ? gw - 38 : gw;
    let out2 = `<rect x="${gx}" y="${gy + 6}" width="${barW}" height="16" rx="8" fill="#2d2d2d" stroke="#151515"/>`;
    if (cfg === "soundbar-sub") out2 += use("sub", gw - 15, 16);
    return out2;
  }
  if (cfg === "landscape") {
    const sats = ep?.satCount || 4, subs = ep?.buriedSub ? 1 : 0;
    let out2 = "";
    for (let i = 0; i < sats; i++) out2 += use("spks", 10 + i * 26, 16);
    if (subs) out2 += use("sub", sats * 26 + 18, 16);
    return out2;
  }
  const n = ep?.count || 2;
  return row(Array(n).fill("spk"), 16);
}

/* ---------- advise ----------
   Suggestions-only (spec: advisor never blocks). With a catalog, emits full
   licensing picks per platform and typed port-budget checks; without one it
   keeps the legacy Savant hint so old callers behave identically. */

export function advise(job, ix = indexJob(job), catalog = null) {
  const out = { amps: [], notes: [], licensing: [], io: [] };
  const zones = job.house.zones;
  const videoZones = zones.filter(z => (z.endpoints || []).some(e => e.type === "display")).length;
  const audioZones = zones.filter(z => (z.endpoints || []).some(e => e.type === "speakers")).length;
  const zc = zones.length;

  for (const s of ix.solutions) {
    const sol = s.sol;
    const byAmp = {};
    for (const c of sol.connections || []) {
      if (c.signal === "speaker" && s.devices[c.from]) (byAmp[c.from] ||= []).push(c);
    }
    for (const [ampId, feeds] of Object.entries(byAmp)) {
      const amp = s.devices[ampId];
      const reserved = feeds.filter(f => (f.scope || "included") !== "included").length;
      const zonesTotal = amp?.zones ?? catalog?.devices?.[amp?.catalogRef]?.zones ?? null;
      out.amps.push({
        solution: sol.id, amp: ampId, model: amp?.model,
        zonesUsed: feeds.length, zonesTotal, reserved,
        spare: zonesTotal != null ? zonesTotal - feeds.length : null,
      });
    }

    /* -- typed port budgets from catalog refs -- */
    if (catalog?.devices) {
      for (const d of Object.values(s.devices)) {
        const cat = catalog.devices[d.catalogRef];
        if (!cat) continue;
        const inbound = (sol.connections || []).filter(c => c.to === d.id);
        const audioIn = inbound.filter(c => c.signal === "audio").length;
        const videoIn = inbound.filter(c => c.signal === "video").length;
        const audioCap = (cat.inputs?.analog || 0) + (cat.inputs?.coax || 0) + (cat.inputs?.optical || 0) + (cat.inputs?.digitalCombo || 0);
        const videoCap = cat.inputs?.hdmi || 0;
        if (audioCap && audioIn > audioCap)
          out.io.push({ device: d.id, kind: "audio-in", used: audioIn, capacity: audioCap, over: true,
            msg: `${d.model || d.id}: ${audioIn} audio feeds into ${audioCap} inputs (${cat.model}) — needs another input path` });
        else if (audioCap && audioIn) out.io.push({ device: d.id, kind: "audio-in", used: audioIn, capacity: audioCap, over: false });
        if (videoCap && videoIn > videoCap)
          out.io.push({ device: d.id, kind: "video-in", used: videoIn, capacity: videoCap, over: true,
            msg: `${d.model || d.id}: ${videoIn} video feeds into ${videoCap} HDMI inputs (${cat.model})` });
        const outbound = (sol.connections || []).filter(c => c.from === d.id && c.signal === "video").length;
        const outCap = cat.outputs?.hdmi ?? d.io?.out ?? 0;
        if (outCap && d.type === "videoMatrix" && outbound > outCap)
          out.io.push({ device: d.id, kind: "video-out", used: outbound, capacity: outCap, over: true,
            msg: `${d.model || d.id}: ${outbound} video outputs of ${outCap} available` });
        if (cat.flags?.includes("pcmOnlyDigital") && inbound.some(c => c.signal === "audio"))
          out.notes.push({ code: "pcm-only", msg: `${d.model || d.id}: digital inputs are PCM-only — bitstream sources need a 2ch downmix (AC-AVDM-V3 / AVDM-EV2)` });
        if (cat.flags?.includes("controlLanOnly"))
          out.notes.push({ code: "control-lan-only", msg: `${d.model || d.id}: LAN is control/DSP only — no Dante/audio-over-IP on this box` });
      }
    }

    /* -- licensing advisor per platform -- */
    const platforms = sol.platforms || [];
    const aux = sol.auxCounts || {};
    const devEstimate = aux.devices ?? Math.round(zc * 3 + (aux.cameras || 0) + (aux.controls || 0));
    const voiceRooms = aux.voiceRooms ?? 0;

    if (catalog?.licensing) {
      if (platforms.includes("savant")) {
        const L = catalog.licensing.savant;
        const pick = (L.hosts || []).find(h =>
          (h.maxZones == null || zc <= h.maxZones) &&
          (h.maxVideo == null || videoZones <= h.maxVideo) &&
          (h.maxAudio == null || audioZones <= h.maxAudio)) || (L.hosts || [])[(L.hosts || []).length - 1];
        const lines = [`${pick?.name} — runtime: ${pick?.runtime}`, L.essentials];
        const warns = [];
        if (pick?.maxIpAudio != null && audioZones > pick.maxIpAudio)
          warns.push(`${audioZones} audio zones exceeds the ${pick.maxIpAudio} IP-audio device ceiling`);
        out.licensing.push({ platform: "savant", pick: pick?.name, lines, warns, notes: L.notes || [] });
      }
      if (platforms.includes("josh")) {
        const L = catalog.licensing.josh;
        const needMics = Math.max(voiceRooms, 0);
        const pick = (L.processors || []).find(p => devEstimate <= p.maxDevices && needMics <= (p.maxMics ?? 0)) ||
          (L.processors || [])[(L.processors || []).length - 1];
        const dual = pick && (devEstimate > pick.maxDevices || needMics > (pick.maxMics ?? 0));
        out.licensing.push({ platform: "josh", pick: dual ? `2× ${pick?.name}` : pick?.name,
          lines: [`~${devEstimate} devices · ${needMics} voice rooms → ${dual ? "dual " : ""}${pick?.name} (${pick?.plan})`],
          warns: dual ? ["over single-processor limits — dual Core / manufacturer review"] : [],
          notes: L.notes || [] });
      }
      if (platforms.includes("control4")) {
        const L = catalog.licensing.control4;
        const pick = (L.controllers || []).find(c => devEstimate <= c.maxDevices && zc <= (c.rooms ?? 99)) ||
          (L.controllers || [])[(L.controllers || []).length - 1];
        const warns = [];
        if (pick && devEstimate > pick.maxDevices * 0.8) warns.push(`~${devEstimate} devices is within 20% of the ${pick.name} cap (${pick.maxDevices}) — consider the next tier`);
        out.licensing.push({ platform: "control4", pick: pick?.name,
          lines: [`~${devEstimate} devices / ${zc} rooms → ${pick?.name}`, L.connect], warns, notes: L.notes || [] });
      }
    } else if (platforms.includes("savant")) {
      // legacy catalog-less hint (kept for compatibility)
      if (zc > 16) out.notes.push({ code: "savant-host", msg: `${zc} zones exceeds Smart Host (16) — Pro Host class required` });
      else out.notes.push({ code: "savant-host", msg: `Smart Host OK (${zc}/16 zones) · Essentials subscription required` });
    }
  }
  return out;
}
