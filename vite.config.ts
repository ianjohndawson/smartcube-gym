import { defineConfig } from 'vite';

// Local dev serves from '/', production build serves from '/petrus-trainer/'
// to match GitHub Pages at https://ianjohndawson.github.io/petrus-trainer/.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/petrus-trainer/' : '/',
  server: {
    host: true, // expose on LAN so the iPad/Bluefy browser can reach the dev server
  },
  build: {
    target: 'es2020',
  },
}));
