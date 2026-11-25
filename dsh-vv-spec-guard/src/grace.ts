/**
 * Follow-up #2 — GRACE → invariants: turn GRACE from documentation into a VERIFIED
 * system element. GRACE headers (foundation .agents/shared/grace-markup-spec.md) carry
 * machine-checkable contracts:
 *   - START_MODULE_MAP "MUST match the current exports of the file" → checkable.
 *   - START_INVARIANTS import-bans ("NEVER imports from domains/*") → checkable.
 *   -其余 invariants are behavioral guarantees → surfaced as required verification.
 *
 * This module parses GRACE, verifies the structural contracts against the actual code,
 * and classifies the rest so the pipeline can demand executable verification instead of
 * trusting prose. Host-side helper; pure text analysis (no I/O), so the caller supplies
 * the file text (and may supply TS-derived exports/imports for higher fidelity).
 */
import ts from 'typescript'

/**
 * Follow-up #2 (factual MODULE_MAP): extract the file's real public surface via the TS
 * checker — file-level exports PLUS public methods of exported classes (GRACE MODULE_MAP
 * lists the class public surface, not only file-level exports). This is the rock-solid
 * replacement for regex export detection. Requires a program built with module resolution
 * (census.createScopeProgram).
 */
export function tsPublicSurface(program: ts.Program, checker: ts.TypeChecker, filePath: string): string[] {
  const sourceFile = program.getSourceFile(filePath)
  if (!sourceFile) return []
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
  if (!moduleSymbol) return []
  const names = new Set<string>()
  const isPrivate = (decl: ts.Declaration): boolean =>
    (ts.getCombinedModifierFlags(decl) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !== 0
  for (const exp of checker.getExportsOfModule(moduleSymbol)) {
    names.add(exp.name)
    const resolved = (exp.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(exp) : exp
    const decl = resolved.valueDeclaration ?? resolved.declarations?.[0]
    if (!decl || !ts.isClassDeclaration(decl)) continue
    const collectMethods = (type: ts.Type): void => {
      for (const prop of type.getProperties()) {
        if (prop.name === 'constructor') continue
        const pd = prop.valueDeclaration ?? prop.declarations?.[0]
        if (!pd || isPrivate(pd)) continue
        if (ts.isMethodDeclaration(pd) || ts.isGetAccessorDeclaration(pd) || ts.isSetAccessorDeclaration(pd)) {
          names.add(prop.name)
        }
      }
    }
    collectMethods(checker.getDeclaredTypeOfSymbol(resolved))
    collectMethods(checker.getTypeOfSymbolAtLocation(resolved, decl))
  }
  return [...names].sort()
}

export interface GraceParse {
  purpose: string
  depends: string
  invariants: string[]
  moduleMap: string[]
}

export type InvariantClass = 'import-ban' | 'reference-ban' | 'behavioral'

export interface GraceCheckResult {
  hasGrace: boolean
  moduleMap: { declared: string[]; actual: string[]; missing: string[]; extra: string[] } | null
  importBanViolations: Array<{ invariant: string; pattern: string; matchingImports: string[] }>
  structuralInvariants: string[]
  behavioralInvariants: string[]
}

/** Strip leading comment markers / list dashes from a GRACE line. */
function cleanLine(line: string): string {
  return line.replace(/^\s*\/\/\s?/, '').replace(/^\s*[-*]\s+/, '').trim()
}

/** Extract the GRACE contract sections from a source file's text. */
export function parseGrace(text: string): GraceParse {
  const block = (name: string): string[] => {
    const re = new RegExp(`START_${name}([^\\n]*)\\n([\\s\\S]*?)END_${name}`, 'i')
    const m = re.exec(text)
    if (!m) return []
    return m[2].split('\n').map(cleanLine).filter((line) => line !== '')
  }
  const contract = /START_MODULE_CONTRACT([\s\S]*?)END_MODULE_CONTRACT/i.exec(text)
  const contractText = contract ? contract[1] : ''
  const field = (name: string): string => {
    const m = new RegExp(`${name}:\\s*([^\\n]*)`, 'i').exec(contractText)
    return m ? cleanLine(m[1]) : ''
  }
  const moduleMap = block('MODULE_MAP')
    .map((line) => {
      const m = /=>\s*([A-Za-z0-9_$]+)/.exec(line)
      return m ? m[1] : ''
    })
    .filter((name) => name !== '')
  return {
    purpose: field('PURPOSE'),
    depends: field('DEPENDS'),
    invariants: block('INVARIANTS'),
    moduleMap,
  }
}

/** Best-effort file-level export detection from source text (caller may override with
 * TS API for higher fidelity). NOTE: GRACE MODULE_MAP in practice also lists class public
 * methods, which are not file-level exports; moduleMap comparison is therefore informational
 * (file-level only) — full class-surface fidelity requires the TS API. The reliably verified
 * GRACE elements are the import-ban invariants and the at-risk behavioral invariant surface. */
export function detectExports(text: string): string[] {
  const names = new Set<string>()
  const decl = /export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|function|const|let|var|type|interface|enum)\s+([A-Za-z0-9_$]+)/g
  let m: RegExpExecArray | null
  while ((m = decl.exec(text)) !== null) names.add(m[1])
  const list = /export\s*\{([^}]+)\}/g
  while ((m = list.exec(text)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name && /^[A-Za-z0-9_$]+$/.test(name)) names.add(name)
    }
  }
  return [...names].sort()
}

