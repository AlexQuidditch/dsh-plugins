/**
 * Изолированный тест активации host-половины dsh-scope-router (после сборки).
 *
 * Не трогает живой DSH: создаёт корневой Context cordis, монтирует
 * минимальные стабы сервисов `fs` и `tools`, монтирует собранный плагин из
 * lib/index.js и проверяет:
 *   1) apply не падает, пробный тул регистрируется, dispose проходит чисто;
 *   2) workspace-гейтинг: агент с cwd внутри root получает бандл инструкций
 *      (в т.ч. при вложенном cwd), повторный шаг с тем же скоупом не
 *      ре-инъецируется;
 *   3) агент с cwd ВНЕ root не получает ничего — даже при сильных сигналах
 *      (упоминание домена в тексте, собственные fs/bash-сигналы по путям
 *      root'а) и даже после активности другого агента внутри root'а
 *      (кросс-сессионная утечка исключена);
 *   4) worktree-пиннинг: агент с cwd внутри <worktrees.dir>/<name> получает
 *      бандл ТОЛЬКО этого скоупа — доменные файлы читаются из чекаута
 *      worktree, упоминания чужих доменов и активность по чужим путям не
 *      переключают скоуп; worktree без доменного файла получает core-only;
 *      повторный шаг с тем же скоупом не ре-инъецируется.
 *
 * Запуск: node activation.test.mjs   (после pnpm run build)
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import * as plugin from './lib/index.js'

function assert(condition, message) {
  if (!condition) throw new Error('FAIL: ' + message)
}

/**
 * Messages entering the step.
 *
 * Every returned message must carry a session-log v4 admissible source: a
 * nonempty `kind` that is NOT the released `'plugin'` wrapper. v4 refuses that
 * wrapper at persistence time ("format v4 message requires a producer-owned
 * source kind"), which kills the whole turn the moment scope-router injects —
 * so this runs on every gating case, injected or not.
 */
function decisionMessages(decision) {
  const messages = decision.kind === 'enter' ? decision.messages : []
  for (const message of messages) {
    const kind = message.source?.kind
    if (typeof kind !== 'string' || kind.length === 0 || kind === 'plugin') {
      throw new Error(`FAIL: injected message source kind ${JSON.stringify(kind)} is not v4-admissible`)
    }
  }
  return messages
}

function messageText(message) {
  const block = message.content.find((candidate) => candidate.type === 'text')
  return block === undefined ? '' : block.text
}

