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

### Annotated walkthrough (2026-07-23)
The pattern vocabulary is now TAUGHT, not just named: block-step walkthroughs
group the taught route's moves by classified technique (`state.learn.seg` from
`classifyRoute` — the segments partition the route, guarded in lessons-check)
with the live group highlighted and the pattern's PATTERN_HOW line shown
mid-execution; each move carries a mechanical role from `patterns.routeRoles`
(setup / join / carry / place) spoken in the next-move caption. EO walkthroughs
keep the flat list. Roles are per-move geometric truth — the technique story
lives in the segment label (e.g. a Pillar's twist-out move reads "carry" when
another pair is already riding; correct, if occasionally deadpan).

### Foundations follow-ups (roadmap phases 3–5)
- ~~Recovery lesson~~ SHIPPED 2026-07-23 as L5 "Fix a broken corner"
  (`STEP_222_RECOVERY`, fixed-corner 2×2×2, no prereq). Every served case is a
  corner rescue: `LessonDef.gen` gained `patterns?: PatternName[]`, and
  makeScramble's lesson path keeps only scrambles whose taught route classifies
  as one (Broken corner / Pillar), rankCount 16 like course222. Guarded by a
  starvation sweep in lessons-check (≥8/80 at len 7) + the generic seed/tag/
  annotation checks. e2e-verified: gate progression and every generated case
  classifying as a rescue in hint/review/walkthrough.
- ~~Build-from-scratch capstone~~ SHIPPED 2026-07-23 as L6 "Build a 2×2×3 from
  scratch" (`STEP_223_BUILD`, fixed bottom-left 2×2×3, no prereq, gen len 14 /
  maxOptimal 11). The finale: a full build with no head start; the annotated
  walkthrough splits it into the 2×2×2 milestone + extension (classifier
  segments). Graduation message fires on completion. lessons-check relaxes the
  observe watchable-cap to 13 for this lesson only; now 271 checks.
- Placement-choice lesson (roadmap L5 remnant): data-only, once free-placement
  coaching is wanted in the course.
- Capstone walkthrough segments show the classifier's names (or "build" when
  unnamed); a milestone-aware label ("2×2×2" / "extension") would read cleaner
  than a bare "build" for the two staged halves — small buildLearnPane tweak.
- Track 3: 1×2×3 Foundations (Roux/LEOR) via the same LessonDef registry.
- Phase 3 renames: position `course223` as the post-Foundations practice
  ladder; graduation cross-links.
- ~~Observe examples need a solved cube mid-session~~ FIXED 2026-07-23
  (external review flagged the invitation nuance): **Watch an example** in the
  Foundations panel (any phase, while unwatched examples remain) and **Next
  example** in an example's review hand back ONE tracked setup = undo the
  history back to solved, then the seed's scramble — the app's own
  never-teleport idiom, so a learner who cannot yet solve the cube can always
  reach a demonstration. Setups are bounded by `historyResetTo`: a setup that
  provably runs through solved lets `afterChange` replace the accumulated
  history with the seed (its exact from-solved equivalent) at the
  scramble→solve flip, so unwinds stop growing across a session (measured:
  2nd example 39 moves, 3rd 18 instead of ~55). Over `MAX_EXAMPLE_SETUP` (40)
  it declines and advises a reset rather than handing over a silly sequence.
  Examples remain OPTIONAL by design — banking guided successes still moves
  you on (`derivePhase` puts met gates above unwatched examples).
- Guided "pair made" narration only fires when the pair forms BEFORE the
  placing move (often simultaneous); narrating off the taught route's segments
  would catch more moments.
- First L4 generation pays the one-off ~2s pd5 table build on the main thread —
  covered by the existing Web Worker follow-up above.

---

## In progress (2026-07-26) — the UI/UX overhaul

A review found the shell to be a *document* layout being asked to behave like an
*instrument*: every phase of a rep is expressed by rewriting the contents of one
520px right pane and editing captions. Inspection, lookahead and piece tracking
are all new phases, so that shape has to change first. Agreed direction:

- **Three zones — Stage / Now / Log.** Stage holds only what is spatially tied to
  the cube (no prose). A **Now bar** under it holds the current instruction plus
  this phase's one or two verbs, replacing the fading toast, the hold caption, the
  scramble caption and the standing find-prompt. The console becomes a Log.
- **`repPhase()` is the keystone** (not yet written): `setup → inspect → solve →
  review`, with `walkthrough` / `lookahead` / `identify` / `track` as solve
  sub-phases. One function owns the phase; the Now bar, the allowed verbs, the
  stage decorations and the meter all read from it instead of re-deriving from
  raw state. `buildCubePanel` currently interleaves six such conditionals.
