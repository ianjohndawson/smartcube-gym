# Block Trainer

An intuitive **block-building trainer** for speedcubing methods — Petrus, APB, Roux, and
LEOR — with live input from **GAN Bluetooth smart cubes** and optional **AI coaching**.

This is a reframed, method-agnostic successor to the original Petrus-only trainer: the same
single-scramble guided-journey idea, but with a method selector that changes which block
types you train.

## What it does

- **Method selector** — Petrus / APB (2×2×2 → 2×2×3) and Roux / LEOR (1×2×3 left → 1×2×3 right).
- **Single-scramble journeys** — one scramble, guided sequentially through the method's block phases.
- **Block detection in any orientation** — recognises a built 2×2×2, 2×2×3, or 1×2×3 anywhere on the cube.
- **Show ideal** — a verified, efficient solution for the current phase (generated offline by an IDA\* solver).
- **Rewind phase** — snap the model cube back to the start of the current phase.
- **AI coach** — short, method-aware tips via the Anthropic API (model `claude-sonnet-4-20250514`).
- **iPad-optimised dark UI** designed for the **Bluefy** browser (Web Bluetooth).

## Tech

- Vite + TypeScript, no UI framework.
- [`gan-web-bluetooth`](https://www.npmjs.com/package/gan-web-bluetooth) (v3) for GAN BLE, with `rxjs`.
- Browser-direct Anthropic API call for coaching (key stored in `localStorage`).

## Project layout

| File | Purpose |
| --- | --- |
| `src/cube.ts` | Cubie cube model, 18 moves, scramble/facelet parsing, geometry, block-goal generation + detection |
| `src/solver.ts` | IDA\* block solver with an admissible single-piece-distance heuristic |
| `src/journeys.def.ts` | Method/phase definitions, canonical block goals, scrambles |
| `src/journeys.ideals.ts` | **Auto-generated** verified ideal solutions (do not edit) |
| `src/journeys.ts` | Runtime API: merges defs + ideals, "block anywhere" detection |
| `src/bluetooth.ts` | GAN BLE manager wrapping `gan-web-bluetooth` |
| `src/coaching.ts` | Anthropic API coaching client |
| `src/main.ts` | All UI and app state |
| `scripts/gen-journeys.ts` | Build-time generator for `journeys.ideals.ts` |

## Develop

```bash
npm install
npm run gen     # regenerate verified ideals (after editing scrambles/goals)
npm run dev     # dev server, exposed on the LAN for the iPad
npm run build   # type-check + production build
```

The dev server binds to `host: true`, so on the iPad open `http://<your-computer-ip>:5173`
in **Bluefy** (Safari does not expose Web Bluetooth).

### Testing without a cube

Use the **Manual moves** box (e.g. type `R U R' U'`) — moves apply to the model cube exactly
as smart-cube moves do.

### AI coaching

Open **⚙ Settings** and paste an Anthropic API key. It is stored only in this browser.
The call uses the `anthropic-dangerous-direct-browser-access` header — fine for a personal
single-user tool; never ship a shared key.

## Deploy to GitHub Pages

The repo target is `github.com/ianjohndawson/petrus-trainer`, served at
`https://ianjohndawson.github.io/petrus-trainer/`.

1. Uncomment `base: '/petrus-trainer/'` in `vite.config.ts`.
2. `npm run build`
3. `npm run deploy` (runs `gh-pages -d dist`).
4. In the repo settings, set **Pages → Source** to the `gh-pages` branch.

## Smart cube notes

- Primary test cube: **GAN 356 i Carry 2** (Gen3 protocol, fully supported).
- Also: GAN i4 Maglev, GAN Super Weilong v2.
- Hold the cube in the standard scheme (white U, green F) so detection aligns with centres.
- The cube's `FACELETS` events can resync the model if moves are missed.

## Notes on this rebuild

The original `petrus-trainer-source.tar.gz` was not recoverable, so this was rebuilt from the
spec. Behaviour is equivalent but internals differ — in particular, block detection is
generated from a geometric model (any of the 8 / 12 / N candidate sub-blocks), and ideal
solutions are produced by an offline IDA\* solver rather than hand-authored.
