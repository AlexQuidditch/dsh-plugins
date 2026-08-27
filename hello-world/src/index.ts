/**
 * dsh-hello-world, host half.
 *
 * Registers the /hello slash command in the command plane (ctx.commands).
 * Namespace plugin shape: named exports name / inject / apply, no default
 * export (postmortem 0001: default export drops inject).
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'

export const name = 'hello-world'

/** The command registry must exist before this plugin starts. */
export const inject = ['commands']

/** Config from the Loader entry (see cordis.patch.yml). */
export interface HelloWorldConfig {
  greeting?: string
}

export function apply(ctx: Context, config: HelloWorldConfig = {}): void {
  const greeting = config.greeting ?? 'Привет из плагина dsh-hello-world!'

  ctx.commands.register({
    name: 'hello',
    description: 'Отвечает приветствием (пример плагина dsh-hello-world)',
    input: { hint: 'текст для ответа (необязательно!)' },
    handler: ({ rawInput }: CommandInvocation) => {
      const text = rawInput.trim()
      return {
        kind: 'success',
        text: text ? `${greeting} ${text}` : greeting,
      }
    },
  })

  ctx.logger.info('[hello-world] plugin loaded (greeting=%s)', greeting)
}
