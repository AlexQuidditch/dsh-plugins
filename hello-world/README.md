# dsh-hello-world

Минимальный «настоящий» бандл-плагин для DeepSeek Harness: host-половина (slash-команда `/hello`) + browser-половина (кнопка 👋 в строке действий каждого сообщения ассистента). Исходники — TypeScript, сборка — тем же пресетом (`clientBundle`), что используют штатные UI-плагины DSH.

## Структура

```
hello-world/
├── src/
│   ├── index.ts              host-половина: /hello через ctx.commands
│   └── client/
│       ├── index.ts          browser-половина: slots.register в assistant-actions
│       └── HelloAction.tsx   React-компонент кнопки
├── cordis.patch.yml          бандл-патч: вставляет Loader-запись hello-world
├── tsconfig.json
├── tsdown.config.ts          использует пресет <repo>/packages/client/tsdown.client.ts
└── lib/                      сборка: index.js (host) + client.js (browser) + types/
```

## Сборка

Пресет импортируется из чекаута исходников DSH (build-time зависимость; артефакт самодостаточен). Нужен `pnpm install` в репо-чекауте:

```bash
pnpm install                  # в ~/projects/deepseek-harness
pnpm install                  # здесь (devDeps: tsdown, typescript, react, @deepseek-ai/* rc.6)
pnpm run build                # tsc -p + tsdown → lib/
node activation.test.mjs      # изолированный тест host-половины
```

## Установка в профиль (одна команда)

Поскольку пакет объявляет `dsh.bundle.patch`, `dsh plugin add` сам добавляет его в `dsh.profile.bundles` — ручная запись в `cordis.patch.yml` профиля не нужна:

```bash
dsh plugin --profile web add ~/projects/dsh-plugins/hello-world
dsh --dump-config --profile web    # бандл в bundles + строка hello-world в дереве
```

## Конфиг

| Ключ       | По умолчанию                           | Описание                   |
| ---------- | -------------------------------------- | -------------------------- |
| `greeting` | `'Привет из плагина dsh-hello-world!'` | Текст приветствия `/hello` |

## Примечания

- Версии в peerDeps/devDeps пинятся на `0.1.0-rc.6` (профиль установлен на rc.6; репо-чекаут — rc.7, слот `conversation.chat.assistant-actions` в обеих версиях идентичен).
- Клиентская половина обязана быть собранной: node-половина DSH резолвит `exports["./client"]` и отдаёт под `/plugins`.
- После установки нужен перезапуск `dsh web`, чтобы живой GUI подхватил плагин.
