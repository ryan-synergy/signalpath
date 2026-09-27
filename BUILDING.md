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
- **Every per-solution finding carries `solution: sol.id`** (same contract as the advisor). The editor validates the *active* solution's effective house, so a sibling solution's scope checks read the wrong overrides; the UI filters findings to the active solution. Duplicate device ids are detected by walking the raw arrays — the index maps have already collapsed duplicates, so checking their keys can never find one.
- A note with no `near` is a legitimate general sheet note; only a note naming a zone that no longer exists is flagged.

### 2.3 `advise(job, ix, catalog)` → capacity + licensing + notes
The advisor is where the catalog earns its keep. Per solution (every entry carries `solution: sol.id` so the UI can filter to the active one):
- **Port budgets:** amp channels vs speaker loads; analog inputs vs *trunk runs* (see §5); module analog outputs; digital return inputs (`audioReturn` edges vs `optical + coax + digitalCombo + earc` counts).
- **Licensing tiers:** host/processor picks driven by zone/device/room counts against per-platform rule tables (Savant, Josh, Control4).
- **Notes from catalog flags:** `avb` → "needs an Avnu-certified AVB switch" (Savant sells none — silent failure gotcha); `sonos` → LAN-transport note; endpoint feeding a Sonos line-in source → lip-sync note (≥75 ms group buffering).

### 2.4 `place(job, ix, opts)` → geometry
Canonical 11×17 sheet (`SHEET` constants). Rack occupies the left/center: **three columns** — A (sources), B (switching/matrix), C (amps). Zone cards fill the right/bottom.

The one placement rule that took a redline to learn: **amps bottom-anchor to the rack bottom** and **AVB/switching gear bottom-anchors in column A** (sources dress the top of the rack, network infrastructure lives low — both are the same two-phase deferred-tile pattern) (col C stacks upward from the bottom edge, two-phase: lay out A/B first to find the rack height, then position C from the bottom), and **the audio/zone band bottom-aligns with the rack bottom** (dry-layout the band, then shift it down, wrapping upward). This mirrors real racks and makes speaker-wire routing dramatically cleaner.

Zone cards carry their glyphs' relative geometry: display rect, speaker group, stacked `locals` pucks (staggered +26 px per pair), remote corner pill (top-right, user-picked). `place` copies `zone.remote` through. **Audio-only cards are `compact`**: content-driven size (tighter padding, 13px title, width floors at the name plus the remote pill), growing back the moment a display or puck moves in. Compact broke a hidden invariant: uniform card widths were what kept the vertical escape gutters between columns clear, so cluster and audio-band rows now advance on a **column grid** (cell = the cluster's widest card) instead of each card's own width — cards stay small, gutters stay routable.

### 2.5 `route(job, ix, placed, opts)` → polylines + hops
The router is the hardest 40% of the project. See §4.

### 2.6 `render(job, ix, placed, routed, opts)` → SVG string
One big template: frame + title block (text wordmark; logo upload is a future feature), **keynote annotations** (a zone caveat draws as a circled number on its card, with the full sentence in the legend's NOTES block — never as free-floating canvas text), rack tiles with **faceplate glyphs** (AVR = knob ring + display slot; video matrix = 3×3 dot grid; Apple TV = badge; cable box = channel readout; turntable = platter + tonearm; audio input/output modules wear mirrored jack fields — input cluster left with an inward arrow, output cluster right flowing out, matching where the wires attach), zone cards, wires with per-signal color/dash, crossing hop arcs, trunk bus ticks (`×N` at the longest segment's midpoint, paint-order halo), channel strips, dynamic legend (only signals actually present; dashed samples in grayscale mode).

Render also bakes the **interactivity contract** (§7): every wire gets a 12 px transparent `path.wirehit` twin with `data-from/to/signal`; every zone card is wrapped in `g.zcard[data-zone]` *with a transparent fill hit-rect* (an unfilled SVG shape only hit-tests its stroke!); every device tile is `g.devtile[data-device]`. The engine stays headless — it just emits attributes; the UI wires the click handlers.

`opts` worth having from day one: `hideSignals` (view-level filter through place+route; legend adjusts; validation unaffected), `grayscale`, `company` (title block), `rawJob` (see §6).

## 3. The UI shell (`index.html`)

