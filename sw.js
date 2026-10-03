/* SignalPath offline (Ryan 2026-10-02: the app has to open on a job site with no signal).
   Jobs already live on the device (IndexedDB); this keeps the app itself there too.
   - The page (index.html): network first, so a new version arrives whenever there's signal;
     the last copy when there isn't.
   - Everything else of ours (modules, catalog, sample jobs — each stamped ?v=<build>):
     cache first; a new build asks for new URLs, so there's never a stale mix.
   deploy.sh stamps BUILD and the precache list; a new build's worker drops the old caches. */
const BUILD = "20261003044805";
const PRECACHE = ["./app/ai.js?v=20261003044805","./app/asbuilt.js?v=20261003044805","./app/audiochain.js?v=20261003044805","./app/commands.js?v=20261003044805","./app/engine.js?v=20261003044805","./app/exports.js?v=20261003044805","./app/fuzz-jobs.js?v=20261003044805","./app/hookup.js?v=20261003044805","./app/importers.js?v=20261003044805","./app/kinds.js?v=20261003044805","./app/library.js?v=20261003044805","./app/mdimport.js?v=20261003044805","./app/names.js?v=20261003044805","./app/network.js?v=20261003044805","./app/pages.js?v=20261003044805","./app/ports.js?v=20261003044805","./app/power.js?v=20261003044805","./app/quickadd.js?v=20261003044805","./app/rack.js?v=20261003044805","./app/racksizes.js?v=20261003044805","./app/route-audit.js?v=20261003044805","./app/sheets.js?v=20261003044805","./app/starters.js?v=20261003044805","./app/catalog.json?v=20261003044805","./mock-system-residence.json","./mock-system-estate.json","./mock-system-belair.json","./mock-system-stress.json"];   // deploy.sh fills this with the stamped module + catalog URLs
const CACHE = `signalpath-${BUILD}`;
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(["./", "./index.html", ...PRECACHE]).catch(() => {})).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("signalpath-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                       // the hub manifest, the AI proxy: never cached here
  const keep = r => { if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; };
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(keep).catch(() => caches.match(req).then(r => r || caches.match("./index.html")).then(r => r || caches.match("./"))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(keep)));
});
