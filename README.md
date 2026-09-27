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
- **Print pages:** channel map (per-device port tables), takeoff (NEW/OFE rollup + CSV export), wire schedule (numbered runs with cable totals), BOM compare. Long jobs paginate onto continuation sheets with true "Sheet N of M" numbering. One-click print to 17×11 landscape.
- **Quick-add / dictation entry:** type or speak `family room 5.1 75 sony matrix, patio landscape 8 prewire` and get parsed zones with preview chips. Add `avr` (or `receiver`) and the zone comes wired: an AV receiver in the rack feeds the TV (through an HDBaseT balun) and drives the speakers; `matrix` feeds the TV from the rack's HDMI matrix.
- **The side panel, zone- and box-first:**
  - *ZONES*: each row reads closed — a ✓ / ! mark, what's in the zone and what feeds it ("5.1 surround + 75\" TV · TV ← Axion 8 · speakers ← MRX 540 8K · eARC"), and the advisor's warning for that zone right on the row. Open, the essentials are taps (speaker setup, TV/projector, size presets), then Hookup; name, scope, status, remote and the size check sit behind **More**.
  - *GEAR*: each box is its back panel — **Inputs** and **Outputs** listing what's plugged in (each editable in place), jack use against the catalog ("HDMI 2 of 7", "zones 6 of 8", matching the advisor), and ＋ buttons to plug something in or connect an output.
  - *JOB → All connections*: the full list with search, for checking — no longer the main way to wire.
  - Tapping a zone, box or wire on the drawing focuses just that item in the panel. The panel is resizable (drag its edge; remembered per browser).
- **Commands (type what you want):** the quick-add box also takes changes — "connect cable box to mrx", "kitchen, office and dining to amp 2", "family room from the receiver", "master bed tv direct hdmi", "master optical backup", "patio 75 ofe", "gym prewire", "rename kitchen to Chef's Kitchen", "add an mrx 1140", "delete the turn table" (several: separate with ";"). It previews exactly what will happen before Enter; **↶ Undo** (or ⌘Z) takes back the last command or AI change.
- **✦ AI — Claude drives it:** describe a change in plain words. Claude proposes it as commands; the app runs them on a copy, checks the result with the validator, and shows a preview (each step ✓/✗, problems before → after) that you apply or discard — nothing changes by itself. Three ways in:
  - *Copy prompt for Claude* → paste into claude.ai → paste the reply back. No setup, no key.
  - *Ask Claude* built in: ⚙ Settings → AI → your own API key (stored in this browser only), or a **proxy** that holds the key for the whole crew (`proxy/worker.js`, a Cloudflare Worker — deploy steps are in its header). The built-in AI gets the validator's verdict back and corrects itself (up to two passes) before you see the preview.
  - *For an outside agent* (Claude in Chrome, Claude Code): `window.SignalPath.summary() / vocabulary() / issues() / preview(cmds) / apply(cmds) / undo()`.
