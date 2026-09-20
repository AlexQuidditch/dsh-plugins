/**
 * Parsing and shape validation of `.dsh/workspace.yaml` documents.
 *
 * The policy file is DATA, not plugin-row config: it is read by the
 * workspace-policy store at runtime, so validation happens here with precise
 * diagnostics instead of the Cordis loader. A broken file must never throw
 * out of this module — the result carries the problem as a string, and the
 * caller keeps the last good policy.
 */

import yaml from 'js-yaml'

import type { PolicyBudgetSection, PolicyModelSection, PolicyRoute, WorkspacePolicy } from './types.ts'

/** Outcome of parsing one policy document. */
export interface ParsedPolicyFile {
  /** Validated policy, or `null` when the document holds no actionable content. */
  policy: WorkspacePolicy | null
  /** Human-readable problem (path is prefixed by the caller); `null` when fine. */
  problem: string | null
  /** Non-fatal shape notes (unknown keys) the caller may log once per load. */
  notes: string[]
}

interface RouteInput {
  provider?: unknown
  model?: unknown
  reasoningEffort?: unknown
}

/** Validate one route mapping into a {@link PolicyRoute}, or describe the problem. */
function readRoute(value: unknown, where: string, problems: string[], notes: string[]): PolicyRoute | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    problems.push(`${where} must be a mapping with "provider" and "model"`)
    return undefined
  }
  const input = value as RouteInput
  for (const key of Object.keys(value)) {
    if (key !== 'provider' && key !== 'model' && key !== 'reasoningEffort') {
      notes.push(`${where}: unknown key "${key}" ignored`)
    }
  }
  const provider = typeof input.provider === 'string' ? input.provider.trim() : ''
  const model = typeof input.model === 'string' ? input.model.trim() : ''
  if (provider.length === 0 || model.length === 0) {
    problems.push(`${where} needs non-empty string "provider" and "model"`)
    return undefined
  }
  const route: PolicyRoute = { provider, model }
  const effort = typeof input.reasoningEffort === 'string' ? input.reasoningEffort.trim() : ''
  if (effort.length > 0) route.reasoningEffort = effort
  else if (input.reasoningEffort !== undefined && input.reasoningEffort !== null) {
    notes.push(`${where}: "reasoningEffort" must be a non-empty string when present; ignored`)
  }
  return route
}

/**
 * Parse and validate one workspace policy document. Never throws: YAML
 * errors, shape problems, and unknown keys are reported through the result.
 * An empty document (or one with no actionable route) parses to `null`
 * policy with no problem — the plugin is simply inert for that workspace.
 */
export function parsePolicyFile(text: string): ParsedPolicyFile {
  const notes: string[] = []
  let document: unknown
  try {
    document = yaml.load(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { policy: null, problem: `YAML parse error: ${message}`, notes }
  }
  if (document === undefined || document === null) {
    return { policy: null, problem: null, notes }
  }
  if (typeof document !== 'object' || Array.isArray(document)) {
    return { policy: null, problem: 'document must be a mapping with optional "model" and "budget" sections', notes }
  }
  const root = document as Record<string, unknown>
  for (const key of Object.keys(root)) {
    if (key !== 'model' && key !== 'budget') notes.push(`unknown top-level key "${key}" ignored`)
  }

  const problems: string[] = []
  const modelSection: PolicyModelSection = {}
  const budgetSection: PolicyBudgetSection = {}

  const modelValue = root['model']
  if (modelValue !== undefined) {
    if (modelValue === null || typeof modelValue !== 'object' || Array.isArray(modelValue)) {
      problems.push('"model" must be a mapping')
    } else {
      for (const key of Object.keys(modelValue)) {
        if (key !== 'default' && key !== 'workers' && key !== 'fallback') {
          notes.push(`model: unknown key "${key}" ignored`)
        }
      }
      const asModel = modelValue as Record<string, unknown>
      if (asModel['default'] !== undefined) {
        const defaultRoute = readRoute(asModel['default'], 'model.default', problems, notes)
        if (defaultRoute !== undefined) modelSection.default = defaultRoute
      }
      if (asModel['workers'] !== undefined) {
        const workersRoute = readRoute(asModel['workers'], 'model.workers', problems, notes)
        if (workersRoute !== undefined) modelSection.workers = workersRoute
      }
      const fallbackValue = asModel['fallback']
      if (fallbackValue !== undefined) {
        if (!Array.isArray(fallbackValue)) {
          problems.push('model.fallback must be a list of routes')
        } else {
          const chain: PolicyRoute[] = []
          fallbackValue.forEach((entry, index) => {
            const route = readRoute(entry, `model.fallback[${index}]`, problems, notes)
            if (route !== undefined) chain.push(route)
          })
          if (chain.length > 0) modelSection.fallback = chain
        }
      }
    }
  }

  const budgetValue = root['budget']
  if (budgetValue !== undefined) {
    if (budgetValue === null || typeof budgetValue !== 'object' || Array.isArray(budgetValue)) {
      problems.push('"budget" must be a mapping')
    } else {
      for (const key of Object.keys(budgetValue)) {
        if (key !== 'maxReasoningEffort') notes.push(`budget: unknown key "${key}" ignored`)
      }
      const ceiling = (budgetValue as Record<string, unknown>)['maxReasoningEffort']
      if (ceiling === undefined || ceiling === null) {
        // absent ceiling is fine
      } else if (typeof ceiling === 'string' && ceiling.trim().length > 0) {
        budgetSection.maxReasoningEffort = ceiling.trim()
      } else {
        problems.push('budget.maxReasoningEffort must be a non-empty string when present')
      }
    }
  }

  if (problems.length > 0) {
    return { policy: null, problem: problems.join('; '), notes }
  }

  const policy: WorkspacePolicy = { model: modelSection, budget: budgetSection }
  const hasRoutes = modelSection.default !== undefined
    || modelSection.workers !== undefined
    || (modelSection.fallback?.length ?? 0) > 0
  if (!hasRoutes) return { policy: null, problem: null, notes }
  return { policy, problem: null, notes }
}
