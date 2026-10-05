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
  // The loader imports this file from the linked package directory, so bare
  // dependencies are not resolved from the profile's node_modules.
  deps: {
    alwaysBundle: ['schemastery', 'js-yaml'],
  },
})
