// Sanity checks for block detection (fast, no optimal solving):
//  - candidate counts
//  - all 3 expansion directions of a 2x2x2 -> 2x2x3 are members of all223()
//  - detection is position/orientation-agnostic (checks every candidate)
import { all222, all223, all123, blockFromRanges, type BlockGoal } from '../src/cube.ts';

console.log('candidate counts -> 222:', all222().length, '223:', all223().length, '123:', all123().length);

function key(g: BlockGoal): string {
  return `C${[...g.corners].sort((a, b) => a - b).join(',')}|E${[...g.edges].sort((a, b) => a - b).join(',')}`;
}
const set223 = new Set(all223().map(key));

// The 3 ways to expand the DLF 2x2x2 (x{0,1} y{0,1} z{1,2}) into a 2x2x3:
const expansions: Record<string, BlockGoal> = {
  'extend X (long axis L-R)': blockFromRanges([0, 1, 2], [0, 1], [1, 2]),
  'extend Y (long axis D-U)': blockFromRanges([0, 1], [0, 1, 2], [1, 2]),
  'extend Z (long axis B-F)': blockFromRanges([0, 1], [0, 1], [0, 1, 2]),
};
let allOk = true;
for (const name of Object.keys(expansions)) {
  const g = expansions[name];
  const present = set223.has(key(g));
  allOk &&= present;
  console.log(`${present ? 'OK ' : 'MISS'}  ${name}  (corners ${g.corners} edges ${g.edges})`);
}
console.log(allOk ? '\nAll three expansion directions are detected.' : '\nSOME EXPANSIONS MISSING');
