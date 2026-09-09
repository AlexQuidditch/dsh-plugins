# dsh-vv-guardian

Порт GuardianPlugin из vv-opencode: авто-одобрение рутинных низкорисковых запросов разрешений, чтобы длинные/AFK-прогоны не вставали на промптах. Рискованное остаётся в ручном approval-флоу.

## Что делает

Слушает водопад `approval/request` **первым** (`{ prepend: true }`) и автоматически отвечает `allowed-once` только на песочниц-эскалации в режимы из `autoApprove` (по умолчанию — `workspace-write`, то есть ровно то, что обычная сессия и так имеет по умолчанию). Эскалация в `danger-full-access` и любые неизвестные виды запросов проходят дальше к человеку; если отвечать некому — approval-сервис отказывает (fail closed).

Решение принимается только по полю `reason` (`escalate sandbox to <mode>: <justification>`), которое строит `dsh-sandbox/escalation`; ничего другого плагин не доверяет.

## Установка

```bash
dsh plugin --profile web add dsh-vv-guardian   # + перезапуск dsh web
```

## Конфиг

```yaml
# профиль/cordis.patch.yml
- id: vv-guardian
  config:
    enabled: true
    autoApprove: [workspace-write]   # danger-full-access сюда НЕ добавляйте
```

Полное отключение: `- id: vv-guardian, disabled: true` в `cordis.patch.yml` профиля.

## Тест

```bash
pnpm install --store-dir ../.pnpm-store --offline
pnpm run build
node activation.test.mjs
```

Тест гоняет водопад с рутинной эскалацией (авто-аппрув), рискованной (проходит к «человеку»), неизвестным видом запроса и выключенным плагином — не трогая живой DSH.
