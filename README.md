# SignalPath

**CAD-style AV system schematics in the browser.** SignalPath turns a room-by-room description of a residential AV job into an 11×17 engineering sheet — equipment rack, zone cards, signal wiring with hop arcs, title block — plus channel map, takeoff, wire schedule, and BOM comparison pages. Built for [Synergy Audio Video Systems](https://github.com/ryan-synergy) as part of the Synergy Field Kit.

**Live app:** https://ryan-synergy.github.io/signalpath/

No build step, no dependencies, no server. Pure static HTML + ES modules.

---

## What it does

- **Draw a full system schematic** from structured job data: sources, matrices, amps, and switches in a three-column rack; per-room zone cards with display/speaker glyphs; wires routed through a structured channel router with crossing hops, trunk-run bus ticks (`×N`), and a dynamic legend.
- **Five signal types**, color-coded (and dash-coded in grayscale/print mode): video, audio, audio return, network, pre-wire.
- **Multiple solutions per job** (e.g. "Savant AVB" vs "Dante" bids) with per-solution endpoint overrides, a solution-aware advisor, and a side-by-side BOM comparison page.
- **A verified device catalog** (55+ SKUs — Savant, Sonance, Anthem, AudioControl, AVPro Edge, Sonos) with typed I/O counts sourced from manufacturer datasheets. The advisor checks port budgets (analog ins, module outs, digital return ins), licensing tiers, and gear-specific gotchas (AVB switch requirements, Sonos lip-sync buffering).
- **Print pages:** channel map (per-device port tables), takeoff (NEW/OFE rollup + CSV export), wire schedule (numbered runs with cable totals), BOM compare. One-click print to 17×11 landscape.
- **Quick-add / dictation entry:** type or speak `family room 5.1 75 sony matrix, patio landscape 8 prewire` and get parsed zones with preview chips.
- **Importers** for SiteWalk survey JSON and Blueprinted (Savant config) exports, with non-destructive re-import merge.
- **Interactive sheet:** tap a wire to trace it end-to-end, tap a zone card or device tile to jump to its editor row.
- **Autosave** to IndexedDB (with an in-memory fallback and a warning when browser storage is unavailable); native JSON and Markdown round-trip import/export; SVG export.
- **Hardened against hostile input:** every user string is escaped before it reaches the SVG or the editor DOM, imported JSON is structurally validated and stripped of prototype-pollution keys before it can replace a job, and CSV exports neutralize spreadsheet formula injection.

## Running it

**Easiest:** open the live URL above. It works offline-ish after first load and runs fine on an iPad.

**Locally:** the app uses ES module imports, so it needs to be served over HTTP (double-clicking `index.html` will hit CORS restrictions in most browsers). Any static server works:

```bash
cd signalpath && python3 -m http.server 8745
```

Then open http://localhost:8745/. Load a sample job from the jobs dropdown (Residence / Estate / Stress fixtures ship with the app).

## Repo layout

```
index.html              The entire editor UI (state, panels, canvas, print, settings)
app/engine.js           Headless engine: load → validate/advise → place → route → render(SVG)
app/pages.js            Print pages: channel map, takeoff, wire schedule, BOM compare
app/importers.js        SiteWalk / Blueprinted adapters + merge-on-reimport
app/quickadd.js         Shorthand/dictation zone parser
app/catalog.json        Shipped device catalog (verified flags, typed I/O, licensing rules)
app/tests.html          The test suite — open it in a browser, everything runs on load
app/place-preview.html  Debug view: placement boxes, routed wires, congestion overlay
mock-system-*.json      Three fixtures: residence (typical), estate (large), stress (25 zones)
```

## Tests

Open `app/tests.html` in a served browser tab. 280 assertions run on load and report pass/fail with a summary line. The suite covers the data model, validation, advisor budgets, placement geometry, router hop ceilings per fixture (regression guards), render output, importers, quick-add parsing, catalog integrity, and print pages. **All tests green is the bar for every change.**

## Architecture in one paragraph

The engine is a chain of pure functions with no DOM access: `loadJob` normalizes and indexes the job, `validate`/`advise` report problems and capacity budgets, `place` computes every box's geometry, `route` turns connections into channel-routed polylines, and `render` emits the finished SVG string. The UI in `index.html` is a thin shell that re-runs the pipeline on every edit and injects the SVG. Because the engine is headless, the entire behavior is testable from `tests.html` without a browser UI, and print/export are just the same render call with different options.

For the full story — data model, router design, catalog discipline, and how to rebuild the whole thing from scratch — see **[BUILDING.md](BUILDING.md)**. The original frozen spec is in the project's `DESIGN.md` (kept in the dev workspace).

---

Built with [Claude Code](https://claude.com/claude-code).