- **Verb tiers:** phase verbs in the Now bar · ONE escalating Help control with
  the grading cost on the button (mirroring `helpUsed` 0–3, where 3 voids a
  Foundations rep) · device utilities (Reset, Sync) up beside the cube pill.
- **Brief out of the console** into its own card; retires the `scrollTop` pin.
- **Review + Stats become full-width takeovers**, not tenants of the right pane.
- **IA:** pillars on the SKILL axis only (Build / Orient / Preserve & connect),
  taught-vs-graded-vs-free as a badge, and **lookahead/tracking/inspection as
  per-session drill LAYERS, not pillars** — you always track a piece *while*
  building something, which is how it is already implemented.
- **Inspection:** untimed "Ready" gate by default (`solveReadyMs` /
  `HistRec.insp` already record the measurement); a timed option is a later switch.

### Done so far
- **Themes cut 4 → 2.** Matrix deleted entirely (the rAF rain canvas, its CSS
  block, the `#app::before` reactor, the `.panel::after` brackets, the
  `buildCoachBody` cursor branch, and the Share Tech Mono webfont); `future`
  renamed **Holo** in Settings. Modern Dark demoted to the **base token layer** —
  a bare `:root` with no `data-theme='dark'` anywhere, so `THEMES` holds only the
  two real skins and a stored `dark`/`matrix` validates back to Borland rather
  than leaving the picker with nothing selected. `@keyframes meter-flow` was
  declared inside the Matrix block but is used by Holo — it survived as a shared
  animation. The three orphan `future` media one-liners are consolidated into the
  responsive section, which must name each skin explicitly (a skin's token block
  sets `--s` at specificity 0,1,1 and would silently beat a bare `:root`).
  **Theme budget rule** now in the stylesheet header: a skin may override tokens
  and add a short flourish list, never restructure layout.
- **Dead CSS swept:** `.tab` / `.tab.active` and the `--tabs-pad` /
  `--tab-active-*` tokens (the pane's tab controls went when it became one slot
  with four tenants — zero `.tab` elements rendered), `.menu / .mi / .hot`,
  `.top-meta`, `.statusbar / .sb / .key / .sep`, `.pill / .pill.ok`.
- **The setup-phase meter no longer lies.** It read `width: 100%` / "4/4 pieces
  placed" while the scramble was still being applied, because `progressInfo`
  measures the step target against a cube that hasn't been scrambled yet.
  `buildStepMeter` now delegates to `buildScrambleMeter` while `mode ===
  'scramble'`: applied/total, a real fill, and an off-track caption that agrees
  with the strip.

- **`repPhase()`** (step 3) — one definition of where a rep is:
  `setup | solve | identify | lookahead | walkthrough | review`, plus
  `isSolvingPhase()` for the three phases where you're working the target
  yourself. Replaced five re-derivations, including a review test written out
  verbatim in both gesture handlers. Two corrections fell out: `enterLearn` now
  abandons a lookahead rep in flight (Show ideal → Walk it through used to start a
  walkthrough with all 54 stickers still blanked), and tap-to-aim is disarmed in
  review. The frame helpers (`solveRotation`/`solveFrame`/`notationFrame`)
  deliberately still read `state.mode` and say why — they answer which frame the
  cube is DRAWN in, which must hold across the whole post-scramble half of a rep,
  so `isSolvingPhase` (which excludes walkthrough and review) is the wrong test.
- **`gym.move()`** — `gym.apply` goes straight to `step()`, the one path the
  hands-free review gestures don't run on (they hang off `handleMove`, the live BLE
  callback), so they had no e2e reach at all. Now verified from the browser.
- **Now bar** (step 4) — `buildNowBar`, directly under the stage. The instruction
  was previously spread across the strip's caption, the cube caption, a `[find]`
  console line and a 3.5s toast; all four now converge here. Rendered for the four
  phases that share the generic session pane — walkthrough and review are excluded
  because their dedicated panes already own their instruction and verbs, and a
  second copy would need filler text. Verbs appear only for a phase you can back
  OUT of (Cancel lookahead moved here out of the actions row). Styled from tokens
  only: both skins picked it up with zero per-skin CSS, which is the budget rule
  paying off. The setup line distinguishes the two errands that share the phase —
  applying a scramble vs `enterLearn`'s rewind — as does the meter's label.

  The hold note deliberately STAYED on the stage, against the original sketch: it
  describes the view, not the phase, and shouldn't turn over with the instruction.

  Note `scrambleRemaining()` is not used for the "N to go" count. `simplifyMoves`
  is a single pass over consecutive same-face runs, so a cancellation that only
  becomes adjacent after an inner pair vanishes survives and the count comes out
  inflated (the old strip caption had this too). On-track the Now bar reads
  `scrambleMoves.length - done` and the token the strip is highlighting, so the two
  always agree; off-track it quotes the self-healing head move and no count.

