# CLAUDE.md — SmartCube Gym

Durable project context. Claude Code auto-reads this file at the repo root on
every session. Read it before touching anything.

SmartCube Gym is a Vite/TypeScript browser app that trains Rubik's cube
sub-skills (EO and block-building for Petrus/Roux/LEOR/ZZ/CFOP) using a GAN smart
cube over Web Bluetooth. It tracks live cube state and verifies training targets
against geometric facelet masks. Deployed to GitHub Pages.

## Architecture — three layers, treat them differently
- **App code** (`src/*.ts`): the trainer, UI, state machine, scrambles, coaching.
  This is where almost all work happens. `main.ts` is the large core module.
- **Vendored engine** (`src/engine/`): the IDA* solver, MPL-2.0 licensed.
  **Do not edit beyond import paths.** It's third-party code.
- **Facade** (`src/engine-api.ts`): the typed boundary the app calls the engine
  through. Some exports here are used only by harnesses, not the app (see M2).

## Build / verify
- `npm run build` — `tsc --noEmit && vite build`. The compile gate.
- `npm run check` — runs the validation harnesses in `scripts/`.
- Verify changes by **running them**, not by reasoning about them. Establish a
  clean baseline build first, change, then re-run `tsc --noEmit` + `vite build`,
  then the relevant harness(es). Write a focused `npx tsx` harness against the
  engine modules for any non-trivial algorithmic change.

## Validation-via-oracles methodology
The harnesses in `scripts/` check the live state-based paths against an
**independent reference implementation** (the oracle). For example,
`detect-parity.ts` checks the live solved-detection against
`isMaskSolvedFromHistory` / `anySolved` from the facade; `parity-blocks.ts`,
`resync-check.ts`, and `resync-bridge-check.ts` use `cube.ts` as their oracle.
Keep every harness at **0 mismatches**. When you add a non-trivial algorithm,
add an oracle harness for it.

## Traps discovered the hard way
- **"Dead" code may be a test oracle.** `cube.ts` and several `engine-api.ts`
  exports look unused because the *app* doesn't import them — but `scripts/`
  does. **Grep `scripts/` before deleting any apparently-unused symbol.** The
  audit nearly deleted `cube.ts` (an oracle) by accident.
- **Don't pipe `tsc` through `head`.** It triggers a SIGPIPE that kills the
  process early and *undercounts* errors. Redirect output to a file and read it.
- **Build targets differ:** `tsconfig` targets ES2022 but vite builds es2020.
  esbuild down-levels *syntax* only, not *APIs* (e.g. `.at()`, `findLast`).
  Prefer matching them (low-priority item in HANDOFF).

## localStorage
All `localStorage` access goes through `src/storage.ts` once M3 lands (see
HANDOFF). All GitHub Pages projects on this account share one origin
(`ianjohndawson.github.io`), so keys must carry the `cube-trainer.` prefix to
avoid cross-app contamination. Use validated reads — fall back to default if a
stored value isn't a known enum member.

## Conventions / author context
- Single, well-named files; prose comments that explain **why**. WCA move notation.
- Pedagogical focus is **EO + block-building**, two-handed — **not** ZBLL or
  algorithm memorisation.
- The author (Ian) solves these methods himself — defer to him on method and UX
  semantics.
