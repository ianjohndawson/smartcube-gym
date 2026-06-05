// Stub test: build the coaching prompt from a hardcoded context and print it
// (no API call) so we can eyeball tone + structure + no-optimality wording.
import { buildPrompt, SYSTEM } from '../src/coaching.ts';

console.log('===== SYSTEM =====\n' + SYSTEM + '\n');
console.log('===== USER (mid-solve, no question) =====');
console.log(buildPrompt({
  method: 'Petrus',
  methodDescription: 'Build a 2x2x2 block, then expand it to a 2x2x3.',
  stepName: '2×2×2 block',
  stepBlurb: 'Build a solved 2×2×2 corner block — intuition, not algorithms.',
  scramble: "F2 B' D' U F' R2 U2 D B' L2 D' R F' B2 L2 B U2 D' L2 F2",
  movesDone: ['U', "R'"],
  optimalContinuation: "U2 R' L' F2 D",
  nextPiece: 'orange-green edge',
  progress: 0.4,
}));
console.log('\n===== USER (with question) =====');
console.log(buildPrompt({
  method: 'LEOR', methodDescription: 'LEOR opening: a 1x2x3 first block, then the second-side block.',
  stepName: 'First block (1×2×3)', stepBlurb: 'Build a 1x2x3 first block on the left.',
  scramble: "L' R U F R B2 F' R B2 L F' R' D F2 D2 U' F' D L D",
  movesDone: [], optimalContinuation: "R B2 R2 F L' F'", nextPiece: 'orange-blue edge', progress: 0,
  question: 'I keep breaking my block when I insert the last edge — what am I doing wrong?',
}));
