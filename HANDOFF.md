# HANDOFF.md — status + remaining work

The repository audit (`AUDIT.md`) has been worked through on a real machine.
**Read `CLAUDE.md` first** for durable architecture, build/verify commands, and
guardrails. Run `npm run build` + `npm run check` (expect 0 mismatches) after each
change.

---

## Done (2026-06)

- **Step 1** — deleted dead `src/solver.ts`; removed the `(e as any)` casts in
  `bluetooth.ts`; added `src/storage.ts` (centralised, validated, prefixed,
  per-device MAC) + `scripts/storage-check.ts` (13/13).
- **M2** — test oracles moved to `scripts/oracles.ts`; dead facade exports removed
  (`maskProgressState`, `statesEqual`, `maskProgressFromHistory`, `nearestMask`);
  `cube.ts` annotated (it's both an app dep via `KOCIEMBA_FACELET_COORDS` and a
  harness oracle — not dead).
- **M4** — `tsconfig.scripts.json` + `npm run check`; the validation harnesses
  carry CI exit codes and run in `.github/workflows/deploy.yml` before build/deploy.
- **M5** — the engine-boundary casts collapsed into one `cubeFromFaceletArray`
  helper (and the spurious `homePermutation` casts removed).
- **H2 (steps 1–4)** — `main.ts` carved into `theme.ts`, `dom.ts`, `stats.ts`,
  `eo-axis.ts` (~2,110 → ~1,720 lines). Pure moves, build-verified after each.
- **Multi-cube Bluetooth** — swapped `gan-web-bluetooth` for
  `smartcube-web-bluetooth` (GAN/MoYu/QiYi/Giiker/GoCube); per-device MAC cache +
  MoYu32 address search. MoYu Super Weilong v2 (`WCU_MY32`) verified on hardware.
- **EO axis modes** simplified to `detect`/`gb`/`ro` (dropped `ask` + `auto` and
  their gesture/prompt machinery; fixed a stray prompt that showed in detect mode).
- **CI / deps hygiene** — runner bumped to Node 22 with current action versions
  (the Node-20 deprecation warning is cleared); `smartcube-web-bluetooth` pinned to
  a commit (`44f1f09`) for reproducible builds.
- **EO review hands-free retry** — a 4× side-face spin (F/B/R/L) retries the case,
  mirroring the U/D advance gesture; the review loop is now hands-off bar Discard.

---

## Done (2026-07) — the block-building arc

Five commits (`2632a10..`): placement-aware coaching, 3D view, planning,
pattern vocabulary, curated course, lookahead drill. Eleven harnesses in
`npm run check`. Highlights:

- **Placement-aware core** (`src/placement.ts` + main wiring): coaching follows
  the placement the user is building (whole-piece hysteresis pick); completion
  acceptance unchanged. Journey pinned to canonical until journeys get their pass.
- **Solver finding:** the vendored IDDFS caps at 1e6 visited nodes; pd-4 tables
  made deep 2×2×3 searches return NULL on 11% of real scrambles (and burn up to
  5s). 223 configs now pd5. `idealLen` memoized; null optimal renders '?' and
  skips Stats/course.
- **3D cube view** (`renderCube3D`, CSS-3D, zero deps): CrystalCube-style hint
  panels (4u, flat ≥34u perspective — stronger perspective occludes the back
  panel), highlight rings mirrored to hints, camera survives re-renders.
  Settings › Cube view (3D default / flat net), all categories.
- **Planning:** review ranks placements ("cheapest was X (4) — you built Y (6)";
  222/123; 223 needs a worker), tap-a-corner pins the coaching (222), inspection
  time recorded (HistRec.insp) + per-move gaps (HistRec.gaps) since P0.
- **Pattern vocabulary** (`src/patterns.ts`): the 8 Lars Petrus block patterns as
  route-event classification; all 21 cases from the source page classify as
  themselves and only themselves (`scripts/patterns-check.ts`). Hints name the
  pattern; review tags ideal + yours.
- **Curated course** (course222): lessons keyed to patterns with seeded examples
  (`src/cases.ts`, excluded from grading) + generated same-technique practice.
  Named shapes are near-completion situations → lessons use SHORT scrambles
  (len 5–10). `humanSolveFromState` gained `rankCount` (generation passes 16:
  22ms/attempt vs ~600ms at the teaching default 96).
- **Lookahead drill:** mid-solve "Lookahead" on block steps — plan the join,
  predict the next-but-one piece, view blanks, execute, tap where it ended up;
  verified against tracked state; accuracy tally in Stats.

