import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node20',
  // No public type consumers: the cordis loader imports lib/index.js at
  // runtime, and a bundled d.ts would drag non-portable schemastery paths.
  dts: false,
  outDir: 'lib',
  clean: true,
  outExtensions: () => ({ js: '.js' }),
})
