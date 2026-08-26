// Behavioural harness for the daily practice tally in src/stats.ts.
//
// The tally is a SECOND record of something `history` already implies, kept
// because history is capped at 500 solves and the early days would otherwise age
// out of their own chart. Two records of one fact can disagree, so the contract
// worth pinning is exactly that they don't: every completed rep counts once, a
// discarded rep un-counts, and the one-time seed from history never double-counts
// what recordSolve has since added. Run with: npx tsx scripts/daily-check.ts
//
// localStorage doesn't exist under Node, so install the same in-memory shim
// storage-check uses. stats.ts only touches storage from inside its functions.

class MemStorage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  clear(): void { this.m.clear(); }
  getItem(k: string): string | null { return this.m.has(k) ? (this.m.get(k) as string) : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
}
(globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
const reset = (): void => (globalThis as { localStorage: Storage }).localStorage.clear();

import * as store from '../src/storage.ts';
import { dailyRows, dayKey, discardDaily, loadDaily, recordSolve, type HistRec } from '../src/stats.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) pass++;
  else { fail++; console.log(`  ✗ ${name}`); }
}

// A fixed local-noon timestamp N days back — noon so no timezone can drag the
// calendar day across a boundary and make this harness flaky by geography.
function daysAgo(n: number): number {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}
const rec = (step: string, ts: number): HistRec => ({ step, used: 8, optimal: 7, ts });
const total = (day: string): number =>
  Object.values(loadDaily()[day] ?? {}).reduce((a, b) => a + b, 0);

// 1 — a completed rep lands on its own local day, under its own step
reset();
recordSolve(rec('2×2×2', daysAgo(0)));
recordSolve(rec('2×2×2', daysAgo(0)));
recordSolve(rec('EO', daysAgo(0)));
const today = dayKey(daysAgo(0));
check('reps count per step', loadDaily()[today]?.['2×2×2'] === 2);
check('separate steps stay separate', loadDaily()[today]?.['EO'] === 1);
check('day total sums its steps', total(today) === 3);

// 2 — a late-evening rep belongs to that evening, not to tomorrow (local, not UTC)
reset();
const evening = new Date();
evening.setHours(23, 30, 0, 0);
check('23:30 keys to its own local day', dayKey(evening.getTime()) === dayKey(Date.now()));

// 3 — discarding un-counts exactly one rep, and empties prune themselves
reset();
recordSolve(rec('EO', daysAgo(0)));
recordSolve(rec('EO', daysAgo(0)));
discardDaily('EO', daysAgo(0));
check('discard removes one rep', loadDaily()[today]?.['EO'] === 1);
discardDaily('EO', daysAgo(0));
check('last discard drops the step', loadDaily()[today]?.['EO'] === undefined);
check('emptied day is pruned', loadDaily()[today] === undefined);
discardDaily('EO', daysAgo(0));
check('discarding past zero is a no-op', loadDaily()[today] === undefined);

// 4 — the one-time seed reads history, and does NOT re-run over live counts.
// This is the double-count trap: if `loadDaily` reseeded whenever the tally
// looked empty, every rep discarded back to zero would resurrect the whole
// history behind it.
reset();
store.setJSON('history', [rec('2×2×3', daysAgo(1)), rec('2×2×3', daysAgo(1)), rec('EO', daysAgo(2))]);
const yesterday = dayKey(daysAgo(1));
check('seeds from existing history', loadDaily()[yesterday]?.['2×2×3'] === 2);
recordSolve(rec('2×2×3', daysAgo(1)));
check('seed does not re-run after a bump', total(yesterday) === 3);
discardDaily('2×2×3', daysAgo(1));
discardDaily('2×2×3', daysAgo(1));
discardDaily('2×2×3', daysAgo(1));
check('emptied-to-zero does not resurrect history', total(yesterday) === 0);

// 5 — rows come back newest-first, with steps ordered by count
reset();
recordSolve(rec('EO', daysAgo(3)));
recordSolve(rec('2×2×2', daysAgo(0)));
recordSolve(rec('2×2×2', daysAgo(0)));
recordSolve(rec('EO', daysAgo(0)));
const rows = dailyRows(10);
check('rows are newest-first', rows.length === 2 && rows[0].day === today);
check('busiest step leads the day', rows[0].steps[0][0] === '2×2×2');
check('row total is the day total', rows[0].total === 3);
check('limit caps the rows returned', dailyRows(1).length === 1);

// 6 — days with no practice simply have no row (the chart fills the gaps itself,
// which is why absence must stay absence here rather than a zero row)
check('idle days are absent, not zero rows', !rows.some((r) => r.total === 0));

console.log(`daily-check ${pass}/${pass + fail}`);
if (fail) {
  console.log(`DAILY FAILED — ${fail} mismatch${fail === 1 ? '' : 'es'}`);
  process.exitCode = 1;
} else {
  console.log('DAILY OK — one count per rep, discards reverse, the seed runs once');
}
