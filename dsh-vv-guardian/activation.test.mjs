/**
 * Изолированный тест активации host-половины dsh-vv-guardian (после сборки).
 *
 * Не трогает живой DSH: создаёт корневой Context cordis, монтирует плагин из
 * lib/index.js и «человеческого» ответчика (зарегистрированного ПОСЛЕ
 * guardian, как в реальной композиции), затем гоняет approval/request
 * водопад с рутинной и рискованной эскалацией.
 *
 * Запуск: node activation.test.mjs   (после pnpm run build)
 */
import { Context } from '@deepseek-ai/cordis'
import * as plugin from './lib/index.js'

const root = new Context()
await root.plugin(plugin, { autoApprove: ['workspace-write'] })

// Человеческий ответчик — регистрируется после guardian (как web answerer).
await root.plugin({
  name: 'fake-human-answerer',
  apply(ctx) {
    ctx.on('approval/request', () => 'rejected')
  },
})

const mkReq = (reason) => ({ agent: { session: {} }, toolName: 'bash', callId: 'c1', reason })
const fallback = () => 'unavailable'

// 1. Рутинная эскалация workspace-write → авто-аппрув guardian.
const routine = await root.waterfall({}, 'approval/request', mkReq('escalate sandbox to workspace-write: записать файл в workspace'), fallback)
if (routine !== 'allowed-once') throw new Error(`ожидался allowed-once, получено: ${routine}`)
console.log('routine escalation →', routine)

// 2. Рискованная эскалация → проходит дальше к человеку → rejected.
const risky = await root.waterfall({}, 'approval/request', mkReq('escalate sandbox to danger-full-access: полный доступ'), fallback)
if (risky !== 'rejected') throw new Error(`ожидался rejected, получено: ${risky}`)
console.log('risky escalation →', risky)

// 3. Неизвестный вид запроса → проходит дальше (не трогаем).
const unknown = await root.waterfall({}, 'approval/request', mkReq('some future approval kind'), fallback)
if (unknown !== 'rejected') throw new Error(`ожидался rejected, получено: ${unknown}`)
console.log('unknown kind →', unknown)

// 4. Никакого ответчика после guardian нет → fallback unavailable.
await root.fiber.dispose()

const root2 = new Context()
await root2.plugin(plugin, { autoApprove: ['workspace-write'] })
const alone = await root2.waterfall({}, 'approval/request', mkReq('escalate sandbox to workspace-write: нужно'), fallback)
if (alone !== 'allowed-once') throw new Error(`ожидался allowed-once, получено: ${alone}`)

// 5. Выключенный guardian не отвечает вовсе.
await root2.fiber.dispose()

const root3 = new Context()
await root3.plugin(plugin, { enabled: false })
const off = await root3.waterfall({}, 'approval/request', mkReq('escalate sandbox to workspace-write: нужно'), fallback)
if (off !== 'unavailable') throw new Error(`ожидался unavailable, получено: ${off}`)
console.log('disabled guardian →', off)

await root3.fiber.dispose()
console.log('OK: guardian авто-аппрувит рутину, пропускает рискованное, уважает enabled=false')
