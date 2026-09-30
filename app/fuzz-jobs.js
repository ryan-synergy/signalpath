/* ---------- fuzz-jobs.js — seeded random jobs ----------
   The stress test (fuzz.html) and the route audit (route-audit.html) draw the
   same jobs from the same seed. Pure.
   { extras: true } layers the newer wiring on top — room distance (reach / runFt),
   Bullet Train runs, eARC flags and eARC extender kits — from a SECOND random
   stream, so the base jobs (and every route baseline measured on them) never move. */
export function jobGenerator(SEED, { extras = false } = {}) {
  function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const rnd = mulberry32(SEED);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const CONFIGS = ["stereo", "mono", "2.1", "surround-5.1", "surround-7.1", "surround-7.1.4", "soundbar", "soundbar-sub", "landscape"];
  function randomJob(k) {
    const nz = 1 + Math.floor(rnd() * 18);
    const zones = [];
    for (let i = 0; i < nz; i++) {
      const eps = [];
      if (rnd() < 0.85) eps.push({ id: `z${i}-spk`, type: "speakers", config: pick(CONFIGS), satCount: 2 + Math.floor(rnd() * 8), buriedSub: rnd() < 0.5, status: pick(["new", "ofe", "prewire"]) });
      if (rnd() < 0.55) eps.push({ id: `z${i}-tv`, type: "display", displayType: rnd() < 0.1 ? "projector" : "tv", brand: pick(["Sony", "LG", ""]), size: pick([43, 55, 65, 75, 85, 98, 120]), status: pick(["new", "ofe"]) });
      zones.push({ id: `z${i}`, name: `Zone ${i} ${pick(["", "Suite", "Great Room", "Bath"])}`.trim(), scope: pick(["included", "included", "included", "prewire", "future"]), remote: pick([undefined, "savant", "appletv", "josh", "factory"]), endpoints: eps });
    }
    const devs = [];
    const nSrc = 1 + Math.floor(rnd() * 5);
    for (let i = 0; i < nSrc; i++) devs.push({ id: `src${i}`, type: "source", sourceType: pick(["appletv", "cable", "streamer", "turntable", "kaleidescape"]), model: `Source ${i}` });
    const hasMatrix = rnd() < 0.8, hasAvb = rnd() < 0.6;
    if (hasMatrix) devs.push({ id: "mx", type: "videoMatrix", model: "AVPro Edge Axion 8", catalogRef: pick(["avpro-ac-mx-88", "avpro-ac-mx-44", undefined]) });
    if (rnd() < 0.5) devs.push({ id: "avr", type: "avr", model: "Anthem MRX-540", catalogRef: "anthem-mrx-540-8k" });
    if (hasAvb) {
      devs.push({ id: "avb", type: "avbSwitch", model: "Savant AVB" });
      devs.push({ id: "in", type: "audioInputModule", model: "Savant Input Module", catalogRef: pick(["savant-avb-input-module", "savant-pav-aim7c"]) });
      devs.push({ id: "out", type: "audioOutputModule", model: "Savant Output Module", catalogRef: "savant-avb-output-module" });
    }
    const nAmp = Math.floor(rnd() * 3);
    for (let i = 0; i < nAmp; i++) devs.push({ id: `amp${i}`, type: "amp", model: pick(["Anthem MDX-16", "AudioControl M6800D", "Sonance DSP 8-130"]), catalogRef: pick(["anthem-mdx-16", "audiocontrol-m6800d", "sonance-dsp-8-130-mkiii"]), zones: pick([4, 8, 16]) });
    if (rnd() < 0.3) devs.push({ id: "sw", type: "networkSwitch", model: "USW Pro 24", catalogRef: "ubiquiti-usw-pro-24-poe" });
    const conns = [], companions = [], locals = [], annotations = [];
    const ampIds = devs.filter(d => d.type === "amp").map(d => d.id);
    let ampCh = 0;
    for (const z of zones) {
      const tv = z.endpoints.find(e => e.type === "display"), spk = z.endpoints.find(e => e.type === "speakers");
      if (tv) {
        if (rnd() < 0.15) locals.push({ id: `${z.id}-puck`, type: "source", sourceType: "appletv", model: "Apple TV", zone: z.id, location: "at-display" });
        else if (hasMatrix) {
          if (rnd() < 0.6) { companions.push({ id: `${z.id}-balun`, type: "balun", serves: tv.id }); conns.push({ from: "mx", to: `${z.id}-balun`, signal: "video" }, { from: `${z.id}-balun`, to: tv.id, signal: "video" }); }
          else conns.push({ from: "mx", to: tv.id, signal: "video" });
        } else conns.push({ from: pick(devs.filter(d => d.type === "source")).id, to: tv.id, signal: "video" });
        if (hasAvb && rnd() < 0.3) conns.push({ from: tv.id, to: "in", signal: "audioReturn" });
      }
      if (spk) {
        if (ampIds.length) { const amp = pick(ampIds); conns.push({ from: amp, to: spk.id, signal: "speaker", channels: `${++ampCh}`, ...(z.scope !== "included" ? { scope: z.scope } : {}) }); }
        else if (tv && rnd() < 0.5) conns.push({ from: tv.id, to: spk.id, signal: "audio" });
      }
      if (rnd() < 0.08) annotations.push({ text: `Note for ${z.name} & co <${k}>`, near: z.id });
    }
    for (const s of devs.filter(d => d.type === "source")) {
      if (hasMatrix && rnd() < 0.8) conns.push({ from: s.id, to: "mx", signal: "video" });
      if (hasAvb && rnd() < 0.4) conns.push({ from: s.id, to: "in", signal: "audio" });
    }
    if (hasAvb) { conns.push({ from: "avb", to: "in", signal: "network" }, { from: "avb", to: "out", signal: "network" }); for (const a of ampIds) conns.push({ from: "out", to: a, signal: "audio", ...(rnd() < 0.3 ? { count: 2 } : {}) }); }
    if (hasMatrix && devs.some(d => d.id === "avr") && rnd() < 0.7) conns.push({ from: "mx", to: "avr", signal: "video" });
    const r = conns.filter(c => c.signal === "audioReturn" || (c.from === "avb"));
    for (const c of r) if (rnd() < 0.25) c.routeHint = pick([{ ch: "ab" }, { ch: "west" }, { ch: "staple" }, { ch: "ab", between: ["mx", "in"] }]);
    const job = { generator: "SignalPath", schemaVersion: 1, job: { name: `Fuzz ${k}`, client: { name: "C", address: "1 A St, B, CA" }, stage: "proposal" },
      house: { zones }, solutions: [{ id: "s1", name: "Proposed", racks: [{ id: "rack", name: "Equipment Rack", devices: devs }], localDevices: locals, companions, connections: conns, annotations }] };
    if (extras) addExtras(job);
    if (rnd() < 0.3) {
      const s2 = structuredClone(job.solutions[0]); s2.id = "s2"; s2.name = "Option B";
      const ep = zones.flatMap(z => z.endpoints).find(e => e.type === "display");
      s2.overrides = { zones: { [zones[0].id]: { scope: "future" } }, endpoints: ep ? { [ep.id]: { size: 99 } } : {} };
      job.solutions.push(s2);
    }
    return job;
  }
  const rx = mulberry32(SEED ^ 0x5eed1e);
  const px = arr => arr[Math.floor(rx() * arr.length)];
  function addExtras(job) {
    const sol = job.solutions[0], conns = sol.connections, devs = sol.racks[0].devices;
    for (const z of job.house.zones) {
      const r = rx();
      if (r < 0.3) z.reach = px(["short", "average", "far", "nowhere", 7]);          // junk values too
      else if (r < 0.45) z.runFt = px([15, 33, 60, 130, 250, 0, -5, "80", 1e6]);
    }
    // rack → TV runs become Bullet Trains, sometimes carrying eARC
    for (const c of conns) if (c.signal === "video" && c.from === "mx" && /-tv$/.test(c.to) && rx() < 0.5) {
      c.run = "bullet"; if (rx() < 0.3) c.earc = true;
    }
    // a receiver feeding a TV: over a Bullet Train or a balun, with the eARC kit back
    if (devs.some(d => d.id === "avr")) {
      for (const z of job.house.zones) {
        const tv = z.endpoints.find(e => e.type === "display"); if (!tv || rx() > 0.35) continue;
        if (conns.some(c => c.to === tv.id && c.signal === "video")) continue;
        const bal = rx() < 0.5;
        if (bal) { sol.companions.push({ id: `${z.id}-bx`, type: "balun", serves: tv.id }); conns.push({ from: "avr", to: `${z.id}-bx`, signal: "video" }, { from: `${z.id}-bx`, to: tv.id, signal: "video" }); }
        else conns.push({ from: "avr", to: tv.id, signal: "video", run: "bullet", ...(rx() < 0.5 ? { earc: true } : {}) });
        if (rx() < 0.6) conns.push({ from: tv.id, to: "avr", signal: "audioReturn", earcKit: true, ...(z.scope !== "included" ? { scope: z.scope } : {}) });
      }
    }
    // an eARC kit pointed somewhere odd (an input module) must not break anything
    const tv = job.house.zones.flatMap(z => z.endpoints).find(e => e.type === "display");
    if (tv && devs.some(d => d.id === "in") && rx() < 0.2) conns.push({ from: tv.id, to: "in", signal: "audioReturn", earcKit: true });
  }
  return randomJob;
}
