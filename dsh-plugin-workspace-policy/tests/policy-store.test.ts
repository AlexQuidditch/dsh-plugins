/**
 * Policy-store tests: load, hot reload, last-good, deletion, and watcher
 * upgrade when `.dsh` appears after the first load (spec §4.1, §4.8, §5.7–5.8).
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { WorkspacePolicyStore } from '../src/policy-store.ts'

let root: string
let store: WorkspacePolicyStore
const warnings: string[] = []
const infos: string[] = []

const VALID = [
  'model:',
  '  default:',
  '    provider: zai',
  '    model: glm-5.3',
  '    reasoningEffort: max',
].join('\n')

const VALID_OTHER = [
  'model:',
  '  default:',
  '    provider: other',
  '    model: other-model',
].join('\n')

function newStore(configFileName = '.dsh/workspace.yaml'): WorkspacePolicyStore {
  return new WorkspacePolicyStore({
    configFileName,
    watchEnabled: true,
    debounceMs: 30,
    logger: {
      info: (_message: string, ..._args: unknown[]) => {
        infos.push(_message)
      },
      warn: (message: string, ..._args: unknown[]) => {
        warnings.push(message)
      },
    },
  })
}

async function waitFor(probe: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (probe()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('condition not reached in time')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wspolicy-'))
  warnings.length = 0
  infos.length = 0
})

afterEach(async () => {
  store?.dispose()
  await rm(root, { recursive: true, force: true })
})

describe('WorkspacePolicyStore', () => {
  it('reports a missing file as policy-free', async () => {
    store = newStore()
    const slot = await store.load(root)
    expect(slot.status).toBe('missing')
    expect(slot.policy).toBeNull()
    expect(warnings).toEqual([])
  })

  it('loads a valid policy', async () => {
    await mkdir(join(root, '.dsh'), { recursive: true })
    await writeFile(join(root, '.dsh/workspace.yaml'), VALID, 'utf8')
    store = newStore()
    const slot = await store.load(root)
    expect(slot.status).toBe('loaded')
    expect(slot.policy?.model.default).toEqual({ provider: 'zai', model: 'glm-5.3', reasoningEffort: 'max' })
  })

  it('hot-reloads on change after the debounce', async () => {
    await mkdir(join(root, '.dsh'), { recursive: true })
    const file = join(root, '.dsh/workspace.yaml')
    await writeFile(file, VALID, 'utf8')
    store = newStore()
    await store.load(root)
    await writeFile(file, VALID_OTHER, 'utf8')
    await waitFor(() => store.peek(root)?.policy?.model.default?.provider === 'other')
    expect(store.peek(root)?.status).toBe('loaded')
  })

  it('keeps the last good policy through a broken edit', async () => {
    await mkdir(join(root, '.dsh'), { recursive: true })
    const file = join(root, '.dsh/workspace.yaml')
    await writeFile(file, VALID, 'utf8')
    store = newStore()
    await store.load(root)
    await writeFile(file, 'model: [broken', 'utf8')
    await waitFor(() => store.peek(root)?.status === 'invalid')
    const slot = store.peek(root)
    expect(slot?.policy?.model.default?.provider).toBe('zai')
    expect(slot?.problem).toContain('YAML parse error')
    expect(warnings.length).toBe(1)
  })

  it('recovers when the file becomes valid again', async () => {
    await mkdir(join(root, '.dsh'), { recursive: true })
    const file = join(root, '.dsh/workspace.yaml')
    await writeFile(file, 'model: [broken', 'utf8')
    store = newStore()
    await store.load(root)
    expect(store.peek(root)?.status).toBe('invalid')
    await writeFile(file, VALID, 'utf8')
    await waitFor(() => store.peek(root)?.status === 'loaded')
    expect(store.peek(root)?.policy?.model.default?.provider).toBe('zai')
  })

  it('becomes policy-free when the file is deleted', async () => {
    await mkdir(join(root, '.dsh'), { recursive: true })
    const file = join(root, '.dsh/workspace.yaml')
    await writeFile(file, VALID, 'utf8')
    store = newStore()
    await store.load(root)
    await rm(file)
    await waitFor(() => store.peek(root)?.status === 'missing')
    expect(store.peek(root)?.policy).toBeNull()
  })

  it('picks up a policy file created in a .dsh directory that appears later', async () => {
    store = newStore()
    await store.load(root)
    expect(store.peek(root)?.status).toBe('missing')
    await mkdir(join(root, '.dsh'), { recursive: true })
    await writeFile(join(root, '.dsh/workspace.yaml'), VALID, 'utf8')
    await waitFor(() => store.peek(root)?.status === 'loaded')
    expect(store.peek(root)?.policy?.model.default?.provider).toBe('zai')
  })

  it('supports a custom config file name directly in the root', async () => {
    await writeFile(join(root, 'policy.yaml'), VALID, 'utf8')
    store = newStore('policy.yaml')
    const slot = await store.load(root)
    expect(slot.status).toBe('loaded')
    await writeFile(join(root, 'policy.yaml'), VALID_OTHER, 'utf8')
    await waitFor(() => store.peek(root)?.policy?.model.default?.provider === 'other')
  })

  it('stops reloading after dispose', async () => {
    await mkdir(join(root, '.dsh'), { recursive: true })
    const file = join(root, '.dsh/workspace.yaml')
    await writeFile(file, VALID, 'utf8')
    store = newStore()
    await store.load(root)
    store.dispose()
    expect(store.alive).toBe(false)
    await writeFile(file, VALID_OTHER, 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 200))
    const slot = await store.load(root)
    expect(slot.status).toBe('unloaded')
    expect(slot.policy).toBeNull()
  })
})
