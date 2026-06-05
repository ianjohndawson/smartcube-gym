import { defineConfig } from 'vite';

// Local dev serves from '/', production build serves from '/smartcube-gym/'
// to match GitHub Pages at https://ianjohndawson.github.io/smartcube-gym/.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/smartcube-gym/' : '/',
  server: {
    host: true, // expose on LAN so the iPad/Bluefy browser can reach the dev server
  },
  build: {
    target: 'es2020',
  },
}));
