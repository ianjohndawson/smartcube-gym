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
  acceptance unchanged.
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
- ~~Course L3 seeds are all Broken corner; category+trainer navigation
  double-resets and can burn two lesson examples.~~ BOTH FIXED 2026-07-23:
  course examples now consume on scramble-APPLY (`courseSeedPending`, same rule
  as Foundations — navigation/retry can't burn them), and the L3 seeds span
  Roundabout / Broken corner / Pillar. `scripts/lessons-check.ts` now guards
  COURSE_SEEDS tags against the TEACHING-default route — which caught and
  fixed a mislabelled L2 seed (its rank-96 route had no named event; the old
  harvest had verified the rank-16 route).

---

## Done (2026-07-23) — Blockbuilding Foundations (the beginner course)

The taught bottom-up curriculum from the Foundations roadmap (its phases 1+2,
reordered to teach the whole ladder in one release):

- **`found223` trainer** (Course category, listed first): four lessons at the
  canonical DLF corner — pair (1×1×2) → 2×2×1 square (1×2×2) → 2×2×2 → 2×2×3
  extension. Every rung is a plain box mask (`blocks.ts` `MASK_PAIR_*` /
  `MASK_221_*`); `humanSolveFromState` teaches them via the single-stage ranked
  branch (family `'112'` added).
- **Lesson/phase engine** (`src/lessons.ts` — pure data + gate math; persisted
  by stats.ts under the NEW `foundations` storage key, so graded `course`
  records are untouched): observe → guided → coached → independent; gates
  2 / 3 / 3-of-latest-4; success = target completed with helpUsed < 3
  (ideal/walkthrough is 3); the phase is DERIVED from counts, never stored.
- **Serving**: observe examples (`cases.ts` `LESSON_SEEDS`, tags verified by the
  harness) are consumed when the scramble is APPLIED, not issued — immune to
  the double-reset example burn that bites course222. Other phases generate
  through the existing prereq path plus per-lesson difficulty caps
  (`gen.maxOptimal`, attempt-capped so serving never stalls).
- **Coaching**: L1 tap-identification (`answerIdentify`; `gym.identifyTarget`
  e2e hook), per-move guided narration from cheap geometry ONLY — piece placed
  (named), pair made/split (`patterns.isPairJoined`), prereq block
  broken/recovered (`scorePlacement`) — coached opening line, and a dashed
  `keep` outline on the prereq block (dom.ts renderers grew a 4th param;
  `.sticker.keep`).
- **Beginner review** (`buildLessonReview`): the roadmap's four answers;
  planning-verdict/inspection lines hidden on lesson reps. Discard pops the
  lesson rep and steps `current` back if it un-completes the lesson.
- **Harness**: `scripts/lessons-check.ts` (gates, mask geometry + nesting,
  seed servability + tag classification, '112' route sweep) in `npm run check`;
  `scripts/harvest-lessons.ts` is the offline seed harvester (run by hand,
  not in the chain).
- **e2e-verified in the browser** (`gym.apply` + new `gym.identifyTarget` /
  `gym.ideal` hooks): the full L1 ladder including a non-counting
  ideal-assisted rep, L2–L4 serving, retry not re-burning examples, Discard
  un-counting, and regression on course222 seeds / b223ext / Stats.

### Foundations follow-ups (roadmap phases 3–5)
- Recovery + placement-choice lessons (roadmap L0/L5 remnants): data-only
  additions to `FOUNDATIONS_223` — recovery cases can reuse pattern-targeted
  generation (Broken corner / Pillar).
- Track 3: 1×2×3 Foundations (Roux/LEOR) via the same LessonDef registry.
- Phase 3 renames: position `course223` as the post-Foundations practice
  ladder; graduation cross-links.
- Observe examples need a solved cube mid-session; consider an unwind-to-solved
  helper for learners who can't yet solve the whole cube.
- Guided "pair made" narration only fires when the pair forms BEFORE the
  placing move (often simultaneous); narrating off the taught route's segments
  would catch more moments.
- First L4 generation pays the one-off ~2s pd5 table build on the main thread —
  covered by the existing Web Worker follow-up above.

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
  `blockEoAxis`); main.ts branches gated by `isBlockEo`. Guarded by
  `scripts/block-eo-check.ts` in `npm run check`.
- **Journey category REMOVED (2026-07-12).** A complete method journey needs
  the algorithmic last layer (CMLL/ZBLL/OCLL+PLL/…), which is explicitly out of
  this app's mission (see CLAUDE.md — not an algorithm trainer) and already
  well served elsewhere. The one distinguishing value it had — practising the
  transition between steps without resetting — is real but better delivered
  later as a feature ON Blocks/EO (chain into the next step without a reset)
  than as a separate, permanently-incomplete category. Cut: the `petrus`
  Journey trainer, the `Journey` category, `STEP_PETRUS_EO`/`MASK_223_EO`,
  `buildJourneyPanel`, and the orphaned `scripts/petrus-eo-check.ts` probe
  (a pre-registry exploration script, never wired into `npm run check`/CI).

---

## Guardrails (also in CLAUDE.md)
- **Don't edit `src/engine/`** (vendored, MPL-2.0) beyond import paths.
- **Grep `scripts/` before deleting any "unused" symbol** — it may be an oracle.
- **Keep every harness at 0 mismatches**; add one when adding a non-trivial algorithm.
- **Don't pipe `tsc` through `head`** (SIGPIPE undercounts errors) — redirect to a file.
- **BLE can't be tested without hardware** — verify cube changes live with the
  in-app event log; don't ship blind BLE changes.
- All `localStorage` access goes through `src/storage.ts`.
