// Theme selection + the Matrix "digital rain" canvas. Self-contained: depends
// only on storage and the DOM. `data-theme` on <html> drives the token blocks in
// style.css; the rain canvas is created/destroyed as the matrix theme toggles.

import * as store from './storage.ts';

const THEMES = ['dark', 'borland', 'matrix', 'future'];
export function getTheme(): string {
  return store.getEnum('theme', THEMES, 'borland');
}
export function setTheme(t: string) {
  store.setRaw('theme', t);
  applyTheme(t);
}
export function resolveTheme(t: string): string {
  return THEMES.includes(t) ? t : 'dark';
}
export function applyTheme(t: string) {
  // data-theme on <html> drives the token blocks in style.css.
  document.documentElement.dataset.theme = resolveTheme(t);
  ensureMatrixRain();
}

// --- Matrix theme: falling digital rain (lifecycle-managed canvas) ---
let rainRAF = 0;
let rainResize: (() => void) | null = null;
function ensureMatrixRain() {
  const on = resolveTheme(getTheme()) === 'matrix';
  const exists = !!document.getElementById('matrix-rain');
  if (on && !exists) startRain();
  else if (!on && exists) stopRain();
}
function startRain() {
  const canvas = document.createElement('canvas');
  canvas.id = 'matrix-rain';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const glyphs = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿ0123456789ABCDEF<>*+=:.';
  const fs = 16;
  let cols = 0;
  let drops: number[] = [];
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    cols = Math.ceil(canvas.width / fs);
    drops = Array.from({ length: cols }, () => Math.random() * -50);
  };
  resize();
  rainResize = resize;
  window.addEventListener('resize', resize);
  let last = 0;
  const frame = (t: number) => {
    rainRAF = requestAnimationFrame(frame);
    if (t - last < 55) return; // ~18fps, gentle on the CPU
    last = t;
    ctx.fillStyle = 'rgba(0,6,0,0.10)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${fs}px 'Share Tech Mono', monospace`;
    for (let i = 0; i < cols; i++) {
      const y = drops[i] * fs;
      ctx.fillStyle = Math.random() < 0.03 ? '#c6ffd6' : '#00ff66';
      ctx.fillText(glyphs[Math.floor(Math.random() * glyphs.length)], i * fs, y);
      if (y > canvas.height && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    }
  };
  rainRAF = requestAnimationFrame(frame);
}
function stopRain() {
  if (rainRAF) cancelAnimationFrame(rainRAF);
  rainRAF = 0;
  if (rainResize) { window.removeEventListener('resize', rainResize); rainResize = null; }
  document.getElementById('matrix-rain')?.remove();
}
