// Behavioural harness for src/storage.ts.
//
// storage.ts is the single gateway to localStorage; these checks pin down the
// contract the rest of the app relies on: the `cube-trainer.` prefix, validated
// enum/bool/JSON reads that fall back instead of throwing, and the one-time,
// non-destructive MAC-key migration. Run with: npx tsx scripts/storage-check.ts
//
// localStorage doesn't exist under Node, so we install a minimal in-memory shim
// before exercising the module. storage.ts only touches localStorage from inside
// its functions (never at import time), so a static import is safe here.

// --- in-memory localStorage shim ---
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

const ls = (): Storage => (globalThis as { localStorage: Storage }).localStorage;
const reset = (): void => ls().clear();

import * as store from '../src/storage.ts';

// --- tiny check harness ---
let pass = 0, fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass++; }
  else { fail++; console.log(`  ✗ ${name}`); }
}
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const MODES = ['detect', 'ask', 'auto', 'gb', 'ro'] as const;

// 1 — absent keys read as null
reset();
check('unset getRaw returns null', store.getRaw('theme') === null);

// 2 — writes land under the cube-trainer. prefix, not the bare suffix
reset();
store.setRaw('theme', 'borland');
check(
  'setRaw/getRaw round-trips under the cube-trainer. prefix',
  store.getRaw('theme') === 'borland'
    && ls().getItem('cube-trainer.theme') === 'borland'
    && ls().getItem('theme') === null,
);

// 3 — getString returns the fallback when unset
reset();
check('getString falls back when unset', store.getString('last-trainer', 'course222') === 'course222');

// 4 / 5 / 6 — bool reads
reset();
store.setRaw('orient', '1');
check("getBool reads '1' as true", store.getBool('orient', false) === true);
store.setRaw('orient', '0');
check("getBool reads '0' as false", store.getBool('orient', true) === false);
store.setRaw('orient', 'yes');
check('getBool falls back on an unrecognised value', store.getBool('orient', true) === true && store.getBool('orient', false) === false);

// 7 — bool writes are canonical '1' / '0'
reset();
store.setBool('orient', true);
const rawTrue = ls().getItem('cube-trainer.orient');
store.setBool('orient', false);
const rawFalse = ls().getItem('cube-trainer.orient');
check("setBool writes canonical '1' / '0'", rawTrue === '1' && rawFalse === '0');

// 8 / 9 — validated enum reads
reset();
store.setRaw('eo-axis-mode', 'auto');
check('getEnum returns a known member', store.getEnum('eo-axis-mode', MODES, 'detect') === 'auto');
store.setRaw('eo-axis-mode', 'sideways');
check('getEnum falls back on an unknown value', store.getEnum('eo-axis-mode', MODES, 'detect') === 'detect');

// 10 / 11 — JSON reads
reset();
const hist = [{ step: '2x2x2', used: 7, optimal: 6, ts: 123, ms: 4500 }];
store.setJSON('history', hist);
check('getJSON round-trips structured data', eq(store.getJSON('history', []), hist));
store.setRaw('history', '{ this is not json');
check('getJSON falls back on corrupt JSON', eq(store.getJSON('history', [] as unknown[]), []));

// 12 — migration seeds the MAC, preserves the legacy key, and sets its flag
reset();
ls().setItem('block-trainer.cube-mac', 'AA:BB:CC:DD:EE:FF');
store.runMigrations();
check(
  'migration seeds cube-mac from the legacy key, non-destructively',
  store.getRaw('cube-mac') === 'AA:BB:CC:DD:EE:FF'
    && ls().getItem('block-trainer.cube-mac') === 'AA:BB:CC:DD:EE:FF' // legacy NOT deleted
    && store.getRaw('migrated.cube-mac') === '1',                     // flag set
);

// 13 — migration is one-time (won't resurrect a cleared MAC) and never overwrites
reset();
// one-time: after a successful migration, clearing the MAC and re-running is a no-op
ls().setItem('block-trainer.cube-mac', 'AA:BB:CC:DD:EE:FF');
store.runMigrations();
store.removeRaw('cube-mac');
store.runMigrations();
const notResurrected = store.getRaw('cube-mac') === null;
// no-overwrite: a MAC already in our namespace is never clobbered by the legacy one
reset();
ls().setItem('block-trainer.cube-mac', 'AA:BB:CC:DD:EE:FF');
store.setRaw('cube-mac', '11:22:33:44:55:66');
store.runMigrations();
const notOverwritten = store.getRaw('cube-mac') === '11:22:33:44:55:66'
  && ls().getItem('block-trainer.cube-mac') === 'AA:BB:CC:DD:EE:FF';
check('migration runs once and never overwrites an existing MAC', notResurrected && notOverwritten);

// --- report ---
const total = pass + fail;
console.log(`storage-check ${pass}/${total}`);
console.log(fail === 0 ? 'STORAGE OK — all behavioural checks passed' : 'STORAGE FAILED');
if (fail > 0) process.exitCode = 1;
