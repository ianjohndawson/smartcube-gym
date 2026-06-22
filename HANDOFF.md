# HANDOFF.md — for the Claude Code session

This repo was audited in a chat session (working from an iPad, so changes were
verified in a sandbox rather than committed). This file is the plan to finish on
a real machine. **Read `CLAUDE.md` first** for durable architecture, build/verify
commands, and guardrails.

Run `npm run build` + the relevant harness(es) after **each** item below.

---

## Step 1 — implement the already-verified work directly

These were verified in the audit (build green, all harnesses 0 mismatches) but
never reached the repo. There is no patch to apply — just do them directly.

**Batch 1 (audit H1 + M1):**
- Delete `src/solver.ts` — 100% dead, no importer anywhere in `src/` or `scripts/`
  (grep first to confirm, per the guardrail).
- Remove the 6 `(e as any)` casts in `bluetooth.ts`. The `gan-web-bluetooth`
  library exports `GanCubeEvent` as a proper discriminated union, so inside
  `case 'MOVE':` etc. TypeScript narrows `e` and exposes `.move` / `.serial` /
  `.facelets` without the cast. Removing them restores type-safety and catches
  field typos the `any` currently hides.

**M3 — centralise localStorage:**
- Create `src/storage.ts`: one namespace under the `cube-trainer.` prefix, typed
  get/set primitives, validated enum reads (fall back to default on unknown
  values), and a **non-destructive, one-time** migration that seeds the cube MAC
  from the old `block-trainer.cube-mac` key into `cube-trainer.cube-mac` without
  deleting the old key.
- Route all ~15 `localStorage` call-sites in `main.ts` and `bluetooth.ts` through it.
- Add `scripts/storage-check.ts` (≈13 behavioural assertions, including the
  migration). Expect 13/13.

Verify: `npm run build`; `npx tsx scripts/storage-check.ts`;
`npx tsx scripts/detect-parity.ts` (expect 0 mismatches).

---

## Step 2 — remaining work, in priority order

### M2 — separate test oracles from app code  *(do this BEFORE any further deletion)*
**Why:** `cube.ts` and several `engine-api.ts` exports are unused by the app but
are oracles for `scripts/`. That's invisible, so a future cleanup deletes them by
accident (nearly happened in the audit).
**How:**
- Move `src/cube.ts` → `scripts/oracle-cube.ts` (only `parity-blocks.ts`,
  `resync-check.ts`, `resync-bridge-check.ts` import it); repoint those imports.
- Relocate the oracle-only `engine-api.ts` exports (`isMaskSolvedFromHistory`,
  `anySolved`, and any others the harnesses use) into a `scripts/oracles.ts`,
  marked oracle-only, so they don't ship in the bundle.
- Genuinely dead in both app *and* harnesses — safe to remove: `maskProgressState`,
  `statesEqual`, `maskProgressFromHistory`, `nearestMask`.
**Done when:** app and harnesses both build/pass; nothing oracle-only ships in `dist`.

### M4 — type-check `scripts/` and run harnesses in CI
**Why:** `tsconfig.json` includes only `src`, so `scripts/` is never type-checked,
and CI runs only `tsc` + `vite build` — the harnesses can silently rot.
**How:** add a typecheck pass that covers `scripts/` (a second tsconfig or an
explicit include), and wire `npm run check` into the CI workflow.
**Done when:** CI fails if a harness reports a mismatch or `scripts/` mistypes.

### M5 — collapse the engine-boundary casts
The 5 `as unknown as string[]` / `as never` casts at the engine boundary →
one typed helper. Small and self-contained.

### H2 — carve up `main.ts` (~2,027 lines)
**How:** extract in this order — **pure moves, no behaviour change**, build after each:
1. `theme.ts` — theming + the matrix-rain canvas (self-contained).
2. `dom.ts` — `el` / `btn` / `renderCubeNet`.
3. `stats.ts` — history / course load/save/compute (clean once `storage.ts` exists).
4. `eo-axis.ts` — axis-agnostic EO mode/gesture/commit + its EO index tables.
5. `view/` — split the ~30 `buildXxx()` DOM builders by panel.
Keep the core state machine in `main.ts`.
**Done when:** `main.ts` is materially smaller; build + all harnesses pass.

### Low priority
- Match build targets: vite `es2020` vs tsconfig `ES2022` (`vite.config.ts`).
- Enable `noUnusedLocals` / `noUnusedParameters` (≈5 fixes; or exclude `src/engine/`).
- Gate the `window.gym` debug hook behind `import.meta.env.DEV`.
- Schedule a `noUncheckedIndexedAccess` pass (~84 fixes; worthwhile for an
  index-heavy cube engine).
- `npm audit`: esbuild/vite **dev-server-only** advisory; fix is a Vite major — defer.

---

## Guardrails (also in CLAUDE.md)
- **Don't edit `src/engine/`** (vendored, MPL-2.0) beyond import paths.
- **Grep `scripts/` before deleting any "unused" symbol** — it may be an oracle.
- **Keep every harness at 0 mismatches**; add one when adding a non-trivial algorithm.
- **Don't pipe `tsc` through `head`** (SIGPIPE undercounts errors) — redirect to a file.
- All `localStorage` access goes through `src/storage.ts`.
