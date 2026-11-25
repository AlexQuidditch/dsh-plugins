# dsh-subagent-model-badge

Клиентский плагин DSH: в доке под композером показывает, на какой модели реально работает **сессия субагента** — `provider/model`, при наличии `reasoningEffort` и с пометкой «далее», если модель переключена, но ещё не использовалась.

- Слот: `conversation.composer.dock` (session-scoped), `order: 2` — рядом со штатными `activity` и `usage`.
- Рендерится только для субагентов: проверяются `ctx.sessions.subagentAddress(id)` и строка саммари сессии (`origin === 'subagent'` или `parentId`). У обычных сессий — `null`.
- Источник модели: проекция `modelSelection` (`lastUsed` / `next`), то есть последний фактический запрос, а не пины пресета и не `.dsh/workspace.yaml`.
- Локаль: `en`, `ru` (остальные падают в английский). Стили — на токенах темы (`--dsw-alias-*`).

## Установка

```bash
dsh plugin --profile web add /Users/alex_quidditch/projects/dsh-plugins/dsh-subagent-model-badge
```

Или через менеджер плагинов (bundle `dsh-subagent-model-badge`), затем обновить страницу GUI.

## Проверка

Откройте разговор субагента (из каталога субагентов или из списка сессий): под композером появится строка `Модель deepseek-account/deepseek-flash · max`. В обычной сессии строки нет.

## Ограничения

- Модель берётся из durable-проекции, а не из заголовка запроса в момент рендера: до первого запроса показывается `next`, после смены модели — `lastUsed` плюс «далее».
- Если хост не прислал проекцию `modelSelection` для сессии, бейдж не рендерится (fail-closed).