const work = mkdtempSync(join(tmpdir(), 'scope-router-test-'))
try {
  // Фикстурный «проект»: ядро + послойная карта + домены toprep и obnime.
  writeFileSync(join(work, 'AGENTS.md'), '# core\n')
  writeFileSync(join(work, 'BACKEND.md'), '# backend map\n')
  const domainDir = join(work, 'packages', 'domains', 'toprep')
  mkdirSync(domainDir, { recursive: true })
  writeFileSync(join(domainDir, 'AGENTS.md'), '# toprep domain\n')
  const foreignDomainDir = join(work, 'packages', 'domains', 'obnime')
  mkdirSync(foreignDomainDir, { recursive: true })
  writeFileSync(join(foreignDomainDir, 'AGENTS.md'), '# obnime domain (main root)\n')
  const foreignAppDir = join(work, 'apps', 'obnime')
  mkdirSync(foreignAppDir, { recursive: true })
  writeFileSync(join(foreignAppDir, 'AGENTS.md'), '# obnime app (main root)\n')
  const schemasDir = join(domainDir, 'src', 'schemas')
  mkdirSync(schemasDir, { recursive: true })
  writeFileSync(join(schemasDir, 'scalars.ts'), 'export {}\n')

  // Фикстурные «worktree»-каталоги: toprep (домен + приложение), pilot-school
  // (ничего) и obnime (только core — файлы скоупа есть лишь в основном root).
  const worktreesDir = join(work, 'platform.worktrees')
  const toprepWorktree = join(worktreesDir, 'toprep')
  const toprepWorktreeDomain = join(toprepWorktree, 'packages', 'domains', 'toprep')
  const toprepWorktreeApp = join(toprepWorktree, 'apps', 'toprep')
  mkdirSync(toprepWorktreeDomain, { recursive: true })
  mkdirSync(toprepWorktreeApp, { recursive: true })
  writeFileSync(join(toprepWorktree, 'AGENTS.md'), '# wt toprep core\n')
  writeFileSync(join(toprepWorktree, 'BACKEND.md'), '# wt backend map\n')
  writeFileSync(join(toprepWorktreeDomain, 'AGENTS.md'), '# wt toprep domain\n')
  writeFileSync(join(toprepWorktreeApp, 'AGENTS.md'), '# wt toprep app\n')
  const pilotSchoolWorktree = join(worktreesDir, 'pilot-school')
  mkdirSync(pilotSchoolWorktree, { recursive: true })
  writeFileSync(join(pilotSchoolWorktree, 'AGENTS.md'), '# wt pilot-school core\n')
  const obnimeWorktree = join(worktreesDir, 'obnime')
  mkdirSync(obnimeWorktree, { recursive: true })
  writeFileSync(join(obnimeWorktree, 'AGENTS.md'), '# wt obnime core\n')

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
    layerFiles: { backend: ['BACKEND.md'] },
    domainsDir: 'packages/domains',
    domainCandidates: ['packages/domains/{domain}/AGENTS.md', 'apps/{domain}/AGENTS.md'],
    maxBundleChars: 100000,
    probeTool: true,
    log: false,
    worktrees: { dir: worktreesDir },
  })

  // Даём предзагрузке каталога доменов (async listDomainNames) завершиться.
  await new Promise((resolve) => setTimeout(resolve, 50))

  const tools = root.tools
  const probe = tools.registered.find((definition) => definition.name === 'scope_router_status')
  if (!probe) throw new Error('scope_router_status не зарегистрирован')

  // ── фейковые агенты и события ────────────────────────────────────────────

  const signal = new AbortController().signal
  const agentInside = { id: 'agent-inside', session: { header: { cwd: work } } }
  const agentOutside = { id: 'agent-outside', session: { header: { cwd: work + '-outside' } } }
  const agentNested = { id: 'agent-nested', session: { header: { cwd: domainDir } } }

  function preStep(agent, text, turn) {
    const payload = {
      agent,
      messages: [{ content: [{ type: 'text', text }] }],
      turn,
      step: 1,
      signal,
    }
    return root.waterfall('agent/pre-step', payload, async () => ({ kind: 'enter', messages: [] }))
  }

  function fsObserved(agent, path) {
    root.emit('fs/observed', { displayPath: path }, { kind: 'present', version: 'v1' }, { agent })
  }

  function bashResult(agent, command, workdir) {
    root.emit(
      'tools/result',
      { callId: 'c1', name: 'bash', arguments: { command, workdir }, agent, signal },
      { ok: true },
    )
  }

  // ── сценарий 1: агент внутри root получает бандл ─────────────────────────

  fsObserved(agentInside, join(schemasDir, 'scalars.ts'))
  bashResult(agentInside, 'cat packages/domains/toprep/AGENTS.md', work)

  const insideFirst = decisionMessages(await preStep(agentInside, 'правим backend контракты toprep, drizzle миграция', 1))
  assert(insideFirst.length === 1, 'агент внутри root должен получить одну инъекцию, получил ' + insideFirst.length)
  const insideText = messageText(insideFirst[0])
  assert(insideText.includes('# toprep domain'), 'бандл должен содержать доменный файл toprep')
  assert(insideText.includes('# backend map'), 'бандл должен содержать backend-карту (слой backend)')
  assert(insideText.includes('Working workspace: ' + work), 'заголовок бандла должен называть рабочий workspace')

  // ── сценарий 2: тот же скоуп — ре-инъекции нет ───────────────────────────

  const insideSecond = decisionMessages(await preStep(agentInside, 'продолжаем backend контракты toprep', 2))
  assert(insideSecond.length === 0, 'повторный шаг с тем же скоупом не должен ре-инъецировать, получил ' + insideSecond.length)

  // ── сценарий 3: агент вне root не получает ничего ────────────────────────
  // Сильные сигналы: текст упоминает домен, собственные fs-наблюдения по путям
  // root'а, bash с относительным фрагментом packages/domains/toprep. Плюс
  // активность другого агента внутри root'а уже накоплена (утечка исключена).

  fsObserved(agentOutside, join(schemasDir, 'scalars.ts'))
  bashResult(agentOutside, 'ls packages/domains/toprep', work + '-outside')
  fsObserved({ id: 'someone-else', session: { header: { cwd: work } } }, join(domainDir, 'AGENTS.md'))

  const outsideFirst = decisionMessages(await preStep(agentOutside, 'правим backend контракты toprep, drizzle миграция', 1))
  assert(outsideFirst.length === 0, 'агент вне root не должен получать инъекцию, получил ' + outsideFirst.length)

  // ── сценарий 4: вложенный cwd внутри root тоже Eligible ──────────────────

  const nestedFirst = decisionMessages(await preStep(agentNested, 'посмотри общий вид репозитория', 1))
  assert(nestedFirst.length === 1, 'агент с вложенным cwd должен получить core-бандл, получил ' + nestedFirst.length)
  assert(messageText(nestedFirst[0]).includes('# core'), 'вложенный cwd должен получать core-файлы')

  // ── сценарий 5: worktree-пиннинг — только свой скоуп ─────────────────────
  // Агент в worktree toprep: текст упоминает ЧУЖОЙ домен obnime, собственная
  // активность — по чужому пути основного root'а. Скоуп обязан остаться toprep,
  // файлы — из чекаута worktree, послойные карты — не подключены.

  const agentWorktree = { id: 'agent-worktree', session: { header: { cwd: toprepWorktree } } }

  fsObserved(agentWorktree, join(foreignDomainDir, 'AGENTS.md'))
  bashResult(agentWorktree, 'ls packages/domains/obnime', toprepWorktree)

  const worktreeFirst = decisionMessages(await preStep(agentWorktree, 'давай посмотрим obnime и заодно toprep', 1))
  assert(worktreeFirst.length === 1, 'агент в worktree должен получить одну инъекцию, получил ' + worktreeFirst.length)
  const worktreeText = messageText(worktreeFirst[0])
  assert(worktreeText.includes('# wt toprep domain'), 'worktree-бандл должен брать доменный файл из чекаута worktree')
  assert(worktreeText.includes('# wt toprep app'), 'worktree-бандл должен включать и apps/<app>/AGENTS.md (все файлы скоупа)')
  assert(worktreeText.includes('# wt toprep core'), 'worktree-бандл должен включать core-файлы worktree (includeCore по умолчанию)')
  assert(!worktreeText.includes('# obnime domain'), 'упоминание чужого домена не должно подтягивать его файлы')
  assert(!worktreeText.includes('# wt backend map'), 'послойные карты по умолчанию не входят в worktree-бандл')
  assert(!worktreeText.includes('This worktree branch does not yet contain'), 'без fallback строка про fallback не нужна')
  assert(worktreeText.includes('pinned by workspace'), 'заголовок бандла должен объявлять пиннинг')
  assert(worktreeText.includes('Working workspace: ' + toprepWorktree), 'заголовок должен называть worktree как root')

  // ── сценарий 6: worktree без доменного файла — core-only ─────────────────

  const agentWorktreePlain = { id: 'agent-worktree-plain', session: { header: { cwd: join(pilotSchoolWorktree, 'src') } } }
  const plainFirst = decisionMessages(await preStep(agentWorktreePlain, 'что тут вообще есть', 1))
  assert(plainFirst.length === 1, 'агент в worktree без домена должен получить core-бандл, получил ' + plainFirst.length)
  const plainText = messageText(plainFirst[0])
  assert(plainText.includes('# wt pilot-school core'), 'worktree без доменного файла должен получать core-файлы worktree')
  assert(plainText.includes('domain pilot-school'), 'заголовок должен пиннить домен по имени каталога')

  // ── сценарий 7: тот же worktree-скоуп — ре-инъекции нет ──────────────────

  const worktreeSecond = decisionMessages(await preStep(agentWorktree, 'ещё раз про obnime, неважно', 2))
  assert(worktreeSecond.length === 0, 'повторный шаг с тем же worktree-скоупом не должен ре-инъецировать, получил ' + worktreeSecond.length)

  // ── сценарий 8: fallback — файлы скоупа есть только в основном root ───────
  // Ветка worktree obnime ещё не содержит ни доменного, ни app-файла: оба
  // должны прийти из основного root, с пометкой об этом в заголовке.

  const agentWorktreeFallback = { id: 'agent-worktree-fallback', session: { header: { cwd: obnimeWorktree } } }
  const fallbackFirst = decisionMessages(await preStep(agentWorktreeFallback, 'сделаем фичу в obnime', 1))
  assert(fallbackFirst.length === 1, 'агент в worktree с fallback должен получить инъекцию, получил ' + fallbackFirst.length)
  const fallbackText = messageText(fallbackFirst[0])
  assert(fallbackText.includes('# obnime domain (main root)'), 'доменный файл должен прийти из основного root по fallback')
  assert(fallbackText.includes('# obnime app (main root)'), 'app-файл должен прийти из основного root по fallback')
  assert(fallbackText.includes('# wt obnime core'), 'core-файлы берутся из самого worktree')
  assert(fallbackText.includes('This worktree branch does not yet contain'), 'заголовок должен помечать fallback-файлы')

  // ── пробный тул ───────────────────────────────────────────────────────────

  const status = await probe.execute({ domain: 'toprep' })
  if (typeof status !== 'string' || !status.includes('toprep')) {
    throw new Error('неожиданный ответ пробного тула: ' + status)
  }
  assert(status.includes('workspace gate'), 'пробный тул должен показывать состояние workspace-гейтинга')
  assert(status.includes('[agent-inside]'), 'пробный тул должен атрибутировать активность агенту')
  assert(status.includes('worktree pinning'), 'пробный тул должен показывать worktree-пиннинг')
  assert(
    status.includes('[agent-worktree] ' + join(toprepWorktree, 'packages', 'domains', 'obnime')),
    'относительный фрагмент из shell должен резолвиться в корень worktree агента',
  )
  assert(status.includes('pinned=yes'), 'последняя детекция должна быть помечена как pinned')
  console.log('probe tool OK:', status.split('\n')[0], '/', status.split('\n').slice(-3).join(' | '))

  await root.fiber.dispose()
  console.log('OK: workspace-гейтинг работает, утечек между агентами нет, dispose чистый')
} finally {
  rmSync(work, { recursive: true, force: true })
}
