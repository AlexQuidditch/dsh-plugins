/**
 * The 👋 action rendered in every finalized assistant message's IconActions
 * row. Clicking it submits HELLO_LINE to the session's agent via the
 * injected `runHello` verb (session.prompt; a leading `/name` is a skill
 * token for the model, not command.execute). Failures are logged to the
 * console so a miss never looks silent.
 */

import type { HelloActionProps } from './slots.ts'

export function HelloAction({ runHello }: HelloActionProps) {
  return (
    <button
      type="button"
      title="Отправить строку агенту"
      onClick={() => void runHello().catch((error) => {
        console.error('[dsh-hello-world] runHello failed:', error)
      })}
    >
      Foo
    </button>
  )
}
