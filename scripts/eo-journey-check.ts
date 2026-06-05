import { METHODS, SCRAMBLES, type Method } from '../src/steps.ts';
import { newSolved, applyMoves, parseMoves, optimalToMask, anySolved, isMaskSolvedFromHistory, type Move3x3 } from '../src/engine-api.ts';

for (const method of Object.keys(METHODS) as Method[]) {
  const def = METHODS[method];
  const scr = SCRAMBLES[0];
  let history: Move3x3[] = parseMoves(scr.scramble);
  const parts: string[] = [];
  for (const s of def.steps) {
    const t0 = Date.now();
    const sol = optimalToMask(history, s.canonicalMask, s.solver);
    const ms = Date.now() - t0;
    if (!sol) { parts.push(`${s.id}=NONE(${ms}ms)`); continue; }
    history = [...history, ...sol];
    const ok = s.kind === 'eo'
      ? isMaskSolvedFromHistory(history, s.canonicalMask)
      : anySolved(applyMoves(newSolved(), history), [s.canonicalMask]);
    parts.push(`${s.id}=${sol.length}mv/${ms}ms/${s.kind}/detect:${ok ? 'Y' : 'N'}`);
  }
  console.log(`${method.padEnd(7)} ${scr.id}: ${parts.join('  ')}`);
}
