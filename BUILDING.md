# Building SignalPath from the ground up

This document is the reconstruction recipe: the order things were built in, the architectural decisions that made it work, and the lessons that were paid for in debugging time. If the repo vanished tomorrow, a competent developer (or AI agent) following this guide would arrive at substantially the same app.

---

## 0. Philosophy — decide this before writing any code

1. **The engine is headless.** Every stage — load, validate, advise, place, route, render — is a pure function: data in, data (or an SVG string) out. No DOM access, no globals, no state. The UI is a disposable shell around it.
2. **No build step, no dependencies.** Plain ES modules served statically. The whole app deploys by copying files to a GitHub Pages repo. This constraint is load-bearing: it keeps the dev loop instant and the app runnable anywhere.
3. **Tests are a browser page.** `tests.html` imports the engine, runs every assertion on load, and prints pass/fail. No test framework, no Node. The bar for every change is *all tests green*, and behavior changes ship with new assertions.
4. **Measure before keeping.** Routing "improvements" are judged by measured hop counts on fixed fixtures, never by intuition. Several plausible ideas were rejected because the numbers got worse (see §9).
5. **Catalog honesty.** A device spec is `verified: true` only when it traces to a manufacturer datasheet or manual. Placeholders are explicitly `verified: false` and hunted down later. An authored guess that turns out wrong poisons the advisor.

## 1. The data model

A **job** is JSON:

```
{
  job: { name, client, pages: {...} },        // metadata + page flags
  house: {
    zones: [ { id, name, scope,               // scope: included | prewire | future
        remote,                                // savant | appletv | josh | factory
        endpoints: [ { id, type, ... } ],      // display | speakers | keypad ...
        localDevices: [ { id, type, ... } ] } ]// at-display gear: ATV pucks, encoders, Sonos amps
  },
  solutions: [ {
    id, name,
    devices: [ { id, type, model, catalogRef, zones: [...] } ],  // rack gear
    connections: [ { from, to, signal, count } ],                // edges by id
    overrides: { zones: {id: patch}, endpoints: {id: patch} }    // per-solution sparse patches
  } ],
  catalogSnapshot: {...}                       // per-job catalog lockfile, written on save
}
```

Key decisions:

- **Ids are stable and House-owned.** Endpoint/zone ids never change on re-import, so connections and overrides survive a merge. Device ids are namespaced *per solution* (duplicating a solution must not trigger duplicate-id errors).
- **Endpoints belong to the house; devices belong to a solution.** The house is what the home physically is; each solution is one bid's worth of rack gear and wiring against that same house.
- **Per-solution overrides are sparse patches**, not copies. `effectiveHouse(house, sol)` / `effectiveJob(job, solIndex)` apply them; no override means the same object reference passes through (cheap + testable). Patches strip `id`, and an override clears its own `confirm` flag. Structural changes (add/remove endpoints) are only allowed at House scope.
- **Signals are a closed set:** `video`, `audio`, `speaker`, `audioReturn`, `network`, plus scope-derived pre-wire styling. Each gets a color (`SIGNAL_COLORS`) and a grayscale dash pattern (`SIGNAL_DASHES` — video solid, audio `9 4`, return `12 4 2.5 4`, network dotted `2 4`).

## 2. The engine pipeline (`app/engine.js`)

Build these stages in order; each is independently testable.

### 2.1 `loadJob(job)` → normalized job + `indexJob` → `ix`
Normalize defaults, build id→object indexes (`zonesById`, `endpointsById`, `devicesById`, locals), resolve the active solution. Everything downstream takes `(s, ix)` and never searches arrays.

### 2.2 `validate(job, ix)` → errors/warnings
Referential integrity (dangling connection ends, duplicate ids *within a solution namespace*), scope sanity, confirm-flag reminders, readability ceiling (warn past ~`READABILITY_ZONE_CEILING` zones/sheet), orphan endpoints. Nuances learned the hard way:
- A display with an at-display local **source** (Apple TV puck in the same tile) counts as fed — no wire required, no orphan warning. The user explicitly does not want an intra-tile wire drawn.
- A local return encoder with a return input but no backhaul edge to the rack gets a `return-no-backhaul` warning.
- Stale overrides (patching ids that no longer exist) are warnings, not errors.

