# SmartCube Gym — User Manual

SmartCube Gym trains the **intuitive fundamentals** shared by Petrus, ZZ, Roux,
LEOR and APB: **edge orientation (EO)** and **block building**. It connects to a
smart cube over Bluetooth, follows every turn you make live, and checks your
work against an exact solver — so the coaching is always grounded in what your
cube actually did.

Everything is stored locally in your browser. Nothing leaves your device.

---

## Contents

1. [Getting started](#getting-started)
2. [The screen](#the-screen)
3. [The cube views (3D and net)](#the-cube-views)
4. [Categories and trainers](#categories-and-trainers)
5. [Training modes](#training-modes)
6. [Help while solving](#help-while-solving)
7. [The review](#the-review)
8. [The lookahead drill](#the-lookahead-drill)
9. [The pattern vocabulary](#the-pattern-vocabulary)
10. [Hands-free gestures](#hands-free-gestures)
11. [Settings, option by option](#settings)
12. [Stats](#stats)
13. [Getting the most out of it](#getting-the-most-out-of-it)
14. [Troubleshooting](#troubleshooting)

---

## Getting started

**Supported cubes:** GAN, MoYu (Super WeiLong verified), QiYi, Giiker/Xiaomi
and GoCube smart cubes, over Web Bluetooth.

**Browser:** any Chromium browser on desktop/Android. On **iPad/iPhone** use the
**Bluefy** browser (Safari has no Web Bluetooth).

1. Click the **cube pill** in the top bar to connect. Some cubes need their MAC
   address once; it is remembered per cube afterwards.
2. **Start from a solved cube.** On connect the app assumes your cube is solved
   (most smart cubes cannot report their true state reliably at connect time).
   If yours is scrambled, press **Sync to Cube state**.
3. Apply the displayed scramble. The tokens turn green as you go; solving starts
   automatically the instant the scramble matches.

**The one rule that explains everything:** the on-screen cube is a live model of
your physical cube, driven only by the moves the cube reports. Buttons like
"Try again" or "Learn the ideal" never teleport the model — they hand you a
short sequence to physically return your cube to where it needs to be, and
track you along it.

- **Reset Cube** — declares "my physical cube is solved" and starts fresh.
  Only press it when the cube in your hands really is solved.
- **Sync to Cube state** — reads the cube's true state and reconciles the model
  (use after missed moves / drift). Small drift is bridged invisibly; large
  divergence starts a fresh scramble from the cube's real state.

## The screen

- **Scramble panel** — the scramble to apply. Green = done, highlighted = next,
  **red = you turned a wrong face** (undo it, or follow the self-healing "next"
  hint, which always shows a correct path from wherever you are). While solving,
  the scramble is hidden (it is the solution in reverse!).
- **Cube view** — the live model (see below).
- **Course panel** — level chips with stars and lock state, plus
  example/grading progress for the current level.
- **Right pane** — the action buttons, the step meter (moves used vs ideal, or
  the timer), and the output console where hints and solutions appear. After a
  solve it becomes the review.

Status messages flash over the cube view and fade.

## The cube views

**3D cube** (default): drag to spin (or use the arrow keys; the pitch is capped
so it can't flip over). The three **floating panels** are back-views — live
mirrors of the faces currently hidden, so you never have to spin to read the
whole cube. Highlights (hints, bad edges) appear on both the cube and its
panels.

**Flat net**: all six faces unfolded, everything visible at once — the more
analytical view. Some people prefer it for EO scanning.

Switch in **Settings → Cube view**. Everything works identically in both.

On some trainers stickers are **tappable** (a pointer cursor appears): on the
free 2×2×2 steps, tap any sticker of a corner to aim your block there; during a
lookahead rep, tapping is how you answer; in a Foundations guided rep, tapping
answers the find-the-piece prompts.

## Categories and trainers

Pick with **Change** in the bar under the title: Category → Trainer → Mode.

### Course — the curriculum

- **Foundations** — the taught beginner course, and the place to start if
  block building is new. Four lessons build the 2×2×3 from its smallest unit,
  all at one fixed corner (the orange-green-yellow one): **Make a pair →
  Complete the 2×2×1 → Finish the 2×2×2 → Extend to a 2×2×3**. Each lesson
  runs in phases:
  - **watch** — curated examples with the route already shown; walk them
    through with the guided replay. Never graded. The next example is served
    when you arrive with a solved cube.
  - **guided** — find-the-piece tap prompts ("tap the orange-green-yellow
    corner"), then live coaching on every turn: pieces placed, the pair made
    or split, your built block broken or recovered.
  - **coached** — one what-to-look-for line at the start, then you lead.
  - **independent** — no prompts.

  You advance on **proficiency, not efficiency**: 2 guided successes unlock
  coached, 3 coached unlock independent, and 3 of your latest 4 independent
  reps complete the lesson (the next one unlocks). A rep counts as a success
  when you finish **without "Show ideal"** — Hint and Next move are always
  fair game, and move counts are tracked in Stats but never gate a lesson.
  Lessons that pre-build a block outline it with a dashed ring: that is the
  part to protect. The review answers the beginner questions — did I build
  it, did my block survive, which pattern does the taught route use, and what
  to spot next time. Finish all four lessons, then graduate to the graded
  2×2×3 course and the free Blocks drills.

The graded courses below unlock levels in order. Each level is graded on
**consistency**, not one lucky solve: over your last 12 graded solves at the
level, a solve is **clean** if it is within **+2 of optimal**; 70% clean earns
★ (and unlocks the next level), 85% ★★, 100% ★★★. **Discard** in the review
removes a botched rep.

- **2×2×2 course** — the technique curriculum. Levels are *lessons* keyed to
  the pattern vocabulary (Simple joins → Double joins & Swings → Roundabouts &
  rescues → full scrambles). Each lesson opens with a few **seeded examples**:
  the status names the technique, and you can walk it through with
  **Show ideal → Walk it through**. Examples never count toward your grade.
  After the examples, the app generates practice cases that genuinely use the
  lesson's technique — short scrambles, because these patterns live near the
  end of a build. Note: the next example is served when you enter the lesson
  (or Reset) with a solved cube; mid-session "Next" gives practice cases.
- **2×2×3 and 1×2×3 courses** — graded ladders by difficulty (optimal move
  count), L1 easy → L4 full scrambles.

### EO — edge orientation

All EO trainers follow the app's conventions: **scramble white-top/green-front,
solve yellow-top**. An edge is *bad* if it cannot be solved without a quarter
turn of F/B (for the standard axis) — the hint explains per case.

- **Full** — orient all 12 edges, nothing else. You may solve against either
  side axis (Blue front or Red front); by default the app just reads which one
  you solved off the finished cube. The review compares both axes ("Red was 7,
  you took Blue at 9") and offers **Try the other front** on the same scramble.
- **EOLine** — EO + the DF/DB edges, the classic ZZ start. The line is always
  built on the **white** face (bottom of the yellow-top view).
- **EOCross** — EO + the full white cross, the modern ZZ opening.
- **1×2×3** — the scramble pre-builds a left 1×2×3 (Roux/LEOR first block);
  orient all edges without breaking it.
- **2×2×3** — the scramble pre-builds a 2×2×3 (Petrus/APB); orient all edges
  keeping it. The long-side colour is random each scramble. **Settings →
  2×2×3 + EO · method** picks your hold: Petrus turns the block to the
  bottom-back (fix edges with R/L), APB keeps it on the left (fix with F/B) —
  same solve, different notation.

### Blocks — free block-building drills

- **2×2** — build a 2×2×2 corner block **anywhere**. The coaching follows the
  placement you are actually building (progress, ideal count, hints all track
  *your* block, not a prescribed one). Tap a corner sticker to aim explicitly.
- **2×2×3** — build a 2×2×3 anywhere, any route.
- **2×2 → 2×2×3** — the scramble pre-builds a 2×2×2; extend it.
- **1×2×3 L** — a first block against any face (Roux/LEOR).
- **1×2×3 R (L solved)** — the Roux second block, left block pre-built.

## Training modes

- **Efficiency** — the default. Your move count (in HTM: a physical double turn
  counts as one) against the solver's ideal for the position you actually had.
- **Timed** — a timer runs from your first solve move to completion, with
  moves and TPS in the review. Same detection, different emphasis.

## Help while solving

The ladder, from least to most revealing:

1. **Hint** — names what you're looking at and how to approach it, without
   giving moves. On block steps it names the **pattern** the taught route is
   about to use ("Double join — one turn locks the pair and its second edge
   onto the centre") and points at the piece to focus on; on EO steps it
   highlights the bad edges and states the count.
2. **Next move** — exactly one move.
3. **Show ideal** — the full teaching route for this step. For blocks this is
   the **method route** (build the milestone, then extend — the way a human
   solves), which may be a move or two longer than the raw optimal; scoring
   always uses the true optimal, so the gap stays honest.
4. **Walk it through** — hands your cube back to the step start (with the
   return sequence tracked like a scramble), then guides the ideal move by
   move: green done, blue next, red wrong turn. On block steps the route is
   **annotated**: moves are grouped into boxes by the named technique they
   perform (the live box is highlighted, with the pattern's one-line "how"
   underneath), and the next-move caption says what the move is *doing* —
   setup, the join, carrying the pair, or locking it in. This is where the
   pattern vocabulary is taught, not just named. Walkthroughs aren't scored.
5. **Retry** — back to the scrambled state (again, by physically undoing) for
   another attempt at the same case.

## The review

After each step completes:

- **Your solution vs ideal**, with a verdict (optimal / very efficient / room
  to tighten). "Ideal" here is the optimal for the placement you actually
  solved — build anywhere, you're judged fairly.
- **case:** a rough label of what the scramble demanded (buried piece, keep the
  block, …).
- **placements:** the planning verdict — was your block the cheapest one
  available? ("cheapest was the orange-blue-yellow corner (4) — you built the
  white-red-blue corner (6)"). Available on 2×2×2 and 1×2×3 steps.
- **inspection:** how long you looked before your first move.
- **patterns:** which named techniques the ideal route uses, and which your own
  solve used — the vocabulary making both visible.
- EO trainers add the two-axis comparison instead.
- **Learn the ideal / Try again / Next scramble / Discard** — Discard removes
  the solve from your stats and course grading ("that one didn't count").

## The lookahead drill

The skill: execute one thing while tracking the next. On any block step,
mid-solve:

1. Press **Lookahead**. The app names your next join *and* the piece after it
   ("place the white-green-red corner while predicting the green-yellow edge")
   — then **blanks the entire cube view**.
2. Execute the join on your real cube, keeping mental track of the predicted
   piece. The view stays blank; you're on your own eyes.
3. **Tap the spot** where you believe the piece ended up (either view).
4. The app checks your answer against the cube's true state: right or wrong,
   it names the actual spot and rings it, and your accuracy runs in Stats.

Start with one piece over a short join; as your rate climbs, do your reps
after longer setups. (Longer sequences and multi-piece prediction are planned.)

## The pattern vocabulary

The recurring micro-techniques of block building, as named by Lars Petrus.
The hints, reviews and course lessons all speak this language:

| Pattern | Meaning |
|---|---|
| **Simple join** | A corner and its edge are one turn from forming a pair. |
| **Double join** | One turn locks a pair and its second edge onto the centre — a 2×2×1 in one. |
| **Swing** | Two moves: a pure setup, then a double join. |
| **Double swing** | A symmetric out-join-back setup ending in a double join. |
| **Roundabout** | No pair exists; three turns around a corner manufacture one. |
| **Parallel roundabout** | Two roundabouts solved by the same sequence. |
| **Broken corner** | Nothing home yet; join a loose edge mid-flight, then merge — two simple joins adding up to a double join. |
| **Pillar** | The corner stacked against its own slot — twist out and back to join. |

## Hands-free gestures

In the review (step done, before pressing anything), on the physical cube:

- **Four identical U or D quarter-turns** (e.g. U U U U) — next scramble.
- **Four identical quarter-turns of any side face** (e.g. R R R R) — retry the
  same case.

Both net out to nothing on the cube, so they're safe. They only arm in the
review — mid-solve they're just moves.

## Settings

- **Theme** — Borland Pascal (the default retro look), Modern Dark, Matrix,
  Future. Purely cosmetic; both cube views restyle with the theme.
- **Cube view** — 3D cube (spinnable, with back-view panels) or Flat net.
- **Solve orientation** — White-top (scramble and solve in one frame) or
  Yellow-top (x2): scramble white-top, then physically flip to solve yellow-top;
  all displayed notation is translated to the held frame. EO trainers manage
  their own frames and ignore this.
- **Full EO · side axis** — Detect (default: solve either side, the app reads
  which off the finished cube), or pin Blue front / Red front to drill one axis
  deliberately.
- **2×2×3 + EO · method** — Petrus (block turned to the bottom-back, fix edges
  with R/L) or APB (block on the left, fix with F/B). Display only; same solve.
- **Cube** — forget saved MAC addresses if a cube won't reconnect.
- **Cube event log** — the raw Bluetooth event stream, for diagnosing quirks.

## Stats

The top-bar **Stats** shows: average over ideal and % optimal solves, course
stars per track, your lookahead accuracy, solve-time trend (timed solves),
extra-moves for the last 12, and per-step averages. History keeps the last 500
solves, all in your browser's local storage.

## Getting the most out of it

- **Learn the choice, not just the moves.** The planning verdict tells you
  every solve whether a cheaper block existed. Spend inspection time picking —
  the inspection number keeps you honest about whether you actually looked.
- **Let the coaching follow you.** You never have to build where the app
  suggests; hints and progress will follow whichever placement you commit to.
  Tap a corner when you want to declare it up front.
- **Use the course as a curriculum, drills as volume.** Work a 2×2×2 lesson
  until clean, then get repetitions in the free Blocks trainers where every
  review still names the patterns.
- **Walk through, then retry.** The Learn walkthrough plants the route;
  retrying the same case immediately afterwards is where it sticks.
- **EO: always try the other front.** The two-axis comparison in the review is
  the fastest way to develop axis-neutral recognition.
- **Add lookahead reps once a step feels comfortable** — one prediction per
  solve beats a separate session of twenty.

## Troubleshooting

- **Model doesn't match my cube** — press **Sync to Cube state**. If you
  connected with a scrambled cube, Sync is the fix too.
- **Cube won't connect** — check Bluetooth, try forgetting saved MACs in
  Settings; on iPad make sure you're in Bluefy. Some cubes need waking with a
  turn first.
- **Scramble token turned red** — you turned a wrong face; the "next" hint
  under the scramble always shows a correcting path.
- **"ideal ?" in the meter** — the solver declined to answer for this position
  (rare); the solve simply isn't graded.
- **A solve counted that shouldn't have** — press **Discard** in the review.
