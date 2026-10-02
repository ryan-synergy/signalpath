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
  { brand: "Middle Atlantic", series: "BGR", u: 19, model: "BGR-1927", h: 37.375, w: 23, depths: [[27, 24.4]] },
  { brand: "Middle Atlantic", series: "BGR", u: 25, model: "BGR-2527 / 2532", h: 47.875, w: 23, depths: [[27, 24.4], [32, 29.4]] },
  { brand: "Middle Atlantic", series: "BGR", u: 38, model: "BGR-3827 / 3832", h: 70.625, w: 23, depths: [[27, 24.4], [32, 29.4]] },
  { brand: "Middle Atlantic", series: "BGR", u: 41, model: "BGR-4127 / 4132 / 4138", h: 75.875, w: 23, depths: [[27, 24.4], [32, 29.4], [38, 35.4]] },
  { brand: "Middle Atlantic", series: "BGR", u: 45, model: "BGR-4527 / 4532 / 4538", h: 82.875, w: 23, depths: [[27, 24.4], [32, 29.4], [38, 35.4]] },
  { brand: "Middle Atlantic", series: "MRK", u: 24, model: "MRK-2426 / 2431 / 2436", h: 48.125, w: 22, depths: [[26.4, 24], [31.4, 29], [36, 33.6]] },
  { brand: "Middle Atlantic", series: "MRK", u: 40, model: "MRK-4026 / 4031 / 4036 / 4042", h: 76.125, w: 22, depths: [[26.4, 24], [31.4, 29], [36, 33.6], [42, 39.6]] },
  { brand: "Middle Atlantic", series: "MRK", u: 44, model: "MRK-4426 / 4431 / 4436 / 4442", h: 83.125, w: 22, depths: [[26.4, 24], [31.4, 29], [36, 33.6], [42, 39.6]] },
  { brand: "Strong", series: "Contractor", u: 12, model: "SR-CS-RACK-12U", hc: 27.8, h: 23.8, w: 20, depths: [[18.2, 18.2]] },
  { brand: "Strong", series: "Contractor", u: 16, model: "SR-CS-RACK-16U", hc: 34.8, h: 30.9, w: 20, depths: [[18.2, 18.2]] },
  { brand: "Strong", series: "Custom", u: 27, model: "SR-CUSTOM-27U-20IN / -24IN", hc: 53.75, h: 50.75, w: 19.77, wPanels: 21.02, depths: [[20.16, 20], [24.16, 24]] },
  { brand: "Strong", series: "FS", u: 27, model: "SR-FS-SYSTEM-DC-27U", hc: 55, h: 51.25, w: 21.1, depths: [[23.25, 18.25]] },
  { brand: "Strong", series: "Custom", u: 32, model: "SR-CUSTOM-32U-20IN / -24IN", hc: 62.5, h: 59.5, w: 19.77, wPanels: 21.02, depths: [[20.16, 20], [24.16, 24]] },
  { brand: "Strong", series: "Signature", u: 32, model: "SR-AV-CAB-32U-25IN", hc: 61.9, h: 60, w: 23.5, depths: [[25, 22.5]] },
  { brand: "Strong", series: "Custom", u: 37, model: "SR-CUSTOM-37U", hc: 71.25, h: 68.25, w: 19.77, wPanels: 21.02, depths: [[20.16, 20], [24.16, 24]] },
  { brand: "Strong", series: "Custom", u: 42, model: "SR-CUSTOM-42U-20IN / -24IN", hc: 79.9, h: 76.9, w: 19.77, wPanels: 21.02, depths: [[20.16, 20], [24.16, 24]] },
  { brand: "Strong", series: "FS", u: 42, model: "SR-FS-SYSTEM-DC-42U", hc: 79.7, h: 76.8, w: 21.1, depths: [[23.1, 18.25]] },
  { brand: "Strong", series: "Signature", u: 42, model: "SR-AV-CAB-42U-25IN / -30IN", hc: 79.4, h: 77, w: 23.5, depths: [[25, 22.5], [34, 31.5]] },
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