### Follow-ups from the arc
- 2×2×3 placement ranking + ranked human-solve in a Web Worker (its 12 pd5
  tables are ~1.6s each); 1×2×3 tap-to-aim needs a two-tap picker.
- Lookahead ladder: longer sequences, multi-piece, whole-block reconstruction;
  hesitation map from the accrued `gaps` data.
- Course L3 seeds are all Broken corner (re-harvest for variety); category+
  trainer navigation double-resets and can burn two lesson examples.
- Journeys deep-dive (placement-aware chains; vertical 2×2×3s need the U/D EO
  axis — same build as the Roux LSE blocker below).

---

## Remaining — TODO

### H2 step 5 — `view/` extraction (deferred; NOT a pure move)
The ~18 `buildXxx()` panel builders in `main.ts` are bound to module-scope
`state`, `render()`, `cube` and dozens of handlers. Extracting them needs a
**state-context refactor first** — lift `state`/`render`/`cube`/the handler set
into a shared module that both `main` and `view/` import. Behaviour-risky (not a
pure move), so left as a deliberate follow-up.

### Low priority (from the audit)
- Match build targets: vite `es2020` vs tsconfig `ES2022` (`vite.config.ts`).
- Enable `noUnusedLocals` / `noUnusedParameters` (auto-catches orphaned imports;
  exclude `src/engine/`).
- Gate the `window.gym` debug hook behind `import.meta.env.DEV`.
- A `noUncheckedIndexedAccess` pass (~84 fixes; worthwhile for index-heavy code).
- `npm audit`: esbuild/vite **dev-server-only** advisory; fix is a Vite major — defer.

### Method / feature roadmap (Ian's, longer-term)
- Roux LSE-EO needs a separate **M/U engine EO axis** (engine EO is F/B only) — the
  main blocker for a real Roux path.
- EOLine / EOCross: the cross/line completion targets the WHITE (model-U) face —
  built on the bottom of the yellow-top solve view (a standard white cross, yellow on
  top). Previously it required the cross on the yellow (D) face, so a white cross with
  EO done was never recognised. Detection (eo-axis.ts), optimal, ideal-target highlight
  (steps.ts canonical masks) and the hold text were all moved to the white face. The
  side AXIS is free: solve R/O or G/B, whichever is easier, and the program reads which
  off the finished cube (detectSolvedEoAxis) — but the cross/line pole is fixed to white
  (Ian's confirmed convention; we do NOT also accept a yellow cross). Guarded by
  `scripts/eo-cross-axis-check.ts` in `npm run check`.
- 2×2×3 + EO (unified APB/Petrus): one EO trainer (`eo223`) replaces the old
  `eo223L`/`eo223B`. Geometry in `src/block-eo.ts`: ONE canonical model target — a
  2×2×3 on WHITE (yellow-top / white-bottom) + the F/B orbit — and a **Method** setting
  (Settings › "2×2×3 + EO · method", default Petrus) that only picks the DISPLAY: APB
  (`x2` view) shows the block bottom-left / F-B moves; Petrus (`x2 y`) shows it
  bottom-back / R-L moves — same solve, notation transposed through the existing
  `disp()`/`toDisplayMoves` path. Each scramble rolls one of 4 whole-cube-`y`
  orientations (a random long-side colour); the app KNOWS the roll, so detection is one
  determined mask (`isBlockEoSolved`, colour-identified) — not "accept any". State:
  `state.blockEoOrient`; module `block-eo.ts` (`blockEoTarget`/`blockEoDisplayRots`/
  `blockEoAxis`); main.ts branches gated by `isBlockEo`. The Petrus **journey** EO step
  (`petrus-eo`) is deliberately left as-is (block-building + journeys are a separate
  deep-dive). Guarded by `scripts/block-eo-check.ts` in `npm run check`.
- ZZ/LEOR/APB journeys (colour-neutral/"any placement" now largely covered by
  the placement-aware core; curated cases shipped as the course222 lessons).

---

## Guardrails (also in CLAUDE.md)
- **Don't edit `src/engine/`** (vendored, MPL-2.0) beyond import paths.
- **Grep `scripts/` before deleting any "unused" symbol** — it may be an oracle.
- **Keep every harness at 0 mismatches**; add one when adding a non-trivial algorithm.
- **Don't pipe `tsc` through `head`** (SIGPIPE undercounts errors) — redirect to a file.
- **BLE can't be tested without hardware** — verify cube changes live with the
  in-app event log; don't ship blind BLE changes.
- All `localStorage` access goes through `src/storage.ts`.
