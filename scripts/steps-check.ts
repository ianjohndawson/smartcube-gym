// Validate step registry + engine wrapper: solve each step from the scramble
// (cumulatively), confirm detection fires, and time it.
import { METHODS, SCRAMBLES, type Method } from '../src/steps.ts';
import { newSolved, parseMoves, applyMoves, optimalToMask, anySolved, solveToMask, type Move3x3 } from '../src/engine-api.ts';

for (const method of Object.keys(METHODS) as Method[]) {
  const def = METHODS[method];
  for (const scr of SCRAMBLES) {
    const scrambleMoves = parseMoves(scr.scramble);
    let history: Move3x3[] = [...scrambleMoves];
    const parts: string[] = [];
    for (const step of def.steps) {
      const t0 = Date.now();
      const sol = optimalToMask(history, step.canonicalMask, step.solver);
      const ms = Date.now() - t0;
      if (!sol) {
        parts.push(`${step.id}=NONE(${ms}ms)`);
        continue;
      }
      history = [...history, ...sol];
      const state = applyMoves(newSolved(), history);
      const ok = anySolved(state, step.candidateMasks);
      parts.push(`${step.id}=${sol.length}mv/${ms}ms/detect:${ok ? 'Y' : 'N'}`);
    }
    // hint timing from the raw scramble (first step), targeting the canonical mask
    const t1 = Date.now();
    const hint = solveToMask(scrambleMoves, def.steps[0].canonicalMask, def.steps[0].solver, [], 1)[0];
    parts.push(`hint=${hint?.length}mv/${Date.now() - t1}ms`);
    console.log(`${method.padEnd(7)} ${scr.id}: ${parts.join('  ')}`);
  }
}
