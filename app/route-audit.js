/* ---------- route-audit.js — how efficient is each wire? ----------
   An independent oracle for the router. The router's own guards prove a
   drawing is LEGAL (no wire through a body, no lane overlap, hop ceilings);
   this measures whether each wire is EFFICIENT:
     - length vs the Manhattan minimum between its two ports, bends vs the
       fewest an orthogonal route with the same exit/entry sides needs;
     - geometry smells: redundant vertices, U-turn spikes, hairline jogs,
       overshoot past both ports;
     - a search for a simpler route (L / Z / one extra dog-leg) that leaves and
       arrives on the same sides, crosses no body, overlaps no other wire and
       crosses no more wires — if one is clearly shorter, the wire is flagged.
   The oracle ignores lane classes and corridor reservations, so a flag is a
   lead to review, not proof. Pure: works on place() + route() output. */

const EPS = 0.5, PAD = 2;
const segsOf = pts => pts.slice(1).map((b, i) => [pts[i], b]);
const lenOf = pts => segsOf(pts).reduce((n, [a, b]) => n + Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]), 0);
const dirOf = (a, b) => Math.abs(b[0] - a[0]) > EPS ? (b[0] > a[0] ? "R" : "L") : (b[1] > a[1] ? "D" : "U");
const horiz = d => d === "R" || d === "L";

// drop repeated and collinear points (what the drawing actually shows)
export function simplify(pts) {
  const p = pts.filter((q, i) => i === 0 || Math.abs(q[0] - pts[i - 1][0]) > EPS || Math.abs(q[1] - pts[i - 1][1]) > EPS);
  const out = [p[0]];
  for (let i = 1; i < p.length - 1; i++) {
    const a = out[out.length - 1], b = p[i], c = p[i + 1];
    const col = (Math.abs(a[0] - b[0]) < EPS && Math.abs(b[0] - c[0]) < EPS) || (Math.abs(a[1] - b[1]) < EPS && Math.abs(b[1] - c[1]) < EPS);
    if (!col) out.push(b);
  }
  if (p.length > 1) out.push(p[p.length - 1]);
  return out;
}

const within = (pt, o, m = 1.5) => pt[0] >= o.x - m && pt[0] <= o.x + o.w + m && pt[1] >= o.y - m && pt[1] <= o.y + o.h + m;
const pierces = ([a, b], o) =>
  Math.min(a[0], b[0]) < o.x + o.w - PAD && Math.max(a[0], b[0]) > o.x + PAD &&
  Math.min(a[1], b[1]) < o.y + o.h - PAD && Math.max(a[1], b[1]) > o.y + PAD;
// a proper crossing: one horizontal, one vertical, meeting strictly inside both
function crosses([a, b], [c, d]) {
  const h1 = Math.abs(a[1] - b[1]) < EPS, h2 = Math.abs(c[1] - d[1]) < EPS;
  if (h1 === h2) return false;
  const [H, V] = h1 ? [[a, b], [c, d]] : [[c, d], [a, b]];
  const y = H[0][1], x = V[0][0];
  return x > Math.min(H[0][0], H[1][0]) + EPS && x < Math.max(H[0][0], H[1][0]) - EPS &&
         y > Math.min(V[0][1], V[1][1]) + EPS && y < Math.max(V[0][1], V[1][1]) - EPS;
}
// two parallel runs closer than a lane apart that share extent read as one wire
function overlaps([a, b], [c, d], gap = 4) {
  const h1 = Math.abs(a[1] - b[1]) < EPS, h2 = Math.abs(c[1] - d[1]) < EPS;
  if (h1 !== h2) return false;
  if (h1) return Math.abs(a[1] - c[1]) < gap && Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) - Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) > 2;
  return Math.abs(a[0] - c[0]) < gap && Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) - Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) > 2;
}

