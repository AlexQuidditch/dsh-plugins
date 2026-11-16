/**
 * End-to-end: drive the rebuilt spec_guard_lint over REAL files, with an fs
 * service that mirrors the 0.2.2 LocalFileSystem semantics exactly —
 * `resolve(path, { cwd })` → { targetKey: realpath(abs), displayPath } and
 * `readText(target)` → the target key's bytes.
 *
 * This is the shape that failed in live vv sessions: a workspace-relative
 * path passed straight through as `{ targetKey: path }` surfaced as
 * `cannot read "undefined": not found`.
 */
import { readFile, realpath } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'

const CORDIS = process.env.CORDIS_LIB ?? new URL('./node_modules/@deepseek-ai/cordis', import.meta.url).pathname
const { Context, Service } = await import(`file://${CORDIS}/lib/index.js`)
const plugin = await import(`file://${process.cwd()}/lib/index.js`)

class RealFs extends Service {
  constructor(ctx) {
    super(ctx, 'fs')
  }
  async resolve(path, opts = {}) {
    const absolute = resolvePath(typeof opts.cwd === 'string' ? opts.cwd : process.cwd(), path)
    return { targetKey: await realpath(absolute), displayPath: absolute }
  }
  async readText(target) {
    return readFile(String(target.targetKey), 'utf8')
  }
}

class StubTools extends Service {
  constructor(ctx) {
    super(ctx, 'tools')
    this.defs = []
  }
  register(definition) {
    this.defs.push(definition)
    return () => {}
  }
}

const ctx = new Context()
await ctx.plugin(RealFs)
await ctx.plugin(StubTools)
await ctx.plugin(plugin, { probeTool: true })

const probe = ctx.tools.defs.find((d) => d.name === 'spec_guard_lint')
if (!probe) throw new Error('spec_guard_lint not registered')

const FOUNDATION = '/Users/alex_quidditch/projects/foundation'
const exec = { agent: { session: { header: { cwd: FOUNDATION } } }, signal: new AbortController().signal }

let failures = 0
for (const [relative, expectation] of [
  ['.vvoc/specs/archive/2026-11-04-schools-instructor-subject-scopes-20261105T1719/', 'both'],
  ['.vvoc/specs/2026-11-07-schools-widget-unification/', 'spec-at-least'],
  ['.vvoc/specs/2026-11-07-schools-widget-unification/spec.xml', 'single'],
]) {
  const out = await probe.execute({ path: relative }, exec)
  console.log(`=== ${relative}`)
  console.log(out)
  console.log()
  // An in-progress package may legitimately lack plan.xml; a failing input is
  // one whose spec.xml itself did not resolve or lint. Since §K an approved
  // spec without an approvals.json sidecar also reports a warning, so match the
  // stable prefix instead of requiring the line to end with "0 errors".
  const specLine = out.split('\n').find((line) => line.includes('/spec.xml: [spec-guard] 0 errors'))
  if (expectation === 'both' && out.includes('unreadable')) failures += 1
  if (specLine === undefined) failures += 1
}

await ctx.fiber.dispose()
if (failures > 0) {
  console.log(`E2E FAILED: ${failures} input(s) unresolved`)
  process.exit(1)
}
console.log('E2E OK: relative paths resolve against the session cwd and read real files')
