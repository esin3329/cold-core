import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { renameSync, existsSync } from 'node:fs';
export default defineConfig({
  base: './',
  plugins: [
    viteSingleFile(),
    {
      name: 'rename-single',
      closeBundle() {
        const src = 'dist-single/index.html';
        if (existsSync(src)) renameSync(src, 'dist-single/cold-core-prototype.html');
      },
    },
  ],
  build: { outDir: 'dist-single', emptyOutDir: true },
});
