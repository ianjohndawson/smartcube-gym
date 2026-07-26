// Theme selection. Self-contained: depends only on storage and the DOM.
// `data-theme` on <html> drives the token blocks in style.css.
//
// TWO selectable skins. The old 'dark' skin was demoted to the BASE token layer
// (the bare `:root` block in style.css) that both skins override — it defines the
// defaults, so something has to, but it is no longer a choice. It is deliberately
// NOT in THEMES: that keeps `data-theme` always one of the two real skins, so a
// stored 'dark' (or 'matrix') validates back to the default instead of leaving the
// picker with nothing selected.

import * as store from './storage.ts';

const THEMES = ['borland', 'future'];
export function getTheme(): string {
  return store.getEnum('theme', THEMES, 'borland');
}
export function setTheme(t: string) {
  store.setRaw('theme', t);
  applyTheme(t);
}
export function resolveTheme(t: string): string {
  return THEMES.includes(t) ? t : 'borland';
}
export function applyTheme(t: string) {
  // data-theme on <html> drives the token blocks in style.css.
  document.documentElement.dataset.theme = resolveTheme(t);
}
