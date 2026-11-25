// Follow-up #3 — FULL-ARCHIVE calibration. Replays the foundation archive to measure the
// real cascade rate of destructive changes (the CURRICULUM question) and validate the
// cross-scope gate against outcomes, not guesses. Archived plans are legacy (no structured
// deletes), so per-package historical fan-out is not reconstructable; instead we label
// OUTCOMES (did a destructive change spawn reactive follow-ups?) — the cascade signal the
// gate exists to prevent. Run: node calibrate-archive.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ARCHIVE = '/Users/alex_quidditch/projects/foundation/.vvoc/specs/archive'
const DESTRUCTIVE = /\b(teardown|torn[- ]down|hardcut|hard cut|remove the|removal of|replace the|replaces the|delete the|deletion of|extract the|sunset|retire)\b/i
const REACTIVE = /\b(restoration|restore|follow[- ]up|fix(es|ed)?|repair|close the gap|closing|rework|revert|patch|hotfix|regression|defect)\b/i

function goalOf(dir) {
  const spec = join(ARCHIVE, dir, 'spec.xml')
  if (!existsSync(spec)) return ''
  const text = readFileSync(spec, 'utf8')
  const m = /<goal>([\s\S]*?)<\/goal>/i.exec(text)
  return m ? m[1].replace(/\s+/g, ' ').trim() : ''
}
function slugTokens(dir) {
  return dir.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-\d{8,}.*$/, '').split(/[-_]/).filter(t => t.length > 3)
}

const dirs = readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}-/.test(d)).sort()
const packages = dirs.map(dir => {
  const goal = goalOf(dir)
  const date = dir.slice(0, 10)
  return { dir, date, goal, tokens: slugTokens(dir), destructive: DESTRUCTIVE.test(goal), reactive: REACTIVE.test(goal) }
})

// Cascade detection: a destructive package is "cascaded" if a LATER reactive package
// shares a significant slug token (same area) — the teardown→restoration pattern.
const STOP = new Set(['platform', 'domain', 'education', 'frontend', 'backend', 'module', 'assembly', 'entity', 'contract', 'contracts', 'schemas', 'feature', 'features'])
for (const p of packages) {
  p.followUps = []
  if (!p.destructive) continue
  const sig = p.tokens.filter(t => !STOP.has(t))
  for (const q of packages) {
    if (q.date <= p.date || !q.reactive) continue
    const shared = q.tokens.filter(t => sig.includes(t) && !STOP.has(t))
    if (shared.length > 0) p.followUps.push({ dir: q.dir, shared })
  }
}

const destructive = packages.filter(p => p.destructive)
const cascaded = destructive.filter(p => p.followUps.length > 0)
const reactive = packages.filter(p => p.reactive)

console.log(`FULL-ARCHIVE CALIBRATION — ${packages.length} packages\n`)
console.log(`destructive (removal/teardown/replace/extract): ${destructive.length}`)
console.log(`reactive (fix/restoration/follow-up/repair):    ${reactive.length}`)
console.log(`destructive that spawned reactive follow-ups:   ${cascaded.length} / ${destructive.length}  (${destructive.length ? Math.round(100 * cascaded.length / destructive.length) : 0}% cascade rate)\n`)

console.log('Cascade chains (destructive → reactive follow-ups):')
for (const p of cascaded.slice(0, 20)) {
  console.log(`  ${p.date} ${p.dir.replace(/^\d{4}-\d{2}-\d{2}-/, '').slice(0, 44)}`)
  for (const f of p.followUps.slice(0, 3)) console.log(`      → ${f.dir.replace(/^\d{4}-\d{2}-\d{2}-/, '').slice(0, 48)} [${f.shared.join(',')}]`)
}

console.log('\nInterpretation:')
console.log(`  ${cascaded.length}/${destructive.length} destructive changes spawned reactive follow-ups — the cascade the`)
console.log('  cross-scope gate exists to prevent. The CURRICULUM schools teardown is the canonical')
console.log('  case (fan-out 10 scopes, 13-package restoration). A mandatory consequence-inventory +')
console.log('  decomposition gate at spec time would force these follow-ups into the PLAN, not the aftermath.')
console.log('\nHonest limit: outcome labels are inferred from goal keywords + slug overlap, not a')
console.log('  hand-labeled ground truth; historical per-package fan-out is not reconstructable from')
console.log('  legacy plans. This calibrates the cascade RATE and the gate\'s target population, and')
console.log('  produces the cascade-chain dataset that feeds design heuristics (follow-up #4).')