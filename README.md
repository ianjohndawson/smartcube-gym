# Cube Skills Trainer

An extensible trainer for speedcubing skills — currently **block building** for
Petrus, APB, Roux and LEOR — with live input from **GAN Bluetooth smart cubes**,
**solver-backed coaching**, and a live cube view.

Live: **https://ianjohndawson.github.io/petrus-trainer/**

## Design: solver is the brain, AI is the voice

A fast, mask-driven optimal solver provides ground truth — difficulty, your
moves vs optimal, hints, detection. The Anthropic API explains the *why* in
prose. The solver never lies about optimality; the AI never claims it.

## How it works

- **Step registry** — every trainable skill is a `StepDef` (mask + solver
  config) behind one shared engine and shell. Block steps today; EO / EOLine /
  EOCross / Cross live in the engine and slot in next.
- **Single-scramble journeys** — start solved, apply the scramble (the cube view
  follows), then solving begins automatically and steps are tracked in order.
- **Hint** — optimal next move to the target block, with its home highlighted.
- **Show ideal** — optimal solution for the current step from its start.
- **Efficiency** — your move count vs the solver's optimal, per block.
- **AI coach** — method/step-aware tips (model `claude-sonnet-4-20250514`).
- **GAN BLE** via `gan-web-bluetooth` (v3), iPad/**Bluefy** dark UI.

## Tech & layout

Vite + TypeScript, no framework.

| Path | Purpose |
| --- | --- |
| `src/engine/` | **Vendored crystalcube engine** (MPL-2.0) — generic IDA\* solver, pruning, `Cube3x3` facelet model, masks, configs. See `src/engine/ATTRIBUTION.md`. |
| `src/blocks.ts` | Net-order facelet↔coordinate map; 2×2×2 / 2×2×3 / 1×2×3 block masks |
| `src/engine-api.ts` | Shell-facing API: state tracking, mask detection, cached pruning tables, solving, progress |
| `src/steps.ts` | Step registry (methods → steps) + scrambles |
| `src/bluetooth.ts` | GAN BLE manager (MAC provider, event log) |
| `src/coaching.ts` | Anthropic API client |
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
read automatically. Use the **Manual moves** box to test without a cube.

### AI coaching

Open **⚙ Settings** and paste an Anthropic API key (stored only in this browser).

## Deploy (GitHub Pages)

Production build auto-uses base `/petrus-trainer/`:

```bash
npm run build
npm run deploy   # gh-pages -d dist
```

## Licence

**GPL-3.0-or-later** (see `LICENSE`). The `src/engine/` directory is derived
from [crystalcube](https://github.com/crystalcuber/crystalcube) and remains under
**MPL-2.0** (see `src/engine/ATTRIBUTION.md`); MPL-2.0 §3.3 permits its inclusion
in this GPL work.