- **Rack starting points:** ＋ (new job) offers Savant whole-home, Theater receiver, AV-over-IP (MXNet) or a blank rack — gear catalog-linked, the patching inside the rack done — and the quick-add box suggests the zones line for it. Quick-add then wires each zone: `matrix` feeds the TV, stereo-type speakers take the amp's next free outputs, surround gets a receiver fed from the matrix, `avr` gives the zone its own receiver.
- **Zone hookup:** every zone row has a HOOKUP section — *TV video* from (receiver, matrix, AV-over-IP switch, splitter, source, or gear in the zone), *Run to TV* (HDBaseT balun / MXNet decoder / direct HDMI), *Speakers* from (receiver or amp — an amp gets its next free outputs automatically), *TV audio back* — **eARC over the HDMI** (the default whenever a receiver feeds the TV; no extra run), **eARC + optical backup** (adds a Toslink run to the receiver), **optical only** (to a receiver or audio input module), or none. eARC shows on the channel map and on the video run in the wire schedule; only optical adds a pulled run. When eARC comes back through an HDBaseT balun or MXNet decoder, the advisor asks you to confirm that model passes eARC (many only pass ARC) until the optical backup is added. "＋ New AV receiver…" / "＋ New multi-zone amp…" add the box in place, and when a receiver already does half the zone a one-click button offers the other half. It all writes ordinary connections, visible in GEAR → Connections.
- **Importers** for SiteWalk survey JSON and Blueprinted (Savant config) exports, with non-destructive re-import merge.
- **Markdown exports.** **PlanQueue** saves the proposal-import file PlanQueue reads (`planqueue: proposal-import/1`: front matter, `## Floor`, `### Room`, `- qty | Manufacturer | Model | note`) — rack gear and TV-side adapters by quote part number (catalog `partNo`; guesses say "unsure" until the real PlanQueue part numbers are supplied), speaker sets as Packages PlanQueue picks, owner-supplied gear listed as "customer supplied", outdoor rooms under Exterior, the licensing advisor's host in the rack. A job with pre-wire-only rooms saves two files (technology-systems + technology-prewire); future rooms stay out. **AI .md** saves a review file for an agent: rooms and how each is fed, rack usage, open items, advisor notes, licensing, connections, wire list, the quote lines, the command vocabulary, and the full job as a JSON block — which imports straight back into SignalPath (import takes the last ```json fence).
- **Dante distribution.** A job's audio network is Dante *or* Savant AVB (JOB → Audio network), separate from the control platform. The **Dante (Director amps)** starting rack and quick-add wire it the Synergy way: MXNet TVs get a **DANTE-DV2** decoder (sources get DANTE-EV2 encoders) — audio follows video; TVs without MXNet get an **AXIS2** on their eARC; surround rooms get an **AXIS16** into a **Hyperion** Penta (5.1) / Hepta (7.1), or onto a **Director** across 4–5 zones with the word "director"; stereo zones take the next Director outputs. Every Dante job gets a Dante-mode CBOX-HA (a second one beside the MXNet CBOX) and a dedicated SW24E. Dante links draw dashed; the wire list prints each AXIS's Cat6 to the Dante switch. The advisor covers: one CBOX per MXNet platform (1G / 10G / USP / Dante), DANTE-DV2 carries the source's audio not the TV's apps, VLAN 99 trunking, AXIS2 → set the TV to PCM, multicast when a small encoder feeds 3+ amps, and the Dante switch checklist.
- **Catalog stays current in every browser.** A catalog entry you never edited follows the shipped specs automatically; one you edited is kept and listed in ⚙ Settings as "differs from the latest shipped specs" with an Update button. All 55 entries were re-audited against manufacturer spec sheets on 2026-09-27 (see RESEARCH-CATALOG, round 5).
- **AVWalk → SignalPath in one tap.** AVWalk's OUTPUT tab has a SignalPath card: **Open** (same device) or **Send link** (AirDrop it to the Mac). The survey rides in the link's `#avwalk=` fragment (raw-DEFLATE + base64url, ~2 KB for a 10-room house), never reaches a server, and is cleared from the address bar on arrival. It lands on the import review, where **Draw the rack + wiring** (on by default) turns the walk into a first-draft schematic: MXNet switch (sized by port count) + encoder per rack source + decoder per on-system TV; multi-zone amps for house-fed speakers (behind Savant AVB on a Savant job); a receiver per 5.1/7.1 room or passive soundbar; powered soundbars off the TV's eARC; local amps for locally-fed rooms. Rooms that share a walk audio-zone label stay separate rooms with their own outputs on the same amp. Anything it can't decide (no-feed TVs, direct feeds, in-room receivers) comes back as a ⚠ line.
- **Harness bundling:** when a corridor is too crowded for every wire to get its own lane, feeds from the same device travel as one heavier run with a ×N count and break out near their destinations, electrical-drawing style (each wire still traces individually). Tick **harness** in the top bar to draw every busy sheet this way on purpose: any source with 3+ runs of one signal to rooms shares a trunk (saved with the job, so print and export match).
- **Catalog lock:** each job freezes the device specs it was quoted with; the advisor flags when the catalog has newer data and JOB → Update catalog specs pulls it in.
- **One plain-English vocabulary:** every name a person reads — editor, advisor, sheet, print pages, CSV, quick-add, import review — comes from `app/names.js`, so a box is called the same thing everywhere ("HDMI matrix", "HDBaseT balun at Family Room TV", "Audio return (TV → rack)"). Connections read as sentences grouped by the box the signal leaves; the From/To pickers are grouped (in the rack / adapters / in-zone gear / in the zones), and re-pointing a connection re-guesses what it carries. No raw ids on screen or paper — a test enforces it. A box linked to a catalog product is called by that product's name (brand + model, part numbers shown beside it in the picker, not in the name): picking a product renames the box, and any box whose name drifted from its product is flagged (●) with a one-click fix. Long names are squeezed to fit their rack tile; two-word brands (AVPro Edge) stay together.
- **Interactive sheet:** tap a wire to trace it end-to-end; its tooltip offers **Reroute…**, **Edit connection** (opens that exact connection in GEAR → Connections to change its ends, signal, outputs or scope — the wire stays highlighted and follows the edit) and, for anything serving a zone, **<Zone> hookup**. Opening a connection row in the panel highlights its wire on the sheet. Tap a zone card or device tile to jump to its editor row.
- **Guided rerouting:** don't like a wire's path? Tap it → Reroute → pick from ghost previews of every legal alternate (with live crossing counts). Works on returns, rack-to-rack runs, and feeds out to rooms (riser channel, which card edge it lands on, and in/out of the harness). Choices are stored as topological hints, so they survive re-layout and re-import.
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
app/exports.js          PlanQueue proposal import + AI-review Markdown
app/importers.js        SiteWalk / Blueprinted adapters + merge-on-reimport + drawFromWalk + AVWalk handoff link
app/quickadd.js         Shorthand/dictation zone parser
app/catalog.json        Shipped device catalog (verified flags, typed I/O, licensing rules)
app/tests.html          The test suite — open it in a browser, everything runs on load
app/fuzz.html           Pipeline fuzzer — edge cases + seeded random jobs vs crash/geometry invariants (?n=500&seed=7)
app/place-preview.html  Debug view: placement boxes, routed wires, congestion overlay
mock-system-*.json      Three fixtures: residence (typical), estate (large), stress (25 zones)
app/hookup.js          Zone hookup: read/set a zone's TV video, run type, speaker drive and audio return as plain connections; quick-add auto-wiring
app/commands.js        The command vocabulary: name resolution, run-on-a-copy planning with per-step results, typed-phrase parser
app/ai.js              Job summary + handoff prompt for Claude, reply parsing, the built-in Claude call with self-correction, connection settings
proxy/worker.js        Optional Cloudflare Worker that holds the Anthropic key for ✦ AI (not served by the app)
app/starters.js        Rack starting points (gear + in-rack patching) for new jobs; applyStarter()
app/names.js           The one vocabulary: display names for gear types, adapters, signals, statuses, scopes, speaker setups; describeNode() for any connection end
app/test-fixtures/      Test-only jobs (dense-harness.json: one source → 9 TVs, exercises bundling)
```

## Tests

Open `app/tests.html` in a served browser tab. 510 assertions run on load and report pass/fail with a summary line. The suite covers the data model, validation, advisor budgets, placement geometry, router hop ceilings per fixture (regression guards), render output, importers, quick-add parsing, catalog integrity, and print pages. **All tests green is the bar for every change.** `app/fuzz.html` complements it: hand-built edge cases plus hundreds of seeded random jobs pushed through the whole pipeline, checking for crashes, malformed SVG, `undefined`/`NaN` on paper, wires crossing any device or card body, overlapping hop arcs, vanished wires, and whether a picked reroute (returns, rack runs and zone feeds) reproduces its preview and keeps the whole sheet legal. Every job is also routed in harness style and held to the same geometry checks. Router fallbacks on overloaded layouts are reported as a capacity metric, not a failure.

## Architecture in one paragraph

The engine is a chain of pure functions with no DOM access: `loadJob` normalizes and indexes the job, `validate`/`advise` report problems and capacity budgets, `place` computes every box's geometry, `route` turns connections into channel-routed polylines, and `render` emits the finished SVG string. The UI in `index.html` is a thin shell that re-runs the pipeline on every edit and injects the SVG. Because the engine is headless, the entire behavior is testable from `tests.html` without a browser UI, and print/export are just the same render call with different options.

For the full story — data model, router design, catalog discipline, and how to rebuild the whole thing from scratch — see **[BUILDING.md](BUILDING.md)**. The original frozen spec is in the project's `DESIGN.md` (kept in the dev workspace).

---

Built with [Claude Code](https://claude.com/claude-code).
