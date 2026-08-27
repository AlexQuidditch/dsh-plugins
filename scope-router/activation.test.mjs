/**
 * Изолированный тест активации host-половины dsh-scope-router (после сборки).
 *
 * Не трогает живой DSH: создаёт корневой Context cordis, монтирует
 * минимальные стабы сервисов `fs` и `tools`, монтирует собранный плагин из
 * lib/index.js и проверяет, что apply не падает, пробный тул регистрируется,
 * и dispose проходит чисто.
 *
 * Запуск: node activation.test.mjs   (после pnpm run build)
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import * as plugin from './lib/index.js'

const work = mkdtempSync(join(tmpdir(), 'scope-router-test-'))
try {
  // Фикстурный «проект»: ядро + домен toprep.
  writeFileSync(join(work, 'AGENTS.md'), '# core\n')
  const domainDir = join(work, 'packages', 'domains', 'toprep')
  mkdirSync(domainDir, { recursive: true })
  writeFileSync(join(domainDir, 'AGENTS.md'), '# toprep domain\n')

  class StubFs extends Service {
    constructor(ctx) {
      super(ctx, 'fs')
    }
    async resolve(path) {
      return { targetKey: path, displayPath: path }
    }
    async readText(target) {
      return readFileSync(target.targetKey, 'utf8')
    }
    async listDir(target) {
      const names = readdirSync(target.targetKey)
      return names.map((name) => ({
        name,
        type: statSync(join(target.targetKey, name)).isDirectory() ? 'directory' : 'file',
        target: { targetKey: join(target.targetKey, name), displayPath: join(target.targetKey, name) },
      }))
    }
    async stat(target) {
      return { version: 'v1', type: 'file', size: 0, targetKey: target.targetKey }
    }
  }

  class StubTools extends Service {
    constructor(ctx) {
      super(ctx, 'tools')
      this.registered = []
    }
    register(definition) {
      this.registered.push(definition)
      return () => {}
    }
  }

  const root = new Context()
  await root.plugin(StubFs)
  await root.plugin(StubTools)
  await root.plugin(plugin, {
    projectRoots: [work],
    coreFiles: ['AGENTS.md'],
    layerFiles: {},
    domainsDir: 'packages/domains',
    domainCandidates: ['packages/domains/{domain}/AGENTS.md'],
    maxBundleChars: 100000,
    probeTool: true,
    log: false,
  })

  const tools = root.tools
  const probe = tools.registered.find((definition) => definition.name === 'scope_router_status')
  if (!probe) throw new Error('scope_router_status не зарегистрирован')

  const status = await probe.execute({ domain: 'toprep' })
  if (typeof status !== 'string' || !status.includes('toprep')) {
    throw new Error('неожиданный ответ пробного тула: ' + status)
  }
  console.log('probe tool OK:', status.split('\n')[0], '/', status.split('\n').slice(-3).join(' | '))

  await root.fiber.dispose()
  console.log('OK: host-половина активируется, пробный тул работает, dispose чистый')
} finally {
  rmSync(work, { recursive: true, force: true })
}
