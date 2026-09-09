/**
 * vvoc lint engine.
 *
 * Preferred path: reuse the built dsh-vv-spec-guard engine (single source of
 * truth for the format contract). When that package is not built or
 * unavailable, fall back to a compact internal implementation with the same
 * verdict shape — the CLI must stay usable standalone.
 */
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface LintFinding {
  rule: string
  message: string
}

export interface LintVerdict {
  errors: LintFinding[]
  warnings: LintFinding[]
}

interface XmlNode {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  text?: string
}

/** Minimal structural parser shared with the fallback engine. */
export function parseXmlLite(text: string): XmlNode {
  const TAG_RE = /<(\/?)([A-Za-z0-9_.-]+)((?:[^<>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
  const stack: XmlNode[] = []
  let root: XmlNode | undefined
  const clean = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')

  let lastEnd = 0
  for (const match of clean.matchAll(TAG_RE)) {
    const index = match.index
    const plain = clean.slice(lastEnd, index).trim()
    if (plain !== '' && stack.length > 0) {
      const top = stack[stack.length - 1]
      top.text = top.text === undefined ? plain : `${top.text} ${plain}`
    }
    lastEnd = index + match[0].length

    const closing = match[1] === '/'
    const name = match[2]
    const rawAttrs = match[3]
    const selfClosing = match[4] === '/'

    if (!closing) {
      const attrs: Record<string, string> = {}
      for (const attrMatch of rawAttrs.matchAll(/([A-Za-z0-9_.-]+)\s*=\s*"([^"]*)"/g)) attrs[attrMatch[1]] = attrMatch[2]
      const node: XmlNode = { name, attrs, children: [] }
      if (stack.length === 0) {
        if (root !== undefined) throw new Error('malformed XML: multiple root elements')
        root = node
      } else {
        stack[stack.length - 1].children.push(node)
      }
      if (!selfClosing) stack.push(node)
      continue
    }
    if (stack.length === 0) throw new Error(`malformed XML: closing </${name}> without an open tag`)
    const top = stack[stack.length - 1]
    if (top.name !== name) throw new Error(`malformed XML: </${name}> closes <${top.name}>`)
    stack.pop()
  }
  if (stack.length > 0) throw new Error(`malformed XML: unclosed <${stack[stack.length - 1].name}>`)
  if (root === undefined) throw new Error('malformed XML: no root element')
  return root
}

function collect(node: XmlNode, re: RegExp): XmlNode[] {
  const found: XmlNode[] = []
  for (const child of node.children) {
    if (re.test(child.name)) found.push(child)
    found.push(...collect(child, re))
  }
  return found
}

function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => child.name === name)
}

function countDescendants(node: XmlNode, path: string[]): number {
  let current: XmlNode[] = [node]
  for (const step of path) {
    current = current.flatMap((item) => childrenNamed(item, step))
  }
  return current.length
}

const STATUSES = new Set(['draft', 'approved', 'applied'])

/** The fallback engine: structure, statuses, identities, references, cycles. */
export function lintXml(text: string, kind: 'spec' | 'plan', options: { status?: string; specText?: string } = {}): LintVerdict {
  const verdict: LintVerdict = { errors: [], warnings: [] }
  let root: XmlNode
  try {
    root = parseXmlLite(text)
  } catch (error) {
    verdict.errors.push({ rule: 'well-formed', message: `malformed XML: ${error instanceof Error ? error.message : String(error)}` })
    return verdict
  }

  if (root.name !== kind) verdict.errors.push({ rule: 'root', message: `root element must be <${kind}>, found <${root.name}>` })
  if (typeof root.attrs.package !== 'string' || root.attrs.package.trim() === '') {
    verdict.errors.push({ rule: 'package', message: `<${kind}> requires a non-empty package attribute` })
  }
  const status = options.status ?? root.attrs.status ?? 'draft'
  if (!STATUSES.has(status)) verdict.errors.push({ rule: 'status', message: `status must be draft|approved|applied, found "${status}"` })

  const components = collect(root, /^COMPONENT-[A-Z][A-Z0-9-]*$/)
  const seen = new Set<string>()
  for (const component of components) {
    if (seen.has(component.name)) verdict.errors.push({ rule: 'identity', message: `duplicate component identity <${component.name}>` })
    seen.add(component.name)
  }

  if (status !== 'draft' && kind === 'spec') {
    if (countDescendants(root, ['goals', 'goal']) === 0) verdict.errors.push({ rule: 'completeness', message: 'approved/applied spec must have at least one <goal>' })
    if (countDescendants(root, ['requirements', 'requirement']) === 0) verdict.errors.push({ rule: 'completeness', message: 'approved/applied spec must have at least one <requirement>' })
    if (countDescendants(root, ['acceptance', 'criterion']) === 0) verdict.errors.push({ rule: 'completeness', message: 'approved/applied spec must have at least one <criterion>' })
  }

  if (kind === 'plan') {
    const tasks = collect(root, /^TASK-T-\d{3}$/)
    const taskIds = new Set<string>()
    if (status !== 'draft' && tasks.length === 0) verdict.errors.push({ rule: 'completeness', message: 'approved/applied plan must have at least one task' })
    for (const task of tasks) {
      if (taskIds.has(task.name)) verdict.errors.push({ rule: 'identity', message: `duplicate task identity <${task.name}>` })
      taskIds.add(task.name)
      if (status !== 'draft') {
        if (countDescendants(task, ['title']) === 0) verdict.errors.push({ rule: 'completeness', message: `<${task.name}> has no <title>` })
        if (countDescendants(task, ['acceptance', 'criterion']) === 0) verdict.errors.push({ rule: 'completeness', message: `<${task.name}> has no acceptance <criterion>` })
        if (countDescendants(task, ['verify', 'command']) === 0) verdict.errors.push({ rule: 'completeness', message: `<${task.name}> has no <verify>/<command>` })
      }
    }
    const refsOf = (node: XmlNode): string[] => childrenNamed(node, 'task_id').map((ref) => (ref.text ?? '').trim()).filter((id) => id !== '')
    for (const wave of collect(root, /^WAVE-\d+$/)) {
      for (const ref of refsOf(wave)) {
        if (!taskIds.has(ref)) verdict.errors.push({ rule: 'reference', message: `<${wave.name}> references unknown task "${ref}"` })
      }
    }
    for (const depends of collect(root, /^depends_on$/)) {
      for (const ref of refsOf(depends)) {
        if (!taskIds.has(ref)) verdict.errors.push({ rule: 'reference', message: `depends_on references unknown task "${ref}"` })
      }
    }
    // Cycle detection.
    const edges = new Map<string, string[]>()
    for (const task of tasks) {
      const deps: string[] = []
      for (const depends of childrenNamed(task, 'depends_on')) deps.push(...refsOf(depends))
      edges.set(task.name, deps)
    }
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (id: string): string[] | undefined => {
      if (visiting.has(id)) return [id]
      if (visited.has(id)) return undefined
      visiting.add(id)
      for (const dep of edges.get(id) ?? []) {
        if (!taskIds.has(dep)) continue
        const cycle = visit(dep)
        if (cycle !== undefined) return [id, ...cycle]
      }
      visiting.delete(id)
      visited.add(id)
      return undefined
    }
    for (const id of edges.keys()) {
      const cycle = visit(id)
      if (cycle !== undefined) {
        verdict.errors.push({ rule: 'dependency', message: `dependency cycle: ${cycle.join(' -> ')}` })
        break
      }
    }
    const planSet = new Set(components.map((component) => component.name))
    if (planSet.size > 0) {
      if (options.specText !== undefined) {
        try {
          const spec = parseXmlLite(options.specText)
          const specSet = new Set(collect(spec, /^COMPONENT-[A-Z][A-Z0-9-]*$/).map((component) => component.name))
          for (const component of planSet) {
            if (!specSet.has(component)) verdict.errors.push({ rule: 'spec-subset', message: `plan component <${component}> has no matching spec component` })
          }
        } catch {
          verdict.warnings.push({ rule: 'spec-subset', message: 'spec text provided but unparsable; component-subset check skipped' })
        }
      } else {
        verdict.warnings.push({ rule: 'spec-subset', message: 'spec text not provided; component-subset check skipped' })
      }
    }
  }
  return verdict
}

/** Engine type: sync or async verdict, uniform for callers via `await`. */
export type LintEngine = (text: string, kind: 'spec' | 'plan', options?: { status?: string; specText?: string }) => LintVerdict | Promise<LintVerdict>

/** Engine selection: the built sibling package wins when present. */
export async function resolveEngine(): Promise<LintEngine> {
  const here = dirname(fileURLToPath(import.meta.url))
  const sibling = resolve(here, '..', '..', 'dsh-vv-spec-guard', 'lib', 'index.js')
  if (existsSync(sibling)) {
    try {
      const engine = await import(sibling)
      if (typeof engine.lintSpec === 'function' && typeof engine.lintPlan === 'function') {
        return (text, kind, options = {}) => kind === 'spec' ? engine.lintSpec(text, options) : engine.lintPlan(text, options)
      }
    } catch {
      // fall through to the internal engine
    }
  }
  return async (text, kind, options) => lintXml(text, kind, options)
}
