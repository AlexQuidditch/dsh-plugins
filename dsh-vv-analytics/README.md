# dsh-vv-analytics

Порт AnalyticsPlugin из vv-opencode: локальная телеметрия токенов/кэша + живой индикатор в шапке сессии. Данные не покидают машину.

## Что делает

- **Хост**: оборачивает водопад `llm/stream` и дописывает одну JSONL-строку на каждый завершённый шаг модели с usage-отчётом в `$DSH_HOME/vv-analytics/usage-YYYY-MM.jsonl`:
  `{"ts","sessionId","provider","model","purpose","inputTokens","cacheReadTokens","cacheWriteTokens","outputTokens"}`.
- **Браузер**: пилюля «кэш NN%» в правой утилитной полосе шапки сессии — токенно-взвешенный hit rate из проекции `tokenUsage` (зелёный ≥80%, жёлтый ≥50%, красный ниже, серый «кэш n/a» до первых данных).

Схема записи — контракт для `vvoc analytics cache-hit-rate`.

## Тест

```bash
pnpm install --store-dir ../.pnpm-store --offline
pnpm run build
node activation.test.mjs   # format-юниты + JSONL-рекордер через фейковый поток
```

## Отключение

`- id: vv-analytics, disabled: true` в `cordis.patch.yml` профиля.
