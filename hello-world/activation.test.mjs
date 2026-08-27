/**
 * Изолированный тест активации host-половины dsh-hello-world (после сборки).
 *
 * Не трогает живой DSH: создаёт корневой Context cordis, монтирует
 * минимальный стаб сервиса `commands`, монтирует собранный плагин из
 * lib/index.js и проверяет регистрацию + вызов /hello.
 *
 * Запуск:  node activation.test.mjs   (после pnpm run build)
 */
import { Context, Service } from '@deepseek-ai/cordis'
import * as plugin from './lib/index.js'

class StubCommands extends Service {
  registered = []
  constructor(ctx) {
    super(ctx, 'commands')
  }
  register(definition) {
    this.registered.push(definition)
  }
}

const root = new Context()
await root.plugin(StubCommands)
await root.plugin(plugin, { greeting: 'Тестовая сборка:' })
const commands = root.commands

const def = commands.registered.find((d) => d.name === 'hello')
if (!def) throw new Error('command /hello не зарегистрирован')
console.log('registered:', def.name, '|', def.description)

const signal = new AbortController().signal
const result = await def.handler({ commandId: 'test-1', agent: null, rawInput: '  мир  ', signal })
console.log('handler result:', JSON.stringify(result))
if (result.kind !== 'success' || result.text !== 'Тестовая сборка: мир') {
  throw new Error('неожиданный результат обработчика: ' + JSON.stringify(result))
}

await root.fiber.dispose()
console.log('OK: host-половина активируется, команда работает, dispose чистый')