### 2.3 `advise(job, ix, catalog)` → capacity + licensing + notes
The advisor is where the catalog earns its keep. Per solution (every entry carries `solution: sol.id` so the UI can filter to the active one):
- **Port budgets:** amp channels vs speaker loads; analog inputs vs *trunk runs* (see §5); module analog outputs; digital return inputs (`audioReturn` edges vs `optical + coax + digitalCombo + earc` counts).
- **Licensing tiers:** host/processor picks driven by zone/device/room counts against per-platform rule tables (Savant, Josh, Control4).
- **Notes from catalog flags:** `avb` → "needs an Avnu-certified AVB switch" (Savant sells none — silent failure gotcha); `sonos` → LAN-transport note; endpoint feeding a Sonos line-in source → lip-sync note (≥75 ms group buffering).

### 2.4 `place(job, ix, opts)` → geometry
Canonical 11×17 sheet (`SHEET` constants). Rack occupies the left/center: **three columns** — A (sources), B (switching/matrix), C (amps). Zone cards fill the right/bottom.

The one placement rule that took a redline to learn: **amps bottom-anchor to the rack bottom** (col C stacks upward from the bottom edge, two-phase: lay out A/B first to find the rack height, then position C from the bottom), and **the audio/zone band bottom-aligns with the rack bottom** (dry-layout the band, then shift it down, wrapping upward). This mirrors real racks and makes speaker-wire routing dramatically cleaner.

Zone cards carry their glyphs' relative geometry: display rect, speaker group, stacked `locals` pucks (staggered +26 px per pair), remote corner pill (top-right, user-picked). `place` copies `zone.remote` through.

### 2.5 `route(job, ix, placed, opts)` → polylines + hops
The router is the hardest 40% of the project. See §4.

