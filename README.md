# SmartCube Gym

An extensible trainer for the *intuitive fundamentals* of niche speedcubing
methods — **block building** (2×2×2 / 2×2×3 / 1×2×3 for Petrus/APB/Roux/LEOR)
and **edge orientation** (Full EO / EOLine / EOCross for ZZ and others) — with
live input from **GAN Bluetooth smart cubes** and a live cube view.

Live: **https://ianjohndawson.github.io/smartcube-gym/**

## Design: the solver is the brain

A fast, mask-driven optimal solver is the source of truth — difficulty, your
moves vs optimal, hints, detection. All hints and feedback are **deterministic**
(computed from the solver + cube state); there is **no AI/LLM and no external
calls** — the app is fully self-contained.

## How it works

- **Two-pane dashboard** — a left column (scramble · live cube view · journey
  chips) and a right pane that tabs between a deterministic **Coach** console and
  a **Stats** panel, with a persistent step-action dock. Skins live between a
  full **Borland Turbo-Vision** treatment and a **Modern Dark** one (toggle in
  the top bar or Settings).
- **Step registry** — every trainable skill is a `StepDef` (mask + solver
  config) behind one shared engine and shell. Blocks + EO / EOLine / EOCross.
- **Single-scramble journeys** — start solved, apply the scramble (the cube view
  follows), then solving begins automatically and steps are tracked in order.
- **Coach console / Help ladder** — `[solver]`/`[hint]`/`[coach]` lines (all
  deterministic, no AI) plus the dock ladder: Nudge (highlight piece / bad edges)
  → Reveal (next optimal turn) → Ideal (full optimal) → Learn (walk the ideal).
- **Stats** — per-step solves are logged to `localStorage`; the Stats tab shows
  avg-over-ideal, optimal %, an extra-moves bar chart, by-step bars, and streaks.
- **Efficiency / Timed** — your move count vs the solver's optimal, or a timer + TPS.
- **GAN BLE** via `gan-web-bluetooth` (v3) with live facelet resync; iPad/**Bluefy**.

## Tech & layout

Vite + TypeScript, no framework.

| Path | Purpose |
| --- | --- |
| `src/engine/` | **Vendored crystalcube engine** (MPL-2.0) — generic IDA\* solver, pruning, `Cube3x3` facelet model, masks, configs. See `src/engine/ATTRIBUTION.md`. |
| `src/blocks.ts` | Net-order facelet↔coordinate map; 2×2×2 / 2×2×3 / 1×2×3 block masks |
| `src/engine-api.ts` | Shell-facing API: state tracking, mask detection, cached pruning tables, solving, progress |
| `src/steps.ts` | Step registry (methods → steps) + scrambles |
| `src/bluetooth.ts` | GAN BLE manager (MAC provider, event log) |
| `src/eo-scramble.ts` | Targeted EO scrambles (BFS the 2048 EO states; sample bad-edge count from the binomial) |
| `src/orient.ts` | Solving-orientation transforms (rotate view + translate notation) |
| `src/main.ts` | UI + state machine |
| `src/cube.ts`, `src/solver.ts` | Independent cubie model + IDA\* used to cross-validate the engine masks (`scripts/parity-blocks.ts`) |

## Run it

Double-click `start.bat`, or:

```bash
npm install
npm run dev     # dev server, exposed on the LAN for the iPad
npm run build   # type-check + production build
```

On the iPad, open the printed Network address in **Bluefy** (Safari has no Web
Bluetooth). For desktop GAN connection in Chrome/Edge, enable
`chrome://flags/#enable-experimental-web-platform-features` so the cube's MAC is
read automatically.

## Deploy (GitHub Pages)

Production build auto-uses base `/smartcube-gym/`:

```bash
npm run build
npm run deploy   # gh-pages -d dist
```

## Licence

**GPL-3.0-or-later** (see `LICENSE`). The `src/engine/` directory is derived
from [crystalcube](https://github.com/crystalcuber/crystalcube) and remains under
**MPL-2.0** (see `src/engine/ATTRIBUTION.md`); MPL-2.0 §3.3 permits its inclusion
in this GPL work.
