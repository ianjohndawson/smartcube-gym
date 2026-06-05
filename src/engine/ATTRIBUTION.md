# Engine attribution

The cube-solving engine in this `src/engine/` directory is **derived from
[crystalcube](https://github.com/crystalcuber/crystalcube)** by the crystalcube
authors, used under the **Mozilla Public License 2.0** (see
[`LICENSE-MPL-2.0.txt`](./LICENSE-MPL-2.0.txt)).

Files incorporated (from crystalcube `src/lib/`):

- `search/` — generic iterative-deepening solver + pruning-table generator
- `puzzles/common/` — permutation helpers
- `puzzles/cube3x3/` — `Cube3x3` facelet model, moves, masks, orientations,
  puzzle configs, state helpers
- `types.d.ts` — shared types

**Modifications made:** import paths were changed from crystalcube's
`src/lib/...` absolute style to relative paths so the files build in this
project. No solver logic was altered. The crystalcube full-solve wrapper
(`solvers.ts`, which depends on cubing.js) and the Comlink web-worker wrapper
were **not** incorporated.

## Licensing of the combination

These files remain under the **MPL-2.0**. The rest of this project (the BLE
layer, UI, coaching, step registry, etc.) is licensed under **GPL-3.0-or-later**
(see the root `LICENSE`). MPL-2.0 §3.3 expressly permits MPL-licensed files to be
combined into a larger work distributed under the GPL, provided the MPL files
themselves remain available under the MPL — which they are, here, in this
directory.

The crystalcube **logo** is licensed separately (CC-BY-4.0) and is **not** used.
