/* ---------- sheets.js — a job split across schematic sheets by rack ----------
   Ryan 2026-10-02: the whole house stays on one sheet; a pool house, guest house or
   backyard area that has its own rack gets its own sheet — and the main sheet still
   shows how the main rack feeds that rack. Chosen per job (job.job.splitSheets).

   A room belongs to its area's home rack (areas[].homeRack), else to the rack whose
   gear feeds it; a rack with no rooms of its own stays on the main sheet. Each sheet
   is an ordinary job: its own racks in full, plus — from the other racks — only the
   boxes wired straight to this sheet's gear ("Pool House Rack — sheet 2"), so the link
   between the racks is drawn on both sheets. Pure: raw job in, raw jobs out. */

const clone = o => JSON.parse(JSON.stringify(o));

export function sheetGroups(job, solIndex = 0) {
  const sol = job.solutions?.[solIndex];
  const racks = sol?.racks || [];
  if (racks.length < 2) return null;
  const main = racks[0].id;
  const rackOf = {};
  for (const r of racks) for (const d of r.devices || []) rackOf[d.id] = r.id;
  const comps = sol.companions || [], conns = (sol.connections || []).filter(c => !c.dante);
  for (const c of comps) if (rackOf[c.serves]) rackOf[c.id] = rackOf[c.serves];
  const zones = job.house?.zones || [];
  const zoneOfNode = {};
  for (const z of zones) for (const e of z.endpoints || []) zoneOfNode[e.id] = z.id;
  for (const l of sol.localDevices || []) if (l.zone) zoneOfNode[l.id] = l.zone;
  for (const c of comps) if (zoneOfNode[c.serves]) zoneOfNode[c.id] = zoneOfNode[c.serves];
  // the rack a wire into a room comes from: climb past room-side adapters (a DEC at the TV)
  const upstream = (id, seen = new Set()) => {
    if (rackOf[id]) return rackOf[id];
    if (seen.has(id)) return null;
    seen.add(id);
    for (const c of conns.filter(c => c.to === id)) { const r = upstream(c.from, seen); if (r) return r; }
    return null;
  };
  const home = {};
  for (const a of job.house?.areas || []) if (a.homeRack && racks.some(r => r.id === a.homeRack)) home[a.id] = a.homeRack;
  const zoneRack = {};
  for (const z of zones) {
    if (home[z.area]) { zoneRack[z.id] = home[z.area]; continue; }
    const votes = {};
    for (const c of conns) if (zoneOfNode[c.to] === z.id && !zoneOfNode[c.from]) { const r = upstream(c.from); if (r) votes[r] = (votes[r] || 0) + 1; }
    zoneRack[z.id] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || main;
  }
  const own = racks.filter(r => r.id === main || zones.some(z => zoneRack[z.id] === r.id));
  if (own.length < 2) return null;
  const sheetOf = id => own.some(r => r.id === id) ? id : main;
  const areaName = rid => (job.house?.areas || []).find(a => a.homeRack === rid)?.name;
  return own.map((r, i) => ({
    rack: r.id,
    name: areaName(r.id) || (i ? r.name : "Main House"),
    racks: racks.filter(x => sheetOf(x.id) === r.id).map(x => x.id),
    zones: zones.filter(z => sheetOf(zoneRack[z.id]) === r.id).map(z => z.id),
  }));
}

export function sheetJob(job, solIndex, groups, k) {
  const g = groups[k], out = clone(job);
  const sol = out.solutions[solIndex];   // other solutions stay as they are, so indexes still line up
  const ownRacks = new Set(g.racks), ownZones = new Set(g.zones);
  const zones = (out.house?.zones || []).filter(z => ownZones.has(z.id));
  const eps = new Set(zones.flatMap(z => (z.endpoints || []).map(e => e.id)));
  const locals = (sol.localDevices || []).filter(l => ownZones.has(l.zone));
  const devs = new Set((sol.racks || []).filter(r => ownRacks.has(r.id)).flatMap(r => (r.devices || []).map(d => d.id)));
  const comps = sol.companions || [];
  const keep = new Set([...devs, ...eps, ...locals.map(l => l.id)]);
  for (const c of comps) if (keep.has(c.serves)) keep.add(c.id);
  // the other racks' boxes wired straight to this sheet's gear (the link between racks)
  const border = new Set();
  const otherDev = id => !keep.has(id) && (sol.racks || []).some(r => !ownRacks.has(r.id) && (r.devices || []).some(d => d.id === id));
  for (const c of sol.connections || []) {
    if (c.dante) continue;
    if (keep.has(c.from) && otherDev(c.to)) border.add(c.to);
    if (keep.has(c.to) && otherDev(c.from)) border.add(c.from);
  }
  for (const id of border) keep.add(id);
  const sheetNo = rid => groups.findIndex(x => x.racks.includes(rid)) + 1;
  sol.racks = (sol.racks || []).map(r => ownRacks.has(r.id) ? r
    : { ...r, name: `${r.name} — sheet ${sheetNo(r.id)}`, devices: (r.devices || []).filter(d => border.has(d.id)) })
    .filter(r => r.devices.length || ownRacks.has(r.id))
    .sort((a, b) => (ownRacks.has(b.id) ? 1 : 0) - (ownRacks.has(a.id) ? 1 : 0));   // this sheet's racks lead
  sol.companions = comps.filter(c => keep.has(c.id));
  sol.localDevices = locals;
  sol.connections = (sol.connections || []).filter(c => keep.has(c.from) && keep.has(c.to));
  sol.annotations = (sol.annotations || []).filter(a => !a || typeof a !== "object" || !a.near || ownZones.has(a.near));
  out.house = { ...out.house, zones };
  out.job = { ...out.job, sheetLabel: g.name, sheetIndex: k, sheetCount: groups.length };
  return out;
}