### 2.6 `render(job, ix, placed, routed, opts)` → SVG string
One big template: frame + title block (text wordmark; logo upload is a future feature), rack tiles with **faceplate glyphs** (AVR = knob ring + display slot; video matrix = 3×3 dot grid; Apple TV = badge; cable box = channel readout; turntable = platter + tonearm; modules stay deliberately plain), zone cards, wires with per-signal color/dash, crossing hop arcs, trunk bus ticks (`×N` at the longest segment's midpoint, paint-order halo), channel strips, dynamic legend (only signals actually present; dashed samples in grayscale mode).

Render also bakes the **interactivity contract** (§7): every wire gets a 12 px transparent `path.wirehit` twin with `data-from/to/signal`; every zone card is wrapped in `g.zcard[data-zone]` *with a transparent fill hit-rect* (an unfilled SVG shape only hit-tests its stroke!); every device tile is `g.devtile[data-device]`. The engine stays headless — it just emits attributes; the UI wires the click handlers.

`opts` worth having from day one: `hideSignals` (view-level filter through place+route; legend adjusts; validation unaffected), `grayscale`, `company` (title block), `rawJob` (see §6).

## 3. The UI shell (`index.html`)

Single file, no framework. Dark top bar: jobs dropdown (+ shipped sample fixtures), solution switcher with duplicate-as-new, stage selector, rules chip, hide-network + B/W checkboxes, Import/Export/Print. Left panel: collapsible ZONES / GEAR / JOB / SETTINGS tabs. Right: the SVG canvas.

The core loop is brutally simple:

```js
function refresh() {
  autoLinkCatalog(S.job, effectiveCatalog());          // self-heal catalogRefs
  const v = loadJob(effectiveJob(S.job, S.sol));       // apply active solution's overrides
  // validate → advise → place → route → render → inject SVG → advisor strip
}
```

Every field edit mutates `S.job` and calls `refresh()`. Autosave debounces 400 ms into IndexedDB. Settings (company block, licensing tables, editable catalog) live in an IDB `__settings` record; on boot, *newly shipped* catalog entries merge in but changed fields never overwrite user edits (a "reset to shipped" button exists for that — remember this when shipping catalog corrections).

When 2+ solutions exist, the ZONES panel shows an "EDITS APPLY TO: House / *solution* only" scope bar; overridden fields get an orange outline and an × revert affordance.

## 4. The router (the hard part)

A structured **channel router**, not a maze solver. Wires travel in registered lanes (`usedH`/`usedV` maps per corridor, sub-lanes for `c`/`a1`/`a2`/`net` classes) so parallel runs space evenly and never overlap. Passes, in order:

1. **Stubs** — intra-card wires: chip→endpoint, local source→display, display→local encoder (in-card orange return stub at `x = cx + 14`), and TV→soundbar (an endpoint→endpoint same-zone connector: down from display bottom, across, up into the speaker group). Stubs never enter the channel system.
2. **Fan-out plans** — per source device, sort targets farthest-first so nested risers don't cross; west and east targets are separate fan-outs.
3. **Rigid runs** — rack-to-rack. When the B/C column gap's center lanes starve, use edge channels (`gap[1]-6`, `gap[0]+6`).
4. **West feeds / east feeds / returns last.** East feeds from bottom-anchored amps use the **dive template**: drop below the audio band via an allocated riser in `[ampRight, eastBandMinX]`, advancing **westward** so the nearest target takes the eastmost riser and farther siblings dive wider and deeper — the strips nest instead of walling each other off. Returns (pass 4c) route after everything, scored by `crossings*100 + pathCongestion` (±30 px neighbor density — measured neutral on current fixtures, kept as insurance), with jog-prefix candidates (allocated gutter descent when the straight drop would pierce a stacked card) and a second scan band beneath the dive-strip territory (`rackBottom+24 … +560`; the first ~340 px belong to dive strips).
5. **Hops** — where wires must cross, the later wire bridges with an arc. A relaxation tier turns forced sibling crossings into bridged hops (reported as `route-relaxed`); flyover is the last resort and counts as a failure smell.

**Trunk runs:** a module→amp audio connection is N physical runs, not one line. `trunkCount(conn, s) = max(conn.count, zones the amp feeds)` — derived from downstream speaker edges so the drawing can't understate capacity, while an authored `count` can add spares. Rendered as one line with a `×N` bus tick; the advisor and channel map consume the true count.

**Debugging infrastructure is not optional.** `route({debug:true})` exports registered channel segments; `place-preview.html` draws placement boxes, routed wires, and a congestion heat overlay. The `rdbg` candidate log (why each return candidate was rejected: `blocked:z19` etc.) is what cracked every hard routing bug.

**Regression guards:** hop-ceiling tests per fixture (currently residence 14 / estate 29 / stress 340, zero fallbacks), plus a geometric never-pierce test: no return/backhaul segment other than the final approach may intersect its target tile. That guard exists because of a real bug: the target tile is exempt from `segBlocked` so the final approach can land on its edge, and that exemption silently blessed a lane that crossed the module's *body*, wrapped the west margin, and re-entered from the left — scoring loved it because cheating through the target costs zero crossings. Any routing change that raises a ceiling must justify itself (the 12→14 residence re-baseline was the price of fixing that pierce).

## 5. The catalog (`app/catalog.json`)

Typed I/O per device: `{ inputs: {analog, coax, optical, hdmi, earc, digitalCombo, dante...}, outputs: {...}, ampCh, flags: [...], verified, source }` plus licensing rule tables per platform. ~55 SKUs across Savant (legacy AVB backplane *and* current PAV IP boxes — two distinct architectures), Sonance (incl. Blaze/MKIII), Anthem, AudioControl, AVPro Edge (MXNet + HDMI matrices), Sonos, Dante bridges.

Process that made it trustworthy:
1. Author placeholders honestly (`verified: false`).
2. Cheap-model research agent does distributor/manual sweeps per brand; findings merged with flags added (agents forget flags like `sonos` — the advisor keys on them).
3. Personal PDF pass on whatever stayed unresolved: fetch the actual manuals, read the rear-panel diagrams. This pass overturned *distributor* claims several times (Sonance MKIII "half-populated" myth; MX-1616 phantom digital outs; M6800D analog count).
4. `autoLinkCatalog` self-heals saved jobs: exact normalized model match (+ known-alias map, + 8K/4K suffix tolerance), same-type only, **never fuzzy** (Axion 8 must not link to AC-MX-88), never touches existing refs.

## 6. Print pages (`app/pages.js`)

Pure functions again: `renderChannelMap` (per-device port tables; amp tables gain a Feed column when trunk-fed), `renderTakeoff` + `takeoffCSV` (NEW/OFE rollup, prewire/confirm/licensing boxes, billable remotes via `REMOTE_BOM`), `renderWireSchedule` + `wireRuns` (V/N/R/S numbering, cable totals; skips in-room links — local feeds and returns that terminate at a local/endpoint must not emit phantom home runs), `renderBomCompare` (≤4 solution columns).

**The BOM-compare trap:** editor callers pass the *active-solution-effective* job. Columns must derive each solution from `opts.rawJob`, or the active solution's overrides silently leak into every column. This is guarded by a test; keep it.

Print = new window, `@page 17in 11in landscape`, one SVG per page, `print()`. Page flags live in `job.job.pages`; BOM compare only counts when 2+ solutions exist.

## 7. Interactivity, quick-add, importers

- **Wire tracing:** canvas click delegation; `elementsFromPoint` cycles overlapping wires in a bundle; selection dims everything else (`.wiresel`), glows both endpoints, shows a tooltip with human names. Tap zone card → open + flash its ZONES row; tap device tile → GEAR. (Testing gotcha: dispatch synthetic clicks on the *target element* with `bubbles: true`, not on the canvas — `e.target` is wrong otherwise.)
- **Quick-add (`app/quickadd.js`):** pure parser for `"family room 5.1 75 sony matrix"` → zone. Spoken-form normalization ("five point one" → 5.1), brand list, scope/OFE/local/matrix/remote tokens, landscape N, projector N, comma/"then" batching. UI adds live preview chips + Web Speech dictation.
- **Importers (`app/importers.js`):** `sniff` by key shape, adapters for SiteWalk surveys and Blueprinted (Savant config) exports, and `mergeHouse` for re-import: match zones by name, keep endpoint ids stable so connections/overrides survive, never delete unmatched.
- **The import door is a trust boundary.** `importAny` runs `stripUnsafe` (recursively deletes `__proto__`/`constructor`/`prototype` keys — JSON.parse happily creates them as own properties) and, for native files, `assertJobShape`: reject anything missing its identity skeleton (schema version, `job` block, `house.zones`, at least one solution, ids on every zone/endpoint), but *normalize* missing lists to empty. Reject-vs-normalize matters: a malformed file must never replace a working job and then get autosaved over it, while a hand-edited file missing an optional array should just work.

## 8. Dev + deploy loop

- **Dev:** edit source → rsync to a temp preview dir → static server with `Cache-Control: no-store` (module caching *will* burn you otherwise; cache-bust dynamic imports with `?v=Date.now()` in tests) → verify in browser → run `tests.html`.
- **Deploy:** copy `index.html` + `app/*` + fixtures into the git repo → commit → push → GitHub Pages serves from main root. Poll the live URL for a marker string to confirm (~30–45 s).

## 9. Lessons (the expensive ones)

1. **Extract layout rules from the user's real documents.** "Amps go bottom-right" was visible in their example schematics all along; under-extracting it cost a full placer/router surgery later.
2. **Rejected-by-measurement is a result worth keeping.** Global river-ordered west lanes (hops 21→27 — stub interference breaks the theory) and west-lane cost sampling (marginal, broke a return) are documented failures so they don't get re-tried.
3. **When routing fails, instrument — don't guess.** Every hard bug fell to logging why each candidate was rejected, not to staring at the picture.
4. **SVG hit-testing:** unfilled shapes only hit their stroke. Bake transparent hit twins/rects at render time.
5. **Distributor listings lie; manuals don't.** Three catalog "facts" from retailer pages were overturned by rear-panel diagrams.
6. **DOM `outerHTML` doesn't entity-encode quotes in text nodes** — regex tests like `/85"/` will match `x="475"`. Use DOM queries or precise matchers in tests.
7. **Draw what installers mean, not what graphs imply:** an Apple TV puck inside a room tile *is* the connection — drawing a wire there is noise. Model the exemption, not the edge.
8. **Sparse overrides beat solution copies.** Copies fork; patches keyed by stable ids survive re-imports and diff cleanly.
9. **Hardening checklist for a static app** (all guarded by tests): one *full* `esc()` everywhere — `&<>"` — because a quote-less escaper is safe in text nodes but not in `value="…"` attributes; escape even "internal" sinks like the print window `<title>` and error messages (they carry user strings); CSV cells starting with `=+-@` get an apostrophe prefix (spreadsheet formula injection); every IndexedDB request promise must reject on `onerror` or a failed save hangs silently — and the DB open itself needs a fallback (in-memory Map + a one-time "export your work" warning) so private-browsing mode doesn't kill boot; stored settings merge defensively (a partial `__settings` record must not brick startup); external URLs (kit manifest) pass a scheme allowlist before becoming `href`s.

## 10. Order of construction (what to build when)

1. Data model + `loadJob`/`indexJob` + first fixtures — get tests running the same day.
2. `validate`, then a minimal `place` + `render` (boxes and labels, no wires) — something on screen fast.
3. Router v1 (stubs + simple channels), then iterate against fixtures with hop-count guards.
4. Editor shell + autosave; wire `refresh()` end to end.
5. Catalog + `advise` + Settings; then importers; then print pages.
6. Polish rounds driven by user redlines: glyphs, interactivity, trunk runs, overrides, returns, grayscale, remotes — each round = feature + tests + deploy + memory note.

The single habit that made the project work: **every round ends with all tests green, a deploy, and a written record.** Nothing was ever "done" in the working tree only.
