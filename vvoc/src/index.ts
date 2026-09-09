/**
 * vvoc library entry: every command module re-exported for tests and future
 * consumers. The CLI itself lives in ./bin.ts.
 */
export * from './analytics.js'
export * from './install.js'
export * from './lint.js'
export * from './paths.js'
export * from './roles.js'
export { main } from './bin.js'