- **Verb tiers** (step 5) — three tiers, three homes. Help collapsed from three
  peer buttons (Hint / Next move / Show ideal) to ONE escalating control driven by
  `state.helpUsed`, the monotonic ratchet the lesson grading already reads: rung 0
  "Hint" → rung 1 "More help" → rung 2 (primary gone). Read off the ratchet, not
  the last request, because `assist()` degrades a nudge to a next-move when there's
  no focus piece — so the rung you land on isn't always the one you asked for.
  A `.help-rung` note reports what's been taken; it was previously visible nowhere.

  **"Show the route" stays separately reachable** rather than being the third
  press: escalation exists to make the cost legible, not to add friction, so a user
  who knows they're stuck still gets the answer in one click — with the cost on the
  button that charges it (`· won't count`, on Foundations lessons only, since
  `helpUsed` doesn't affect graded-course scoring). Observe examples are special-
  cased: `startLessonSolve` reveals the route FOR you, arriving at rung 3 unasked,
  so the note reads "a demonstration — nothing here is graded" instead of a cost.

  Reset and Sync moved from the step bar to a `.cube-group` cluster beside the cube
  pill in the top bar — they act on the physical device, and "Sync to Cube state"
  was spending 152px of prime width on a BLE-drift button. The step bar now holds
  only session verbs (Next scramble, Change). Labels shortened to Reset / Sync with
  explanatory titles; MANUAL.md updated to match.

- **Brief out of the console** (step 6) — `buildBriefCard` replaces `buildBriefing`.
  The standing brief (title, explanation, goal, why, phase ladder, grading rule —
  measured 335px on a fresh Foundations lesson) used to share the console's scroll
  box with the help output, which is why `render()` pinned the console to the bottom
  whenever help was asked for. **That pin is gone**: the help output is now the first
  line of its own box (verified `scrollTop` 0, `scrollHeight === clientHeight`, so
  the log doesn't even overflow). The console gained a `Coaching` header and reads as
  what it is — a log of what you asked for.

  The disclosure default is DERIVED, not stored: open while `briefIsNew()` (no reps
  banked at this level/lesson), collapsed once you have any. `state.briefOpen` holds
  an explicit override from clicking the header. Collapsed is 45px against 335px
  expanded. Free Blocks/EO drills get no card at all — their step blurb is in the
  Now bar.

  **Trap, and a warning for future components:** the log header first used
  `.panel-hd`, which Borland re-purposes STRUCTURALLY — absolutely positioned into
  the enclosing `.panel`'s top border as a DOS dialog legend. Inside a panel that
  put "Coaching" 12px above the right pane, 269px from the log it labelled. It now
  uses `.log-hd`, which duplicates the same typography tokens with no repositioning.
  Reusing a class whose skin override is structural rather than cosmetic is the one
  way to break the theme budget rule by accident — check both skins when reusing.

  The console-collapse half of the agreed "keep it, demoted" was NOT done, on
  purpose: the right pane is a fixed-height flex column, so collapsing the log only
  moves whitespace around. It becomes worth doing in step 7, when Review and Stats
  stop being tenants of that pane and its contents actually change.

### Next
Step 7 (review/stats as takeovers), then the new features. Everything from here is
behaviour-visible — verify in the browser as well as through `npm run check`.

### Known, not yet addressed
- `simplifyMoves` doesn't iterate to a fixed point (above). It also feeds
  `undoToScramble`, `enterLearn`'s rewind and the review's "your moves" display, so
  fixing it would shorten real rewind sequences — but it touches a graded-adjacent
  display, so it wants its own change rather than riding along with UI work.
- On free-placement block trainers the displayed `ideal` can change mid-solve
  without the cube state changing: four U's are identity, `used` correctly stays 0,
  but the ideal moved 4→5. Pre-existing placement hysteresis, not the refactor —
  `b223ext` (single fixed placement) holds steady. Matters because Efficiency
  scores against `used / ideal`. **Partly addressed** in a separate session (the
  no-signal half: nothing placed anywhere → anchor to `preferred`); the residual
  needs a state-derived anchor, which measurably changes which block the coaching
  follows (6% of 222 moves, 8% of 123, 17.6% of 223) — so it is Ian's call, not a
  unilateral fix. Hysteresis and path-independence are fundamentally incompatible.
- The chip row overflows narrow viewports: at 375px the six Foundations lesson
  chips force `.col` to 527px and the whole page scrolls sideways. `.chips` is a
  non-wrapping flex row and `.col` is a grid item with the default
  `min-width: auto`, so the track expands to the chips' min-content width. Isolated
  by hiding each child of `.col` in turn; trainers with no chips panel are clean.
  CSS-only, unrelated to the overhaul.

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
