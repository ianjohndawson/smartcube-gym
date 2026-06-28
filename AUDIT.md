# AUDIT.md — SmartCube Gym repository audit

Findings from a full sandbox audit: repo cloned, dependencies installed, `tsc`
and `vite build` run, module dependency graph traced from the entry point, and
all validation harnesses executed. Findings are prioritised below. Each carries a
**status** line; the action plan lives in `HANDOFF.md`.

Two legacy files surfaced from a completed engine migration: `solver.ts` (dead)
and `cube.ts` (looks dead, but is a harness oracle — preserved).

> **Resolution (2026-06): all findings below are implemented** — see `HANDOFF.md`
> "Done". The only carry-over is H2's final sub-step (the `view/` builder split),
> deferred because it isn't a pure move. The per-finding **Status** lines below are
> the original audit's; treat them as historical.

---

## High

### H1 — `src/solver.ts` is 100% dead (168 lines)
No importer anywhere in `src/` or `scripts/`. Leftover from the engine migration
to the vendored IDA* engine. Safe to delete after a confirming grep.
**Status:** queued in HANDOFF Step 1 (batch 1). Verified deletable in sandbox.

### H2 — `main.ts` is a ~2,027-line god-module
Mixes theming, DOM building, the state machine, scrambles, stats, EO-axis logic,
and the boot path in one file. Hard to navigate and to test in isolation. Wants a
staged extraction into focused modules (pure moves, build after each).
**Status:** queued in HANDOFF Step 2 (H2). Left for Code — multi-file refactor
that needs real tooling and the harness suite after each extraction.

---

## Medium

### M1 — 6 `(e as any)` casts in `bluetooth.ts`
`handleEvent` casts the BLE event to `any` six times (`.move`, `.facelets`,
`.serial`, `.batteryLevel`, …). Unnecessary: `gan-web-bluetooth` exports
`GanCubeEvent` as a proper discriminated union, so inside `case 'MOVE':` etc.
TypeScript already narrows `e`. Removing the casts restores type-safety and lets
the compiler catch field typos (e.g. `.facelet` vs `.facelets`) that `any` hides.
**Status:** queued in HANDOFF Step 1 (batch 1). Cast-free version verified to
type-check.

### M2 — Dead-looking facade exports, but some are test oracles
`engine-api.ts` has 6 exports unused by the app: `maskProgressState`,
`statesEqual`, `anySolved`, `isMaskSolvedFromHistory`, `maskProgressFromHistory`,
`nearestMask`. **Three are oracles used by the harnesses** —
`scripts/detect-parity.ts` uses `isMaskSolvedFromHistory` and `anySolved` as the
reference the live path is checked against. Deleting them would silently break
validation (and the harnesses aren't in CI — see M4 — so it wouldn't show until
the next manual run). `cube.ts` is in the same category (oracle for
`parity-blocks.ts` / `resync-check.ts` / `resync-bridge-check.ts`).
- **Genuinely removable** (dead in app *and* harnesses): `maskProgressState`,
  `statesEqual`, `maskProgressFromHistory`, `nearestMask`.
- **Keep + relocate** the oracle-only functions (and `cube.ts`) out of the
  production facade so they don't ship in the bundle.
**Status:** queued in HANDOFF Step 2 (M2) — sequenced first in Step 2,
deliberately *before* any further deletion.

### M3 — `localStorage` namespace is inconsistent; Pages shares one origin
The cube-MAC key is `block-trainer.cube-mac` — the **sibling project's**
namespace — while everything else uses `cube-trainer.*`. A leftover from the
Block Trainer fork. The bigger point: all GitHub Pages projects on this account
share one origin (`ianjohndawson.github.io`), and `localStorage` is per-origin,
not per-path — so SmartCube Gym, the LarsPetrus site, and any Block Trainer
deploy all read/write the *same* store. Generic keys risk cross-app
contamination. Centralise into one `storage.ts` with a single prefix and typed
get/set; fix the stray key with a non-destructive migration; replace unchecked
`as EoAxisMode` / theme casts with validated reads.
**Status:** queued in HANDOFF Step 1 (M3). `storage.ts` + `storage-check.ts`
built and verified (13/13) in sandbox.

### M4 — Harnesses aren't type-checked or run in CI
`tsconfig.json` has `"include": ["src"]`, so `scripts/` is never type-checked,
and CI runs only `tsc` + `vite build`. The validation harnesses can silently rot.
Add a typecheck pass covering `scripts/` and wire `npm run check` into CI.
**Status:** queued in HANDOFF Step 2 (M4).

### M5 — Engine-boundary casts
5 `as unknown as string[]` / `as never` casts at the engine boundary. Collapse
into one typed helper. Small and self-contained.
**Status:** queued in HANDOFF Step 2 (M5).

---

## Low priority
- Build targets differ: vite `es2020` vs tsconfig `ES2022` (esbuild down-levels
  syntax only, not APIs like `.at()` / `findLast`). Prefer matching them.
- Enable `noUnusedLocals` / `noUnusedParameters` (≈5 fixes, or exclude `src/engine/`).
- Gate the `window.gym` debug hook behind `import.meta.env.DEV`.
- Schedule a `noUncheckedIndexedAccess` pass (~84 fixes; worthwhile for an
  index-heavy cube engine).
- `npm audit`: esbuild/vite **dev-server-only** advisory; fix is a Vite major — defer.

---

## Methodology notes (also in CLAUDE.md)
- Validation is via **independent oracles** in `scripts/`; keep every harness at
  0 mismatches.
- **Grep `scripts/` before deleting any apparently-unused symbol** — it may be an
  oracle. (`cube.ts` nearly went this way during the audit.)
- **Don't pipe `tsc` through `head`** — SIGPIPE kills it early and undercounts errors.
- **Don't edit `src/engine/`** (vendored, MPL-2.0) beyond import paths.
