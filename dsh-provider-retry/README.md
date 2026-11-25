# dsh-provider-retry

Хост-плагин DSH: превращает ошибку лимита/квоты провайдера в **один durable-повтор**, запланированный на время сброса лимита. Ход падает с ошибкой провайдера (как сейчас), но сессия больше не ждёт человека: в момент сброса `schedule` доставляет ей промпт «продолжи прерванную задачу, проверь фактическое состояние», и работа продолжается.

Пример исходной ошибки (zai/GLM):

```
Status: Failed
Provider: zai
Model: glm-5.3
Error: 429: {"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-11-17 05:13:16"}
```

После плагина к этой ошибке добавляется ровно одна запись в Automation (`schedule`) с заголовком
`[retry] zai/glm-5.3 → 2026-11-17 05:13:16`; когда она срабатывает, сессия получает reminder-промпт и продолжает задачу.

## Как это работает

1. Агентский loop сообщает о неудачной попытке запроса через waterfall **`agent/request-error`** (`provider`, `failure {message, code, status?, providerRetryAfterMs?}`, `agent`, `signal`).
2. Плагин классифицирует failure: жёсткая квота (`QUOTA`/`ACCOUNT_QUOTA`, коды Z.ai 1308/1310/1316–1321, 429/402) или транзиентный rate limit.
3. Достаёт абсолютный момент сброса в порядке приоритета:
   1. `failure.providerRetryAfterMs` (заголовок `Retry-After`, если адаптер его пробросил);
   2. абсолютный timestamp в тексте (`...Z`/`+08:00`) — не пересчитывается;
   3. `reset at <naive-время>` / CN «… 重置» — naive-время читается в **зоне провайдера**: для `zai` это `Asia/Shanghai` (UTC+8), как в официальных ошибках Z.ai; остальные — UTC;
   4. `metadata.resets_at` (OpenRouter 403 budget) и относительные `retry after N seconds` / `reset in ...`;
   5. если времени нет: при `scheduleWithoutReset: true` — оценка (5h для 1308, fallback для прочих), иначе failure уходит дальше без ретрая.
4. Прибавляет `graceSeconds` и создаёт задачу `schedule.create({title, prompt, timing: {kind:'at', at}, target: {kind:'session', sessionId}})`. Задача durable, переживает рестарт; актор — сама сессия, чтобы не получать лишнее уведомление об изменении.
5. Возвращает из waterfall `undefined` — **ход не повторяется in-turn**, ошибка остаётся видимой карточкой Failed, а сессия простаивает до срабатывания задачи. Промпт задачи содержит исходную ошибку провайдера, время сброса и инструкцию продолжать с проверки состояния, а не начинать заново.
6. Повторные падения: если для сессии уже есть активная задача с префиксом `titlePrefix`, вторая не создаётся (дубли не копятся). Если провайдер снова ответит лимитом после повтора — будет создана следующая задача по новому времени сброса.

Падение на любом шаге (нет `schedule`, сессия — delegated child, `schedule.create` отказал, `list` упал) возвращает `next()`: поведение остаётся штатным, ничего не ломается.

## Что не ретраится

- `402 Insufficient Balance` / `ACCOUNT_QUOTA` без времени сброса и Z.ai `1113`/`1309` — нужен платёж/план, ожидание не поможет (delegate без задачи).
- `401/403` без ресет-хинта, `400/413`, context/empty-response — не квота.
- OpenRouter `openrouter_credits`/`openrouter_key_limit` (`metadata.limit_source`) — терминальные.
- Короткие rate limit (< `minScheduleDelaySeconds`) — их качественно обрабатывает встроенный `dsh-llm-retry` in-turn; плагин не вмешивается.
- **Subagent-сессии**: им `schedule` доставлять нельзя. По умолчанию (`subagentPolicy: skip`) retry не планируется; `ancestor` перенаправляет задачу в ближайшую root-сессию.

## Конфигурация

Ряд `provider-retry` в профиле (`cordis.patch.yml` бандла и слой пользователя). Значения по умолчанию:

| Ключ | По умолчанию | Смысл |
| --- | --- | --- |
| `enabled` | `true` | выключить плагин без удаления |
| `graceSeconds` | `90` | запас после времени сброса |
| `minScheduleDelaySeconds` | `300` | короче — отдать встроенному retry |
| `maxDelayMinutes` | `10080` (7 дней) | дальше — не планировать |
| `scheduleWithoutReset` | `false` | планировать ли квоту без времени сброса |
| `fallbackDelayMinutes` | `20` | fallback без времени |
| `fiveHourFallbackMinutes` | `300` | оценка для Z.ai 1308 без штампа |
| `reprobeDelayMinutes` | `60` | re-probe для недельных окон |
| `subagentPolicy` | `skip` | `skip` или `ancestor` |
| `titlePrefix` | `[retry]` | маркер задач (≤120 симв.) |
| `providerTimeZones` | `{}` (поверх встроенных: zai/zhipu → Asia/Shanghai, иначе UTC) | IANA-зоны для naive-штампов |

Пример пользовательского слоя:

```yaml
- id: provider-retry
  name: dsh-provider-retry
  config:
    graceSeconds: 120
    scheduleWithoutReset: true
    providerTimeZones:
      zai: Asia/Shanghai
```

## Установка

```bash
# из workspace, для текущего профиля web
plugin_manager install_bundle { target: "/Users/alex_quidditch/projects/dsh-plugins/dsh-provider-retry" }
# затем перезапуск dsh web (Host-плагин грузится при старте)
```

После установки проверка: `cordis_inspect_query` → Config / Event; в Automation появятся задачи с префиксом `[retry]`. Удаление задачи — через Automation, плагин не воскрешает отменённое.

## Ограничения

- **Host-only**: своей UI-половины нет. Видимость — задача в Automation + reminder в сессии; карточка Failed у исходного хода остаётся (это честное представление того, что запрос провалился).
- Если момент сброса не распарсился, а `scheduleWithoutReset: false`, повтор не ставится — нужно включить настройку или ждать ручного действия.
- `Retry-After` работает только если адаптер пробросил `providerRetryAfterMs`; pi-ai адаптеры сейчас отдают только текст ошибки, поэтому для них парсится тело/текст.
- Время сброса читается по зоне провайдера (`zai` = UTC+8). Для кастомного провайдера с naive-штампом в другой зоне задайте `providerTimeZones`.
- `agent/request-error` покрывает только агентские шаги; фоновые вызовы (например, заголовок сессии) не планируют retry.

## Тесты

```bash
npm test
# node --test tests/errors.test.mjs   — 24 проверки парсинга/решений (чистые функции)
# node activation.test.mjs            — 23 проверки регистрации, schedule, дедупа, soft-fail
```