/** Import specifiers from source text. */
export function detectImports(text: string): string[] {
  const specs = new Set<string>()
  const re = /import\s+(?:type\s+)?(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) specs.add(m[1])
  return [...specs].sort()
}

/** Classify an invariant line: import-ban / reference-ban (structural) vs behavioral. */
export function classifyInvariant(invariant: string): InvariantClass {
  if (/\b(never|must not|does not|no)\b[^.]*\bimport/i.test(invariant)) return 'import-ban'
  if (/\b(never|must not|does not|no)\b[^.]*\b(quer\w+|referenc\w+|touch\w*|read\w*|writ\w+)\b/i.test(invariant)) return 'reference-ban'
  return 'behavioral'
}

/** Glob → RegExp for import-ban patterns like "domains/*" or "@foundation/platform". */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

/**
 * Verify the structural GRACE contracts against the actual code and classify the rest.
 * actualExports/actualImports may be supplied from the TS API for higher fidelity;
 * otherwise they are detected from the text.
 */
export function checkGrace(
  text: string,
  actualExports?: string[],
  actualImports?: string[],
): GraceCheckResult {
  const grace = parseGrace(text)
  const hasGrace = grace.invariants.length > 0 || grace.moduleMap.length > 0 || grace.purpose !== ''
  const exports = actualExports ?? detectExports(text)
  const imports = actualImports ?? detectImports(text)

  let moduleMap: GraceCheckResult['moduleMap'] = null
  if (grace.moduleMap.length > 0) {
    const declared = [...new Set(grace.moduleMap)].sort()
    const actual = [...new Set(exports)].sort()
    const declaredSet = new Set(declared)
    const actualSet = new Set(actual)
    moduleMap = {
      declared,
      actual,
      missing: declared.filter((name) => !actualSet.has(name)),
      extra: actual.filter((name) => !declaredSet.has(name)),
    }
  }

  const importBanViolations: GraceCheckResult['importBanViolations'] = []
  const structuralInvariants: string[] = []
  const behavioralInvariants: string[] = []
  for (const invariant of grace.invariants) {
    const cls = classifyInvariant(invariant)
    if (cls === 'behavioral') {
      behavioralInvariants.push(invariant)
      continue
    }
    structuralInvariants.push(invariant)
    if (cls === 'import-ban') {
      const fromMatch = /\bfrom\s+([^\s;.,)]+)/i.exec(invariant)
      if (fromMatch) {
        const pattern = fromMatch[1].replace(/['"`]/g, '')
        const re = globToRegex(pattern)
        const matchingImports = imports.filter((spec) => re.test(spec))
        if (matchingImports.length > 0) {
          importBanViolations.push({ invariant, pattern, matchingImports })
        }
      }
    }
  }

  return { hasGrace, moduleMap, importBanViolations, structuralInvariants, behavioralInvariants }
}

/** Invariants that mention any of the changed symbols — the at-risk set for a change. */
export function atRiskInvariants(files: Array<{ path: string; text: string }>, changedSymbols: string[]): Array<{ path: string; invariant: string; class: InvariantClass }> {
  const lowered = changedSymbols.map((symbol) => symbol.toLowerCase())
  const out: Array<{ path: string; invariant: string; class: InvariantClass }> = []
  for (const file of files) {
    const grace = parseGrace(file.text)
    for (const invariant of grace.invariants) {
      const lower = invariant.toLowerCase()
      if (lowered.some((symbol) => symbol.length > 2 && lower.includes(symbol))) {
        out.push({ path: file.path, invariant, class: classifyInvariant(invariant) })
      }
    }
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* invariant → property-test: close the behavioral verification loop           */
/* -------------------------------------------------------------------------- */

export interface InvariantObligation {
  id: string
  invariant: string
  module: string
  class: InvariantClass
  /** import-ban is auto-checked; reference-ban/behavioral need an executable test. */
  checkType: 'import-ban-auto' | 'behavioral-test'
  scaffold: string | null
}

/**
 * A property-test scaffold for a behavioral invariant. This is an OBLIGATION + starting
 * point, NOT an auto-generated correct test: the natural-language guarantee must be turned
 * into an actual assertion by the agent/human. The scaffold is marked TODO and tracked in
 * the invariant-verification ledger; plan-close blocks on pending obligations, so a
 * behavioral invariant cannot be silently ignored.
 */
export function propertyTestScaffold(invariant: string, modulePath: string, id: string): string {
  const oneLine = invariant.replace(/\s+/g, ' ').trim()
  return [
    `import { describe, it } from 'vitest'`,
    `// GRACE invariant obligation ${id} — module: ${modulePath}`,
    `// Property: ${oneLine}`,
    `describe('GRACE invariant ${id}', () => {`,
    `  it.todo(${JSON.stringify(oneLine)})`,
    `  // TODO: discharge this obligation — Arrange (module/state), Act (exercise the`,
    `  // behavior), Assert (the guarantee holds). Then mark ${id} verified in`,
    `  // invariant-verification.xml with the test path + evidence.`,
    `})`,
    ``,
  ].join('\n')
}

/** Turn at-risk invariants into verification obligations (scaffolds for behavioral ones). */
export function invariantObligations(
  risky: Array<{ path: string; invariant: string; class: InvariantClass }>,
): InvariantObligation[] {
  return risky.map((item, index) => {
    const id = `IV-${String(index + 1).padStart(3, '0')}`
    const auto = item.class === 'import-ban'
    return {
      id,
      invariant: item.invariant,
      module: item.path,
      class: item.class,
      checkType: auto ? 'import-ban-auto' : 'behavioral-test',
      scaffold: auto ? null : propertyTestScaffold(item.invariant, item.path, id),
    }
  })
}

/** One invariant-verification ledger entry (invariant-verification.xml, unique-tag IV-NNN). */
export interface InvariantVerificationEntry {
  id: string
  invariant: string
  module: string
  testPath: string
  status: string
  evidence: string
}

/** Parse the invariant-verification ledger. */
export function parseInvariantVerification(text: string): InvariantVerificationEntry[] {
  const entries: InvariantVerificationEntry[] = []
  const re = /<(IV-\d+)>([\s\S]*?)<\/\1>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const body = m[2]
    const field = (name: string): string => {
      const fm = new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`).exec(body)
      return fm ? fm[1].trim() : ''
    }
    entries.push({
      id: m[1],
      invariant: field('invariant'),
      module: field('module'),
      testPath: field('test-path'),
      status: field('status'),
      evidence: field('evidence'),
    })
  }
  return entries
}

/** Discharged statuses; anything else is a pending obligation. */
export const INVARIANT_DISCHARGED = new Set(['verified', 'waived'])