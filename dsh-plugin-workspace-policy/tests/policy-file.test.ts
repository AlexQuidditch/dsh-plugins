/**
 * Policy-file parsing tests (spec §7.1 config rows).
 */
import { describe, expect, it } from 'vitest'

import { parsePolicyFile } from '../src/policy-file.ts'

describe('parsePolicyFile', () => {
  it('treats an empty document as inert without any problem', () => {
    const result = parsePolicyFile('')
    expect(result.policy).toBeNull()
    expect(result.problem).toBeNull()
    expect(result.notes).toEqual([])
  })

  it('treats a whitespace/comment-only document as inert without any problem', () => {
    const result = parsePolicyFile('# nothing to see\n\n---\n')
    expect(result.policy).toBeNull()
    expect(result.problem).toBeNull()
  })

  it('parses a complete policy', () => {
    const result = parsePolicyFile(`
model:
  default:
    provider: zai
    model: glm-5.3
    reasoningEffort: max
  workers:
    provider: deepseek-official
    model: deepseek-flash
  fallback:
    - provider: deepseek-official
      model: deepseek-flash
budget:
  maxReasoningEffort: high
`)
    expect(result.problem).toBeNull()
    expect(result.policy).toEqual({
      model: {
        default: { provider: 'zai', model: 'glm-5.3', reasoningEffort: 'max' },
        workers: { provider: 'deepseek-official', model: 'deepseek-flash' },
        fallback: [{ provider: 'deepseek-official', model: 'deepseek-flash' }],
      },
      budget: { maxReasoningEffort: 'high' },
    })
  })

  it('reports broken YAML with a problem', () => {
    const result = parsePolicyFile('model: [unclosed')
    expect(result.policy).toBeNull()
    expect(result.problem).toContain('YAML parse error')
  })

  it('reports shape problems with the offending path', () => {
    const result = parsePolicyFile('model:\n  default:\n    provider: zai\n')
    expect(result.policy).toBeNull()
    expect(result.problem).toContain('model.default')
  })

  it('reports a non-mapping model section', () => {
    const result = parsePolicyFile('model: [1, 2]')
    expect(result.problem).toContain('"model" must be a mapping')
  })

  it('reports a non-list fallback', () => {
    const result = parsePolicyFile('model:\n  fallback: deepseek-flash')
    expect(result.problem).toContain('model.fallback must be a list')
  })

  it('reports a non-string budget ceiling', () => {
    const result = parsePolicyFile('budget:\n  maxReasoningEffort: 3')
    expect(result.problem).toContain('budget.maxReasoningEffort')
  })

  it('notes unknown keys instead of failing', () => {
    const result = parsePolicyFile(`
version: 1
model:
  default:
    provider: zai
    model: glm-5.3
    turbo: yes
`)
    expect(result.problem).toBeNull()
    expect(result.policy).not.toBeNull()
    expect(result.notes.join(' ')).toContain('version')
    expect(result.notes.join(' ')).toContain('turbo')
  })

  it('treats a document with no routes as inert without a problem', () => {
    const result = parsePolicyFile('budget:\n  maxReasoningEffort: high\n')
    expect(result.policy).toBeNull()
    expect(result.problem).toBeNull()
  })
})