Single file, no framework. Dark top bar: jobs dropdown (+ shipped sample fixtures), solution switcher with duplicate-as-new, stage selector, rules chip, hide-network / harness / B/W checkboxes (harness is per-job: `job.job.harnessStyle`), Import/Export/Print. Left panel: collapsible ZONES / GEAR / JOB / SETTINGS tabs. Right: the SVG canvas.

**The side panel (v2, 2026-09-27).** It grew by accretion into a database editor (a 21-row wire list, 15-field zone forms, advisor messages far from their cause); the rebuild is organized the way a tech thinks — rooms and boxes. *Zone rows* are summaries first: `statusMark` (✓ / ! / grey) from `S.findings` (validator + advisor findings routed to the zone by their `ref` — endpoint, adapter or in-zone gear → zone — and to boxes by device id), a what-it-is + what-feeds-it line from `readHookup`, and the first issue inline. Open rows use tap chips for small fixed choices (`chips()`; a chip calls the same handler as its old `<select>` through the `ZH` registry with a `{value, closest}` stand-in, so overrides/solution scope keep working), and push rare fields behind a `<details class="more">` whose open state is kept in `S.openRows` (`more:<id>`). *Box rows* are back panels: inbound/outbound connections as `connRowHTML` rows (keyed `conn:<i>@<context>` because the same wire shows under both boxes it joins and in JOB's list), jack counts from `portCaps` — preferring the advisor's `io` counts (`S.ioByDev`), since one trunk row can carry six channels — and add-connection buttons whose guess never lands an output on a source. *JOB → All connections* keeps the full list with a client-side search. `openConn` sends a tapped wire to its home (the box it leaves, else the box it enters, else JOB); `focusRows` makes the tapped thing the one open row. CSS gotcha found on the way: `.row.open .fields` opened every *nested* row too — row rules are child-only (`> .fields`). The panel width is a per-browser preference (`#grip`, localStorage), dropped while collapsed so the collapsed rule wins.

**Commands and AI (`app/commands.js`, `app/ai.js`).** One vocabulary (`OPS`: add_zones, set_zone, delete_zone, hookup, connect, disconnect, add_device, set_device, delete_device, set_job, add_revision) serves three callers: typed phrases, pasted command lists, and the AI. Design rules that made it safe: (1) *the AI never edits the job file* — it can only propose commands; (2) `planCommands` runs them on a `structuredClone`, each step atomically (a failing step is rolled back whole, later steps still run — re-read the solution after a rollback, the arrays are replaced), and reports every step in words; (3) the caller previews, then applies the planned copy with an undo snapshot (`pushUndo`, per job); (4) commands go through the editor's own functions (hookup.js, quickadd.js), so its rules hold. Names resolve fuzzily but refuse to guess on ties ("which receiver — X or Y?"); "amp 2", "<zone> tv", bare zones disambiguated by the other end. Typed phrases (`parseCommandText`) return null for anything that isn't a command, so the quick-add box falls back to new zones — but a phrase naming an existing zone edits it (typing "patio 75" must not create a second Patio). The built-in AI uses tool use (`propose_changes`, forced), then feeds the validator's verdict back as a `tool_result` and asks for the complete corrected list (≤2 corrections). Keys: the person's own key (localStorage only, direct browser access header) or a proxy (`proxy/worker.js`: origin allowlist + access code + model allowlist + max_tokens cap; the key stays in Cloudflare). A static site can't hold a shared key — anything in the page is public. Tests stub `fetch` with a fake Claude that errs once, proving the correction loop without spending credit.

**Rack starting points (`app/starters.js`).** `STARTERS` = gear (catalog refs, named by `productName`) + in-rack patching (+ encoder companions for MXNet); `applyStarter` fills a blank job; the quick-add placeholder suggests the matching zones line. `autoHookup` grew to finish zones the way a tech would — stereo-type sets onto the next amp zone with room, surround onto a free (or new) receiver fed from the matrix — found by a test that builds each starter + its suggested zones and demands zero errors and clean routing.

**Zone hookup (`app/hookup.js`).** Connections are edge-centric, but people think zone-first: "the receiver feeds this TV and these speakers." The HOOKUP section in each zone row is a zone-centric *view* over the same connection list — `readHookup` derives {video from + run, speakers from + outputs, audio return} from the edges (a companion in front of the TV means the run is that adapter), and `setVideo` / `setSpeakers` / `setReturn` rewrite just those edges. Rules that matter: an adapter the new choice doesn't reuse is removed with every wire into or out of it (no dangling baluns); switching run type reuses a matching adapter; an AV-over-IP source defaults to an MXNet decoder, other rack sources to an HDBaseT balun, in-zone gear to direct; moving speakers to an amp claims the next free output block (`nextFreeOutputs`), re-picking the same amp keeps its outputs; new edges inherit the zone's scope so pre-wire zones don't trip scope-mismatch. Quick-add `avr` reuses a receiver only if it isn't already driving another zone's speakers, else adds "AV receiver — <zone>" (tiles split placeholder names at the dash so the type stays whole). **TV audio back** is one choice over two facts: eARC is a flag (`earc: true`) on the video edge *leaving the receiver* (receiver→balun or receiver→TV) — it's a property of that HDMI, not a wire, so it draws nothing and adds no schedule run; optical is a real `audioReturn` edge (optionally `backup: true`). `readHookup` folds them into `audioBack` = earc | earc+optical | optical | none; `setAudioBack` writes both. eARC defaults on when a receiver feeds the TV, is carried across run changes, never exists on a non-receiver source, and an existing optical-only choice isn't overridden. Field reality encoded: eARC through an HDBaseT balun / MXNet decoder raises an `earc-extender` advisor note (many extenders pass ARC only) unless the optical backup is present. User's practice: eARC normally, optical backup rarely, "in case ARC is unreliable". No engine change was needed — every hookup shape already validated and routed; the gap was purely that the only way in was hand-building four connection rows.

**Words on screen, ids in the file — one vocabulary.** Stored values stay machine words (`videoMatrix`, `audioReturn`, `surround-5.1`, node ids) because the engine, fixtures, importers and tests read them. Every word a person reads for them comes from `app/names.js`: `TYPE_NAME`, `ADAPTER` (full name + sheet chip tag: HDBaseT balun/BALUN, MXNet encoder/ENC, MXNet decoder/DEC), `SIGNAL_NAME` (+ `SIGNAL_SHORT` for the legend, which must be the first words of the long names), `STATUS_NAME`, `SCOPE_NAME`, `SPEAKER_SETUP`, `REMOTE_NAME`, `PLATFORM_NAME`, and `describeNode(job, sol, id)` → `{group, label, short, kind}` for any connection end ("Anthem MRX-540 (AV receiver)", "Family Room TV (75\")", "HDBaseT balun at Family Room TV", "Apple TV in Patio"). The editor, sheet (chip tags, TV captions, legend), print pages, validator/placer messages, quick-add chips and import notes all import it. "Zone" is the place word (tabs, channel map and amp budgets already said it). Validator and placer findings are written for people and carry the raw id as `ref` for code and tests; the advisor turns router wire ids into names with `humanizeWireIds`. A test breaks the residence every way the validator knows and asserts no message, advisor line, print page or sheet text contains a raw id — it caught two real leaks on its first run (the channel map's receiver summary printed a decoder's id). Product names: `productName(c)` = brand + model with a trailing part-number parenthetical moved to `productSku` (descriptive ones like "(Gen 2)" stay; a model that already starts with the brand isn't doubled). Picking a catalog product sets the device's `model` to it — the old rule only renamed "New Device", so a box could be linked to "Anthem MRX 540 8K" while the sheet said "Anthem MRX-540". GEAR flags drift and offers per-row / all-at-once fixes (existing jobs are never renamed silently). Tiles: `fitText` squeezes a label with `textLength` past its width (model line stays clear of the status LED), and `tileName` keeps the brand whole using the job's locked catalog entry or `MULTIWORD_BRANDS`. Why: the user found an AVR→TV hookup "random" when the pickers showed ids; editors are for people.

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
3. **Rigid runs** — rack-to-rack. When the B/C column gap's center lanes starve, use edge channels (`gap[1]-6`, `gap[0]+6`). Same-column stacked neighbors get a tight **staple** (out the edge facing the target, short channel beside the tiles, in the target's *right* edge) — the over-the-top column wrap is the fallback, chosen only when it measurably crosses less. A-column feeds may also **wrap the west margin** (out the left edge, down the outside, in at port height), taken only when it saves ≥2 crossings over the gap descent. Candidates that lose a cost comparison must only *peek* at ports — a considered-but-rejected candidate that claims a real port can eat both lanes of a 22px tile and wall off a later arrival.
4. **West feeds / east feeds / returns last.** East feeds from bottom-anchored amps use the **dive template**: drop below the audio band via an allocated riser in `[ampRight, eastBandMinX]`, advancing **westward** so the nearest target takes the eastmost riser and farther siblings dive wider and deeper — the strips nest instead of walling each other off. Returns (pass 4c) route after everything, scored by `crossings*100 + pathCongestion` (±30 px neighbor density — measured neutral on current fixtures, kept as insurance), with jog-prefix candidates (allocated gutter descent when the straight drop would pierce a stacked card) and a second scan band beneath the dive-strip territory (`rackBottom+24 … +560`; the first ~340 px belong to dive strips).
**Guided rerouting:** users can override the router's taste per wire, but never its legality. A connection may carry `routeHint` — topological, not geometric: `{ch: "ab"|"west"|"staple"|"wrap", between: [devIdA, devIdB]}` for returns and rack runs; zone feeds take `{ch: "col"|"gutter"}` (west feeds: riser beside the rack vs. past the room band), `{land: "top"|"bottom"}` (east feeds: which card edge), and `{bundle: true|false}` (ride the harness / own run; a `ch` or `land` pin implies own run). The first feed of a group routes first and *is* the trunk, so it never offers "ride". The router honors a hint by constraining its candidate search (channel range pinned, lane band pinned to the strip between two named devices); if the pinned route can't exist it warns `hint-unroutable` and falls back to auto — a hint can never unroute a wire, and the source-exits-right rule outranks hints. `routeAlternates(job, ix, placed, opts, wireId)` re-runs the router under each viable hint and returns the distinct legal paths for the picker UI (ghost previews with live crossing counts). Hints live on the connection object, so they persist, survive `mergeHouse`, and re-route fresh against any future layout. Freeform wire dragging was explicitly rejected: persisted pixel paths go stale on every layout change and fight the deterministic router.

**Harness bundling (pass 4b′).** Zone feeds that find no lane of their own don't fall back immediately — they queue until every sibling has committed, then ride an already-routed sibling (same source device, same signal) by *taking its net*: the lane registry and the hop pass already treat one net as one conductor, so the shared run is legal by construction. The breakout search walks the sibling's path and tries L- and Z-shaped branches into the target (chip from below; card from below or above), picking fewest crossings, then the shortest breakout — so bundles stay together until they're near their destinations (the electrical-drawing convention the user asked for). Members carry `bundleOf` (root wire id) and `trunkLen`; render draws the shared trunk as a heavier translucent underlay with a ×N bus tick on the root segment carrying the most wires. Only would-be fallbacks bundle, so clean sheets are unchanged. On a 200-job random corpus, fallback wires went 349 → 13 (layouts with any fallback 91 → 8); what remains is mostly lone feeds with no sibling to ride.

**Harness style (by choice).** The same machinery as `bundleOnto(h, proactive)`: with `job.job.harnessStyle` (or `opts.harness`, which wins) the 4a/4b passes try bundling *before* routing a feed alone, for any source with 3+ room runs of that signal (rack patches don't count toward the 3). Proactive bundles only ride other zone feeds, never a rack-to-rack patch; a feed with no legal breakout routes alone as usual. Plan order already routes the farthest target first, so the trunk leader is the one the others branch off. Measured on the corpus: crossings −29%, drawn line length −34%, zero bodies crossed; the stress sample drops 319 → 247 hops. Breakouts may not pass through their own target chip except on the final landing leg (the chip is exempt from `segBlocked` so the wire can land on it — found by fuzzing reroutes, where a trunk above the balun dropped straight through it).

**Return fallback.** Every wire class draws a flagged best-effort path when the corridor is full — returns included. A return that finds no legal lane on any free entry port draws its first sane attempt (never piercing its target) as `return-fallback` with a `route-fallback` warning; before, it vanished from the drawing entirely. The UI surfaces `unrouted`, `route-fallback` and `hint-unroutable` in the advisor so a compromised drawing is never silent.

5. **Hops** — where wires must cross, the later wire bridges with an arc. A relaxation tier turns forced sibling crossings into bridged hops (reported as `route-relaxed`); flyover is the last resort and counts as a failure smell.

**Trunk runs:** a module→amp audio connection is N physical runs, not one line. `trunkCount(conn, s) = max(conn.count, zones the amp feeds)` — derived from downstream speaker edges so the drawing can't understate capacity, while an authored `count` can add spares. Rendered as one line with a `×N` bus tick; the advisor and channel map consume the true count.

**Debugging infrastructure is not optional.** `route({debug:true})` exports registered channel segments; `place-preview.html` draws placement boxes, routed wires, and a congestion heat overlay. The `rdbg` candidate log (why each return candidate was rejected: `blocked:z19` etc.) is what cracked every hard routing bug.

**Regression guards:** hop-ceiling tests per fixture (currently residence 5 / estate 25 / stress 319, zero fallbacks), plus a geometric never-pierce test: no return/backhaul segment other than the final approach may intersect its target tile. That guard exists because of a real bug: the target tile is exempt from `segBlocked` so the final approach can land on its edge, and that exemption silently blessed a lane that crossed the module's *body*, wrapped the west margin, and re-entered from the left — scoring loved it because cheating through the target costs zero crossings. Any routing change that raises a ceiling must justify itself (the 12→14 residence re-baseline was the price of fixing that pierce).

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

**Catalog lock.** `lockCatalog(job, catalog)` (run on every save) freezes each used entry the first time it's saved and never overwrites it; `catalogDrift()` lists used entries whose live catalog data differs (surfaced in the advisor and the JOB tab); `refreshCatalogLock()` pulls current specs in on the user's say-so. The editor's `effectiveCatalog()` already lets snapshot entries win — before this, every autosave rebuilt the snapshot from the live catalog, so nothing actually stayed frozen.

**Pagination.** Nothing may draw below y=900 (footnote at 920, footer bar at 940). Each renderer is a `…Pages()` function returning one SVG body per physical sheet: tables split row-wise via `tableFit()` under a "(cont.)" heading (the channel map fills its two columns shortest-first, then opens a new sheet; the takeoff's left and right columns paginate independently; the wire schedule and BOM compare repeat their header row). `renderExtraPages` runs a counting pass first, then renders with true labels, and `sheetTotal()` gives the main drawing its real "1 of N". The single-page `render…()` exports remain as first-sheet wrappers for callers and tests. The 25-zone stress job grew from 4 sheets (with rows running off the paper) to 7.

## 7. Interactivity, quick-add, importers

- **Wire tracing:** canvas click delegation; `elementsFromPoint` cycles overlapping wires in a bundle; selection dims everything else (`.wiresel`), glows both endpoints, shows a tooltip with human names. Tap zone card → open + flash its ZONES row; tap device tile → GEAR. The wire tooltip links both ways: *Edit connection* (`openConn`: resolves the wire to its connection index by from→to + signal, makes it the only open connection row, scrolls after the panel's open transition — scrolling a panel that's still animating open overshoots) and *Zone hookup* (`wireZone`: the zone at the far end, through any adapter, or the near end for a return). Opening a `conn:` row selects its wire; editing an end re-keys `selWire` so the highlight follows the renamed wire. (Testing gotcha: dispatch synthetic clicks on the *target element* with `bubbles: true`, not on the canvas — `e.target` is wrong otherwise.)
- **Quick-add (`app/quickadd.js`):** pure parser for `"family room 5.1 75 sony matrix"` → zone. Spoken-form normalization ("five point one" → 5.1), brand list, scope/OFE/local/matrix/remote tokens, landscape N, projector N, comma/"then" batching. UI adds live preview chips + Web Speech dictation.
- **Importers (`app/importers.js`):** `sniff` by key shape, adapters for SiteWalk surveys and Blueprinted (Savant config) exports, and `mergeHouse` for re-import: match zones by name, keep endpoint ids stable so connections/overrides survive, never delete unmatched.
- **Walk → drawing (`drawFromWalk`) + the AVWalk link.** `importSiteWalk` keeps a per-zone `walk` record (video feed, audio feed, passive bar, shared audio-zone label) on the result — never in the job — and `drawFromWalk(res, catalog)` spends it through `hookup.js` (`setVideo`/`setSpeakers`), so the draft is ordinary gear the editor already understands. Rules that came out of testing against AVWalk's golden surveys: the *room* is the zone (a walk `zoneName` like "Main Level" is an audio grouping → note + own outputs on the same amp; paralleling two rooms on one output is a validator error, correctly); receivers without a matrix feed get sources only when there's exactly one (two can't share a source without a splitter — say so instead); powered soundbars hang off the TV (`audioReturn`); a TV the walk left with no feed stays flagged. The link format is `#avwalk=` + base64url(raw DEFLATE(JSON)) — Apple's `.zlib` *is* raw DEFLATE, the browser reads it with `DecompressionStream("deflate-raw")`; a Swift-made link is decoded in the browser as the cross-check (AVWalk `Core/Sources/SiteWalkCore/Handoff.swift` + `testSignalPathHandoff`).
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
10. **Crash tests can't see geometry bugs.** The first fuzz pass (crashes, malformed SVG, `undefined`) reported 1,100 random jobs clean — and missed that amp escape routes cut through their own amp in 153 of 200 jobs, plus in the shipped estate and stress samples. Adding *geometric invariants* (no segment crosses any device, chip or card body; hop arcs fit their segment; no vanished wires) found them immediately. Assert what the drawing must look like, not just that code ran.
11. **Any exemption list is a place bugs hide.** The router exempts a wire's own source and target from collision checks so it can land on their edges — and three separate bugs hid behind that: the return piercing its target, the col-C escape running back through its own amp, and a stub poking into a card. Exemptions must be per-segment (final approach only), with a separate check for the rest.
12. **Peek-don't-claim, everywhere.** The second "loser claims a port" instance: the return router claimed its entry port before searching and never retried, so a blocked port made the wire vanish. Candidates peek; only the winner claims; a planned booking the winner doesn't use gets released.
13. **Warn on the outcome, not per attempt.** Hint warnings fired inside a per-port retry loop — duplicated, and false-positive on hints that ultimately succeeded.
14. **Deferred saves belong to the object that armed them.** A 400 ms autosave timer read the *current* job when it fired, so deleting a job right after an edit wrote it back, and switching jobs dropped the last edit. Flush pending saves before switching; cancel them before deleting.
15. **Escape every interpolation, including ids and numbers.** Text was escaped but ids in `data-*` attributes and `querySelector` strings were not — a crafted import could run script. Fixed three ways: a strict id charset at the import door, `esc()` on every attribute, `CSS.escape()` on every selector.
16. **Paper has edges.** Every print table grew without bound; a 25-zone job ran rows off the sheet and nobody saw it because the SVG still rendered. Any fixed-size output needs an overflow rule and a test that checks it.
17. **Check the channel table before blaming density.** 165 of 349 "crowding" fallbacks were a one-line omission: the riser-channel choice only knew columns B and C, so column-A sources were sent across the whole rack to the far corridor. Small jobs failing is the tell — crowding doesn't explain a 3-TV house.
18. **Borrow the domain's own answer to density.** Electrical drawings solved crowded corridors long ago with harnesses. Modeled as "a failing wire joins a sibling's net", it needed no new registry rules, and it removed 96% of the remaining fallbacks.
19. **An exemption is scoped to where it's needed.** "Skip the target chip" existed so a wire could *land* on it, but it applied to every segment. Exemptions for the endpoint belong on the last leg only — the same bug returns had (`hitsTarget`), found again in bundling.
20. **One thing, one name — enforced.** The same balun was "HDBaseT receiver" in the editor, "Balun" on the channel map and "HDBaseT Balun" in the takeoff. Label tables scattered per file drift; one vocabulary module plus a test that fails on raw ids keeps it honest.
21. **Let the AI propose, never write.** Giving a model the job file would make every hallucination a corrupted job. Giving it the same small command set the UI uses — run on a copy, checked by the validator, previewed, undoable — turns its mistakes into ✗ lines in a preview it can read and fix.

22. **Bridge apps through the fragment, not a server.** Two static apps on different devices can hand off a whole survey with nothing in between: compress it into the URL `#fragment` (never sent over the wire), open or AirDrop the link, and strip it with `history.replaceState` on arrival so it doesn't sit in the address bar. Build the link at tap time; verify the pair by decoding a link the *other* side made.

## 10. Order of construction (what to build when)

1. Data model + `loadJob`/`indexJob` + first fixtures — get tests running the same day.
2. `validate`, then a minimal `place` + `render` (boxes and labels, no wires) — something on screen fast.
3. Router v1 (stubs + simple channels), then iterate against fixtures with hop-count guards.
4. Editor shell + autosave; wire `refresh()` end to end.
5. Catalog + `advise` + Settings; then importers; then print pages.
6. Polish rounds driven by user redlines: glyphs, interactivity, trunk runs, overrides, returns, grayscale, remotes — each round = feature + tests + deploy + memory note.

The single habit that made the project work: **every round ends with all tests green, a deploy, and a written record.** Nothing was ever "done" in the working tree only.