export function auditRoutes(p, rt, opts = {}) {
  const tiles = [...(p.racks || []).flatMap(r => r.devices), ...(p.chips || [])];
  const cards = p.zones || [];
  const wires = (rt.wires || []).filter(w => w.pts?.length > 1 && !w.insideCard && w.cls !== "local" && !/stub/.test(w.cls));
  const segsByNet = new Map();
  for (const w of rt.wires || []) if (w.pts?.length > 1) (segsByNet.get(w.net) || segsByNet.set(w.net, []).get(w.net)).push(...segsOf(simplify(w.pts)));
  const others = net => [...segsByNet].filter(([n]) => n !== net).flatMap(([, s]) => s);
  const results = [];
  for (const w of wires) {
    const pts = simplify(w.pts);
    const P0 = pts[0], P1 = pts[pts.length - 1];
    const d0 = dirOf(pts[0], pts[1]), d1 = dirOf(pts[pts.length - 2], pts[pts.length - 1]);
    const len = lenOf(pts), manh = Math.abs(P1[0] - P0[0]) + Math.abs(P1[1] - P0[1]);
    const bends = pts.length - 2;
    // fewest bends for these exit/entry sides
    let minBends;
    if (horiz(d0) === horiz(d1)) minBends = (horiz(d0) ? Math.abs(P0[1] - P1[1]) < EPS : Math.abs(P0[0] - P1[0]) < EPS) && d0 === d1 ? 0 : 2;
    else minBends = 1;
    // smells
    const issues = [];
    const raw = w.pts;
    for (let i = 1; i < raw.length - 1; i++) {
      const a = raw[i - 1], b = raw[i], c = raw[i + 1];
      const col = (Math.abs(a[0] - b[0]) < EPS && Math.abs(b[0] - c[0]) < EPS) || (Math.abs(a[1] - b[1]) < EPS && Math.abs(b[1] - c[1]) < EPS);
      if (col) {
        const back = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) < 0;
        issues.push(back ? "spike" : "extra-vertex");
      }
    }
    segsOf(pts).forEach(([a, b], i) => { if (i > 0 && i < pts.length - 2 && lenOf([a, b]) < 6) issues.push("hairline-jog"); });
    const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
    const overX = Math.max(0, Math.min(P0[0], P1[0]) - Math.min(...xs)) + Math.max(0, Math.max(...xs) - Math.max(P0[0], P1[0]));
    const overY = Math.max(0, Math.min(P0[1], P1[1]) - Math.min(...ys)) + Math.max(0, Math.max(...ys) - Math.max(P0[1], P1[1]));
    // the oracle: legal simpler routes
    const own = o => within(P0, o) || within(P1, o);
    const blockers = [...tiles, ...cards].filter(o => !own(o));
    const segO = others(w.net);
    const legal = cand => segsOf(cand).every((s, i) => !blockers.some(o => pierces(s, o)) && !segO.some(t => overlaps(s, t)));
    const crossCount = cand => segsOf(cand).reduce((n, s) => n + segO.filter(t => crosses(s, t)).length, 0);
    const actualCross = crossCount(pts);
    let better = null;
    const excess = len - manh;
    if (opts.search !== false && (excess > 24 || bends > minBends)) {
      // candidate coordinates: port lines, obstacle edges ± a lane, a coarse sweep
      const xsC = new Set([P0[0], P1[0]]), ysC = new Set([P0[1], P1[1]]);
      for (const o of blockers) { xsC.add(o.x - 8); xsC.add(o.x + o.w + 8); ysC.add(o.y - 8); ysC.add(o.y + o.h + 8); }
      const [xa, xb] = [Math.min(P0[0], P1[0]) - 120, Math.max(P0[0], P1[0]) + 120];
      const [ya, yb] = [Math.min(P0[1], P1[1]) - 120, Math.max(P0[1], P1[1]) + 120];
      for (let x = xa; x <= xb; x += 12) xsC.add(x);
      for (let y = ya; y <= yb; y += 12) ysC.add(y);
      const X = [...xsC].filter(x => x >= xa && x <= xb), Y = [...ysC].filter(y => y >= ya && y <= yb);
      const leaves = (q) => dirOf(P0, q) === d0;            // first leg leaves the way the real wire does
      const arrives = (q) => dirOf(q, P1) === d1;           // last leg lands on the same side
      const cands = [];
      const H0 = horiz(d0), H1 = horiz(d1);
      if (H0 && H1) { for (const m of X) cands.push([P0, [m, P0[1]], [m, P1[1]], P1]); }
      if (!H0 && !H1) { for (const m of Y) cands.push([P0, [P0[0], m], [P1[0], m], P1]); }
      if (H0 && !H1) cands.push([P0, [P1[0], P0[1]], P1]);
      if (!H0 && H1) cands.push([P0, [P0[0], P1[1]], P1]);
      // one extra dog-leg (3 bends) only when the wire uses more than that
      if (bends > 3) {
        if (H0 && !H1) for (const a of X) for (const b of Y) cands.push([P0, [a, P0[1]], [a, b], [P1[0], b], P1]);
        if (!H0 && H1) for (const b of Y) for (const a of X) cands.push([P0, [P0[0], b], [a, b], [a, P1[1]], P1]);
      }
      for (const raw2 of cands) {
        const c = simplify(raw2);
        if (c.length < 2 || !leaves(c[1]) || !arrives(c[c.length - 2])) continue;
        const cl = lenOf(c), cb = c.length - 2;
        if (cl > len - Math.max(24, len * 0.12) && cb >= bends) continue;       // not clearly better
        if (cb > bends) continue;
        if (!legal(c)) continue;
        const cc = crossCount(c);
        if (cc > actualCross) continue;
        if (!better || cl < better.len || (cl === better.len && cc < better.crossings)) better = { pts: c, len: cl, bends: cb, crossings: cc };
      }
    }
    results.push({ id: w.id, cls: w.cls, signal: w.signal, len: Math.round(len), manh: Math.round(manh), ratio: manh ? len / manh : 1,
      bends, minBends, extraBends: bends - minBends, crossings: actualCross, overX: Math.round(overX), overY: Math.round(overY), issues, better, pts });
  }
  return results;
}

export function summarize(results) {
  const byCls = {};
  for (const r of results) {
    const k = r.cls.replace(/-fallback$/, "") + (r.cls.endsWith("-fallback") ? " (fallback)" : "");
    const b = byCls[k] ||= { n: 0, len: 0, manh: 0, extraBends: 0, flagged: 0, saved: 0, smells: 0 };
    b.n++; b.len += r.len; b.manh += r.manh; b.extraBends += r.extraBends; b.smells += r.issues.length;
    if (r.better) { b.flagged++; b.saved += r.len - r.better.len; }
  }
  return byCls;
}
