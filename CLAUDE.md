# CLAUDE.md — SmartCube Gym

Durable project context. Claude Code auto-reads this file at the repo root on
every session. Read it before touching anything.

SmartCube Gym is a Vite/TypeScript browser app that trains Rubik's cube
sub-skills (EO and block-building for Petrus/Roux/LEOR/ZZ/CFOP) using a smart cube
over Web Bluetooth — GAN, MoYu, QiYi, Giiker/Mi and GoCube, via the
`smartcube-web-bluetooth` library (`src/bluetooth.ts` is the thin wrapper). It
tracks live cube state and verifies training targets against geometric facelet
masks. Deployed to GitHub Pages.

## Architecture — three layers, treat them differently
- **App code** (`src/*.ts`): the trainer, UI, state machine, scrambles, coaching.
  `main.ts` is the core state machine; focused modules carved off it hold theming
  (`theme.ts`), DOM helpers (`dom.ts`), stats/course persistence (`stats.ts`),
  EO-axis geometry (`eo-axis.ts`), storage (`storage.ts`) and BLE (`bluetooth.ts`).
- **Vendored engine** (`src/engine/`): the IDA* solver, MPL-2.0 licensed.
  **Do not edit beyond import paths.** It's third-party code.
- **Facade** (`src/engine-api.ts`): the typed boundary the app calls the engine
  through. Test-only oracles live in `scripts/oracles.ts`, not the facade.

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
`detect-parity.ts` checks the live solved-detection against `isMaskSolvedFromHistory`
/ `anySolved` from `scripts/oracles.ts`; `parity-blocks.ts`, `resync-check.ts`, and
`resync-bridge-check.ts` use `src/cube.ts` as their oracle. `npm run check`
type-checks `scripts/` and runs the suite (also gated in CI before deploy). Keep
every harness at **0 mismatches**; add an oracle harness for any non-trivial algorithm.

## Traps discovered the hard way
- **"Dead" code may be a test oracle.** `src/cube.ts` looks unused because the
  *app* barely touches it (only `resync.ts`, for `KOCIEMBA_FACELET_COORDS`) — but
  `scripts/` uses the rest as an oracle, so it carries a DO-NOT-DELETE header.
  **Grep `scripts/` before deleting any apparently-unused symbol.**
- **Don't pipe `tsc` through `head`.** It triggers a SIGPIPE that kills the
  process early and *undercounts* errors. Redirect output to a file and read it.
- **Build targets differ:** `tsconfig` targets ES2022 but vite builds es2020.
  esbuild down-levels *syntax* only, not *APIs* (e.g. `.at()`, `findLast`).
  Prefer matching them (low-priority item in HANDOFF).

## localStorage
All `localStorage` access goes through `src/storage.ts`. All GitHub Pages projects
on this account share one origin (`ianjohndawson.github.io`), so keys carry the
`cube-trainer.` prefix to avoid cross-app contamination. Use validated reads — fall
back to default if a stored value isn't a known enum member. Cube MACs are stored
**per device** (keyed by `BluetoothDevice.id`), never as a single shared key.

## Conventions / author context
- Single, well-named files; prose comments that explain **why**. WCA move notation.
- Pedagogical focus is **EO + block-building**, two-handed — **not** ZBLL or
  algorithm memorisation.
- The author (Ian) solves these methods himself — defer to him on method and UX
  semantics.
