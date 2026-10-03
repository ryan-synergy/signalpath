/* ---------- racksizes.js — floor-rack outside sizes, a quick reference per rack height ----------
   Ryan 2026-10-02: keep typical rack heights and widths with every rack design; Synergy buys
   Middle Atlantic and Strong, floor-standing, on casters. From the makers' own sheets (fetched
   2026-10-02): Middle Atlantic BGR spec sheet 96-01149 + MRK spec sheet 96-039 (heights without
   casters; the CBS-BGR / CBS-MRK caster base adds 1"); Strong rack size chart (April 2022) + the
   SR-CUSTOM drawing (heights with casters / without). Inches. depth = outside, usable = rail depth.
   This is what a rack measures — NOT the minimum cabinet / closet it needs (that comes from
   Synergy's own reference sheet). */
const MA_CASTER = 1;
export const RACK_MODELS = [
  { brand: "Middle Atlantic", series: "BGR", u: 19, model: "BGR-1927", h: 37.375, w: 23, depths: [[27, 24.4, "BGR-1927"]] },
  { brand: "Middle Atlantic", series: "BGR", u: 25, model: "BGR-2527 / 2532", h: 47.875, w: 23, depths: [[27, 24.4, "BGR-2527"], [32, 29.4, "BGR-2532"]] },
  { brand: "Middle Atlantic", series: "BGR", u: 38, model: "BGR-3827 / 3832", h: 70.625, w: 23, depths: [[27, 24.4, "BGR-3827"], [32, 29.4, "BGR-3832"]] },
  { brand: "Middle Atlantic", series: "BGR", u: 41, model: "BGR-4127 / 4132 / 4138", h: 75.875, w: 23, depths: [[27, 24.4, "BGR-4127"], [32, 29.4, "BGR-4132"], [38, 35.4, "BGR-4138"]] },
  { brand: "Middle Atlantic", series: "BGR", u: 45, model: "BGR-4527 / 4532 / 4538", h: 82.875, w: 23, depths: [[27, 24.4, "BGR-4527"], [32, 29.4, "BGR-4532"], [38, 35.4, "BGR-4538"]] },
  { brand: "Middle Atlantic", series: "MRK", u: 24, model: "MRK-2426 / 2431 / 2436", h: 48.125, w: 22, depths: [[26.4, 24, "MRK-2426"], [31.4, 29, "MRK-2431"], [36, 33.6, "MRK-2436"]] },
  { brand: "Middle Atlantic", series: "MRK", u: 40, model: "MRK-4026 / 4031 / 4036 / 4042", h: 76.125, w: 22, depths: [[26.4, 24, "MRK-4026"], [31.4, 29, "MRK-4031"], [36, 33.6, "MRK-4036"], [42, 39.6, "MRK-4042"]] },
  { brand: "Middle Atlantic", series: "MRK", u: 44, model: "MRK-4426 / 4431 / 4436 / 4442", h: 83.125, w: 22, depths: [[26.4, 24, "MRK-4426"], [31.4, 29, "MRK-4431"], [36, 33.6, "MRK-4436"], [42, 39.6, "MRK-4442"]] },
  { brand: "Strong", series: "Contractor", u: 12, model: "SR-CS-RACK-12U", hc: 27.8, h: 23.8, w: 20, depths: [[18.2, 18.2, "SR-CS-RACK-12U"]] },
  { brand: "Strong", series: "Contractor", u: 16, model: "SR-CS-RACK-16U", hc: 34.8, h: 30.9, w: 20, depths: [[18.2, 18.2, "SR-CS-RACK-16U"]] },
  { brand: "Strong", series: "Custom", u: 27, model: "SR-CUSTOM-27U-20IN / -24IN", hc: 53.75, h: 50.75, w: 19.77, wPanels: 21.02, depths: [[20.16, 20, "SR-CUSTOM-27U-20IN"], [24.16, 24, "SR-CUSTOM-27U-24IN"]] },
  { brand: "Strong", series: "FS", u: 27, model: "SR-FS-SYSTEM-DC-27U", hc: 55, h: 51.25, w: 21.1, depths: [[23.25, 18.25, "SR-FS-SYSTEM-DC-27U"]] },
  { brand: "Strong", series: "Custom", u: 32, model: "SR-CUSTOM-32U-20IN / -24IN", hc: 62.5, h: 59.5, w: 19.77, wPanels: 21.02, depths: [[20.16, 20, "SR-CUSTOM-32U-20IN"], [24.16, 24, "SR-CUSTOM-32U-24IN"]] },
  { brand: "Strong", series: "Signature", u: 32, model: "SR-AV-CAB-32U-25IN", hc: 61.9, h: 60, w: 23.5, depths: [[25, 22.5, "SR-AV-CAB-32U-25IN"]] },
  { brand: "Strong", series: "Custom", u: 37, model: "SR-CUSTOM-37U", hc: 71.25, h: 68.25, w: 19.77, wPanels: 21.02, depths: [[20.16, 20, "SR-CUSTOM-37U (20\" deep)"], [24.16, 24, "SR-CUSTOM-37U (24\" deep)"]] },
  { brand: "Strong", series: "Custom", u: 42, model: "SR-CUSTOM-42U-20IN / -24IN", hc: 79.9, h: 76.9, w: 19.77, wPanels: 21.02, depths: [[20.16, 20, "SR-CUSTOM-42U-20IN"], [24.16, 24, "SR-CUSTOM-42U-24IN"]] },
  { brand: "Strong", series: "FS", u: 42, model: "SR-FS-SYSTEM-DC-42U", hc: 79.7, h: 76.8, w: 21.1, depths: [[23.1, 18.25, "SR-FS-SYSTEM-DC-42U"]] },
  { brand: "Strong", series: "Signature", u: 42, model: "SR-AV-CAB-42U-25IN / -30IN", hc: 79.4, h: 77, w: 23.5, depths: [[25, 22.5, "SR-AV-CAB-42U-25IN"], [34, 31.5, "SR-AV-CAB-42U-30IN"]] },
].map(m => ({ ...m, hc: m.hc ?? +(m.h + MA_CASTER).toFixed(3) }));

