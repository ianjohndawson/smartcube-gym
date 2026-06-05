// Verify the vendored crystalcube engine works inside this project.
import { Cube3x3, PUZZLE_CONFIGS, invertMoves, type Move3x3, type RotationMove } from '../src/engine/puzzles/cube3x3/index.ts';
import { genPruningTable, solve } from '../src/engine/search/index.ts';

function solveStep(scramble: Move3x3[], configName: keyof typeof PUZZLE_CONFIGS, preRotation: RotationMove[] = []) {
  const { moveSet, mask, pruningDepth, depthLimit } = PUZZLE_CONFIGS[configName].solverConfig;
  const translated = [...invertMoves(preRotation), ...scramble, ...preRotation];
  const puzzle = new Cube3x3(moveSet).applyMask(mask).applyMoves(translated);
  const table = genPruningTable(puzzle, { name: configName, pruningDepth });
  return solve(puzzle, table, { pruningDepth, depthLimit, maxSolutionCount: 2 });
}

const scramble = "R U R' U' F2 D B2 L F' U2 R2 B D' L2 U F2 D2 R'".split(' ') as Move3x3[];
for (const cfg of ['EO', 'EOLine', 'EOCross', 'EO222', 'Cross', 'FB'] as const) {
  const t0 = Date.now();
  const sols = solveStep(scramble, cfg);
  console.log(`${cfg.padEnd(8)} ${sols[0]?.length} moves [${sols[0]?.join(' ')}] (${Date.now() - t0}ms)`);
}
