/**
 * Изолированный тест dsh-vv-context (после сборки).
 *
 * Хостовая половина — no-op, поэтому тест проверяет: активацию плагина и
 * чистый dispose, плюс юнит-кейсы чистых форматтеров (клиентский бандл в node
 * не запускается — его проверяет сборка tsdown).
 *
 * Запуск: node activation.test.mjs   (после pnpm run build)
 */
import { Context } from '@deepseek-ai/cordis'
import * as plugin from './lib/index.js'
import { formatPercent, formatTokens, shareOf } from './lib/index.js'

let failed = 0
function check(name, condition, detail = '') {
  if (condition) { console.log('ok  -', name); return }
  failed += 1
  console.log('FAIL -', name, detail)
}

check('formatTokens: 950 → 950', formatTokens(950) === '950')
check('formatTokens: 1234 → 1.2k', formatTokens(1234) === '1.2k')
check('formatTokens: 1234567 → 1.2M', formatTokens(1234567) === '1.2M')
check('formatTokens: negative → dash', formatTokens(-5) === '—')
check('shareOf: absent denominator → undefined', shareOf(10, undefined) === undefined)
check('shareOf: zero denominator → undefined', shareOf(10, 0) === undefined)
check('shareOf: 4/5 → 0.8', Math.abs((shareOf(4, 5) ?? 0) - 0.8) < 1e-9)
check('formatPercent: undefined → dash', formatPercent(undefined) === '—')
check('formatPercent: 0.84 → 84%', formatPercent(0.84) === '84%')

const root = new Context()
await root.plugin(plugin)
await root.fiber.dispose()
console.log('ok  - host-половина активируется, dispose чистый')

if (failed > 0) { console.log(`FAILED: ${failed}`); process.exit(1) }
console.log('OK: форматтеры и host-половина dsh-vv-context работают')