const n1 = v => String(Math.round(v * 10) / 10);
// one line per rack: model, U, height on casters (without), width, depth (usable)
export function rackModelLine(m) {
  const d = m.depths.map(([o, u]) => `${n1(o)}" (${n1(u)}" usable)`).join(" / ");
  return `${m.brand} ${m.model} · ${m.u}U · ${n1(m.hc)}" H on casters (${n1(m.h)}" without) · ${n1(m.w)}"${m.wPanels ? ` (${n1(m.wPanels)}" w/ side panels)` : ""} W · ${d} D`;
}
// for a rack size: each brand's racks that size, else its nearest smaller and larger
export function rackReference(u) {
  const out = [];
  for (const brand of ["Middle Atlantic", "Strong"]) {
    const list = RACK_MODELS.filter(m => m.brand === brand);
    const exact = list.filter(m => m.u === u);
    if (exact.length) { out.push(...exact.map(m => ({ ...m, fit: "exact" }))); continue; }
    const below = list.filter(m => m.u < u).sort((a, b) => b.u - a.u)[0], above = list.filter(m => m.u > u).sort((a, b) => a.u - b.u)[0];
    if (below) out.push({ ...below, fit: "smaller" });
    if (above) out.push({ ...above, fit: "larger" });
  }
  return { u, railIn: u * 1.75, models: out };
}

/* ---------- start from the space (Ryan 2026-10-02) ----------
   Racks are often limited by the cabinet opening or the door they pass through: the tallest rack
   that fits sets the rack, then the gear is fitted to it. Each depth option is its own orderable
   rack. Clearance = room left over the rack on casters, and side / depth allowance — a placeholder
   until Synergy's minimum-cabinet sheet is added (`RACK_CLEARANCE`). */
export const RACK_CLEARANCE = { top: 1, side: 0, depth: 0, source: "1\" over the rack on casters — height allowance (Synergy's minimum gives width and depth)" };
// Synergy's minimum cabinet / closet opening for a floor rack (Ryan 2026-10-02): 22" wide, 26" deep
export const MIN_CABINET = { w: 22, d: 26 };
// what the cabinet must be for a rack: never under Synergy's minimum, never under the rack itself (+ clearance)
export function cabinetNeeds(o, clr = RACK_CLEARANCE, casters = true) {
  return { w: Math.max(MIN_CABINET.w, o ? o.w + clr.side : 0), d: Math.max(MIN_CABINET.d, o ? o.depth + clr.depth : 0), h: o ? +((casters ? o.hc : o.h) + clr.top).toFixed(1) : null, casters };
}
// the space entered is under Synergy's minimum (null = fine / not entered)
export function belowMinimum(space = {}) {
  const w = +space.w > 0 && +space.w < MIN_CABINET.w, d = +space.d > 0 && +space.d < MIN_CABINET.d;
  return w || d ? { w, d } : null;
}
export const RACK_OPTIONS = RACK_MODELS.flatMap(m => m.depths.map(([depth, usable, part]) => ({ part, brand: m.brand, series: m.series, u: m.u,
  hc: m.hc, h: m.h, w: m.wPanels || m.w, depth, usable })));
export const rackOption = part => RACK_OPTIONS.find(o => o.part === part) || null;
// every rack that fits the space (inches; a missing dimension doesn't limit), tallest first
// casters (Ryan 2026-10-02: a toggle — at a 35" opening it decides between Strong's 12U and 16U): on
// casters a rack stands on its caster height (hc), without on its own (h)
export function fitRacks(space = {}, clr = RACK_CLEARANCE, casters = true) {
  const ok = o => (!(+space.h > 0) || (casters ? o.hc : o.h) + clr.top <= +space.h) && (!(+space.w > 0) || o.w + clr.side <= +space.w) && (!(+space.d > 0) || o.depth + clr.depth <= +space.d);
  return RACK_OPTIONS.filter(ok).sort((a, b) => b.u - a.u || b.usable - a.usable || a.hc - b.hc);
}

/* how tall a plain "nU" rack stands — for a size typed by hand (no brand picked) checked against the
   space: the shortest Middle Atlantic / Strong rack that height, else rails + a typical frame
   (≈4.5" of top and base over the rails, ≈2" more on casters). */
export function estimateHeight(u, casters = true) {
  const same = RACK_MODELS.filter(m => m.u === u).map(m => casters ? m.hc : m.h);
  return same.length ? { h: Math.min(...same), exact: true } : { h: +(u * 1.75 + 4.5 + (casters ? 2 : 0)).toFixed(1), exact: false };
}
