// Centralised localStorage access for SmartCube Gym.
//
// Why this module exists: every GitHub Pages project on this account is served
// from the same origin (ianjohndawson.github.io), and localStorage is keyed
// per-origin, not per-path. So this app, the LarsPetrus page, and any Block
// Trainer deploy all read and write the *same* store. Two defences live here:
//   1. Every key carries the `cube-trainer.` prefix, so we never collide with a
//      sibling project's generic keys.
//   2. Reads are validated — an unknown enum value or corrupt JSON (which a
//      foreign app on the shared origin could leave behind) falls back to a known
//      default instead of poisoning app state.
//
// All localStorage access in the app goes through this module.

const PREFIX = 'cube-trainer.';

// Key suffixes (the part after PREFIX). Exhaustive list of everything the app
// persists. `migrated.cube-mac` is an internal one-time-migration flag, not app
// data, but it lives in the same namespace.
export type Key =
  | 'theme'
  | 'orient'
  | 'eo-axis-mode'
  | 'eo-last-axis'
  | 'block-eo-method'
  | 'cube-view'
  | 'history'
  | 'course'
  | 'last-trainer'
  | 'cube-mac'
  | 'migrated.cube-mac';

function full(key: Key): string {
  return PREFIX + key;
}

// --- raw primitives ---

export function getRaw(key: Key): string | null {
  return localStorage.getItem(full(key));
}
export function setRaw(key: Key, value: string): void {
  localStorage.setItem(full(key), value);
}
export function removeRaw(key: Key): void {
  localStorage.removeItem(full(key));
}

// --- typed primitives ---

export function getString(key: Key, fallback: string): string {
  return getRaw(key) ?? fallback;
}

// Booleans are stored as the canonical '1' / '0'. Any other value is treated as
// unset and resolves to the fallback.
export function getBool(key: Key, fallback: boolean): boolean {
  const v = getRaw(key);
  if (v === '1') return true;
  if (v === '0') return false;
  return fallback;
}
export function setBool(key: Key, value: boolean): void {
  setRaw(key, value ? '1' : '0');
}

// Validated enum read: returns the stored value only if it is a known member of
// `allowed`, otherwise the fallback. Guards against foreign/corrupt values on the
// shared origin and against an enum that gained or lost members between versions.
export function getEnum<T extends string>(key: Key, allowed: readonly T[], fallback: T): T {
  const v = getRaw(key);
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
export function setEnum<T extends string>(key: Key, value: T): void {
  setRaw(key, value);
}

// JSON read with a structural fallback; never throws on corrupt or absent data.
export function getJSON<T>(key: Key, fallback: T): T {
  const v = getRaw(key);
  if (v === null) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
export function setJSON<T>(key: Key, value: T): void {
  setRaw(key, JSON.stringify(value));
}

// --- one-time, non-destructive migrations ---

// Pre-fork leftover: the cube MAC was once stored under the sibling project's
// `block-trainer.` namespace. Seed it into our own namespace without deleting the
// original (another deploy on the shared origin may still rely on it).
const LEGACY_MAC_KEY = 'block-trainer.cube-mac';

// Runs exactly once (a flag guards re-entry), so a MAC the user later clears is
// not resurrected by a re-seed, and an existing `cube-mac` is never overwritten.
// Call early in app boot, before any cube connection.
export function runMigrations(): void {
  if (getRaw('migrated.cube-mac') === '1') return;
  const legacy = localStorage.getItem(LEGACY_MAC_KEY);
  if (legacy && getRaw('cube-mac') === null) {
    setRaw('cube-mac', legacy);
  }
  setRaw('migrated.cube-mac', '1');
}
