// Builds the leaderboard widget on its own, as one small file (dist/embed.js) that works from a plain <script> tag.
// It runs after the main build (see "build" in package.json), so it leaves the rest of dist alone.
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: { entry: 'src/embed/embed.ts', formats: ['iife'], name: 'BetaBlastEmbed', fileName: () => 'embed.js' },
  },
});
