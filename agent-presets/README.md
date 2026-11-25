# dsh-agent-presets

Three user-facing custom agent presets for DeepSeek Harness — plus the three child presets their subagent tools compose — delivered as one **bundle**:

| Preset id | Что это |
| --- | --- |
| `vv-controller` | Порт vv-opencode: spec → plan → execute с review-гейтами. Персона несёт vv work policy, шесть скиллов `vv-spec` / `vv-plan` / `vv-execute` / `vv-review` / `vv-reflect` / `vv-handoff` едут внутри этого пакета, субагенты пришпилены к `deepseek-account/deepseek-flash` (effort max). Модель исполнения фиксирована во всём пресете и не выбирается: после утверждения плана vv-plan не предлагает опций, а сразу передаёт в vv-execute, который выводит из репозитория манифест сессии-исполнителя (корень проекта, URL приложения, статус reverse-proxy/caddy, команды старта, креды `AGENTS.md`, каталог `.agents/e2e/scenarios`), подтверждает его у пользователя и делегирует исполнение отдельной managed-сессии (`session_spawn`, `zai/glm-5.3` effort max, промпт целиком на английском); диспетчеризация имплементации в самой сессии контроллера не предлагается — это только аварийный режим при недоступности `session_spawn` с явного одобрения пользователя. |
| `cursor/vv-controller` | Тот же vv-цикл, но на провайдере `cursor` из плагина [cursor-to-dsh](https://github.com/lukeinx/cursor-to-dsh): контроллер, его субагенты (`cursor/vv-worker`) и executor-сессия vv-execute работают на Cursor-модели. Маршрут мастер-сессии выбирает workspace-policy по `model.presets`, поэтому в workspace без политики он берётся из выбора в композере, а воркеры — из `agentOptions` пина пресета. Peak-hours и provider-retry эти сессии не трогают (их расписания/сигнатуры покрывают только `deepseek`/`zai`). Требует установленный cursor-to-dsh и Cursor API Key. |
| `standard-browser` | Штатный `standard`-агент плюс инструмент `subagent_browser`: браузерные субагенты на `deepseek-flash`, каждый в своём окне Chrome. |
| `vv-worker` | **Служебный** пресет для детей `vv-controller`: персона-исполнитель (одна делегированная роль, без vv-роутинга), `time-context`, кодинг-набор `bash` / `fs` / `jobs` / `todo` / `web` / компакция и `tool-subagent-control` (чтобы ребёнок мог отправлять `send_message` родителю). Браузерная политика персоны несёт базовый PC-вьюпорт **1920×1080** для тестов десктоп-версии и дисциплину чтения консоли браузера при отладке UI. Не выбирается для сессии вручную. |
| `cursor/vv-worker` | **Служебный** пресет для детей `cursor/vv-controller` — тот же контракт, что `vv-worker`; cursor-маршрут задаёт `model.presets` workspace-policy (или `agentOptions` пина родителя в workspace без политики). Отдельный id нужен, чтобы маршрутизатор различал детей cursor-семейства. Не выбирается для сессии вручную. |
| `browser-subagent` | **Служебный** пресет для детей `standard-browser`: браузерный контракт в персоне + `tool-subagent-control` для `send_message`; своих shell/fs/web-инструментов у детей нет, `chrome_*` приходят host-глобально из `dsh-plugin-chrome`. Окно Chrome открывается на **1920×1080** — базовый PC-вьюпорт по умолчанию для всех страниц и скриншотов. |

Служебные пресеты видны в ростере (в DSH 0.2.1 у пресета нет скрытого флага), но предназначены только для композиции детьми — их указывают в `agentPreset` строк `tool-subagent`.

## Cursor-семейство: требования и настройка

Пресет `cursor/vv-controller` работает только вместе с плагином `cursor-to-dsh` (провайдер `cursor`):

1. Установите плагин: в Desktop — **Плагины → Добавить плагин → `cursor-to-dsh`**, в CLI — `dsh plugin --profile web add cursor-to-dsh`; перезапустите `dsh web`.
2. Вставьте Cursor API Key в **Настройки → Модели** (строка Cursor) — плагин сам пишет его в credential-сервис как `CURSOR_API_KEY`. **Service-токен обязан иметь scope `agent:*`**: без него каталог моделей не грузится, а каждый run падает `CURSOR_RUN_FAILED: permission_denied` (Cursor отвечает `Service token missing required API key scope: agent:*`). Личный ключ или service-ключ с этим scope работают.
3. Модель по умолчанию — `default` (Cursor Default, auto). Чтобы закрепить другую — сверьте точный id в каталоге (Настройки → Модели → Cursor, id в kebab-case: `claude-sonnet-5-5`, `claude-opus-5-5`, …) и замените `default` в двух местах: `agentOptions` пресета в `cordis.patch.yml` и `model.presets` в `.dsh/workspace.yaml`.

Контекстные слоты cursor-to-dsh задаются конфигом плагина в профиле (не в пресете) — для длинных vv-сессий (spec/plan XML, скиллы) полезно поднять tier; допустимые значения — `min`, `max` или предложенное каталогом (например `500k`). Для максимума используйте `max`: плагин возьмёт наибольший предложенный tier и сам понизится, если аккаунт его отверг; значение вроде `500k`, которого нет среди предложенных, молча падает до минимального:

```yaml
- id: llm-cursor
  name: cursor-to-dsh
  config:
    apiKeyEnv: CURSOR_API_KEY
    context: "max"
```

Пиковые часы и provider-retry на Cursor-маршрут не влияют: расписания dsh-peak-hours покрывают только семейства `deepseek`/`zai` (провайдер без записи проходит гейт), а dsh-provider-retry не узнаёт сигнатуры Cursor-ошибок (`not-a-quota-failure → delegate`). Поэтому паузы, blocks и durable-ретраи к cursor-сессиям не применяются — как и задумано для этого семейства.

### Review-агенты: две LLM-семьи, всегда субагенты

Review-протокол vv (`vv-review`, `vv-plan`, `vv-execute`) спавнит обе линзы
обзора **субагентами** корневой сессии (`subagent`), а не отдельными
managed-сессиями. Семейства разные по замыслу:

| Линза | Маршрут | Роль |
| --- | --- | --- |
| Primary reviewer | `provider: openrouter`, `model: openai/gpt-6-luna`, `reasoning_effort: high` | полный проход по контракту/спеке |
| Adversarial reviewer | `provider: cursor`, `model: grok-4.7`, `reasoning_effort: high` | другой бриф: скрытые противоречия, rollback-пробелы, «как это упадёт в проде» |

Для работы per-call маршрутов нужны обе половины: (1) строки `tool-subagent`
у `vv-controller` и `cursor/vv-controller` c `modelSelection: true` и
`modelDiscovery: true` (этот пакет), и (2) авторизация маршрутов в Host-политике
`subagent-model-selection-settings.allowedModels` профиля
(`~/.dsh/profiles/web/cordis.patch.yml`). Без (2) выбор маршрута отклоняется до
запроса к провайдеру. Если маршрут недоступен, линза уходит на ближайшую
достижимую другую семью и в отчёте объявляется деградация независимости.


## Установка

```bash
dsh plugin --profile web add ~/projects/dsh-plugins/agent-presets
# или через plugin_manager: action=install_bundle, target=<абсолютный путь к agent-presets>
```

Затем **перезапустите `dsh web`**: строка пресета грузится на старте процесса. Новые сессии увидят пресеты в списке.

Проверка: в списке пресетов все шесть карточек должны быть без бейджа «Failed to load». Создайте сессию с пресетом `vv-controller` — в каталоге скиллов должны появиться шесть `vv-*`; создайте сессию с `standard-browser` — в каталоге инструментов должен быть `subagent_browser`. Для `cursor/vv-controller`: появились шесть `vv-*` скиллов, панель vv-* видна, и в workspace с `model.presets` сессия стартует на `cursor`-модели (проверяется в шапке сессии/логах workspace-policy).

## Как это устроено

`cordis.patch.yml` вставляет шесть строк `@deepseek-ai/dsh-agent-preset` (`preset-vv-worker`, `preset-cursor-vv-worker`, `preset-browser-subagent`, `preset-vv-controller`, `preset-cursor-vv-controller`, `preset-standard-browser`) в конфигурацию профиля. Каждый список `plugins` — это **текущий shipped-пресет того же семейства** (`cordis` и `standard` соответственно), поэтому все имена пакетов разрешаются в этой версии DSH, плюс дельты:

- `vv-controller` = shipped `cordis` − `tool-cordis` (self-modification — граница доверия для авторинга пресетов, а не часть рабочего агента) − `tool-plugin-market` (оба тула правят композицию, рабочему агенту они не нужны) + vv-персона + пришпиленный маршрут субагентов по умолчанию (`modelSelection`/`modelDiscovery` включены: ревью-агенты переопределяют маршрут per-call) + скиллы из `skills/` + делегирование в `vv-worker`;
- `cursor/vv-controller` = та же композиция, что `vv-controller`, но `tool-subagent` по умолчанию пришпилен к `cursor/default` (Cursor Default) и делегирует в `cursor/vv-worker`; `modelSelection`/`modelDiscovery` включены так же, поэтому ревью-агенты и здесь спавнятся per-call маршрутами. Собственный маршрут мастер-сессии берётся из workspace-policy (`model.presets`), потому что схема пресета модель мастер-сессии не задаёт (см. раздел ниже);
- `standard-browser` = shipped `standard` − `tool-plugin-market` + строка `subagent_browser`, выбирающая дочерний пресет `browser-subagent`.

`time-context` и `tool-schedule` берутся из shipped-шаблонов 0.2.1 как есть — контроллеру нужна дата для `YYYY-MM-DD`-идентификаторов spec-пакетов, а планировщик доступен как обычный тул.

### Маршрут `cursor/vv-controller`

Схема пресета — только `{ id, name, description, order, plugins }`: модель мастер-сессии пресет закрепить не может (сервис `agentDefaultModel` session-controller читает из host-контекста, так что строка внутри пресета на дефолт сессии не влияет). Поэтому маршрут cursor-семейства выбирает `dsh-plugin-workspace-policy` через карту `model.presets` в `.dsh/workspace.yaml`:

```yaml
model:
  presets:
    "cursor/vv-controller":
      provider: cursor
      model: default
    "cursor/vv-worker":
      provider: cursor
      model: default
```

Правила те же, что у `default`/`workers`: мастер-сессия при свежем старте и без явного выбора пользователя получает preset-маршрут (ручной выбор в композере его перекрывает), воркеры — маршрут по умолчанию, **но только для наследуемого маршрута**: явный per-call `provider`/`model` у `subagent` и `agentOptions`-пин пресета политика не перекрывает (см. `dsh-plugin-workspace-policy`). Executor-сессия vv-execute наследует пресет родителя (`inheritPreset: true` в managed-sessions) и садится на тот же маршрут без дополнительной проводки. **Смена пресета в черновике сессии** (композерный пикер) тоже пересчитывает маршрут: workspace-policy слушает `agent-preset/selected` и выбирает маршрут нового пресета, а при отсутствии записи возвращает `model.default`. В workspace без файла политики мастер-сессия стартует с глобального дефолта/ручного выбора, а воркеры получают `agentOptions`-пин пресета. Пример живой карты — `.dsh/workspace.yaml` этого репозитория.

### Дети — это отдельные пресеты (DSH 0.2.1)

В 0.2.1 `@deepseek-ai/dsh-tool-subagent` больше не принимает `persona` и `toolFilter` — строка падает при загрузке: «persona is no longer supported; configure persona and tool plugins in an Agent Preset and select it with agentPreset (spawn only)». Поэтому персона и набор инструментов ребёнка живут в собственных пресетах `vv-worker` / `cursor/vv-worker` / `browser-subagent`, а родительские строки ссылаются на них через `agentPreset: <id>`. Следствия:

- `toolFilter` замены не имеет. Прежняя гарантия «у браузерного ребёнка только `chrome_*`» невыразима: `dsh-plugin-chrome` монтирует один host-ряд, поэтому `chrome_*` видны всем агентам; дочерний пресет лишь не даёт ребёнку shell/fs/web-инструментов.
- `backgroundMode` тоже исчез — дети continuable по умолчанию, отдельное поле не нужно.
- **Мессенджер детей сохраняется явно**: ребёнок, который наследует родительский пресет, получает `send_message` из группы `delegation`; у независимого дочернего пресета её нет, поэтому `vv-worker`, `cursor/vv-worker` и `browser-subagent` монтируют `tool-subagent-control` сами. Иначе runtime не вставляет ребёнку инструкцию «отправь результат родителю», и `subagent`-описание теряет канал mid-flight-сообщений.
- Дочерние пресеты объявлены раньше родительских: строка `tool-subagent` проверяет `agentPreset` при монтировании и должна видеть объявление.

Скиллы подключаются через `skill-filesystem.customSkillDirs`; путь к ним вычисляется `!!js`-выражением от `baseUrl` через `createRequire(...).resolve('dsh-agent-presets/package.json')` — тот же идиом, которым shipped-пресет `cordis` подключает свои скиллы. `baseUrl` для строки bundle-патча — каталог профиля, поэтому пакет находится в `node_modules` профиля независимо от того, куда он установлен.

Правки, сохранённые из веб-редактора пресетов, перекрывают эти строки по id из `cordis.patch.yml` профиля, так что бандл остаётся слоем по умолчанию.

## Миграция с 0.1

До появления declaration-строк пользовательский пресет был каталогом `$DSH_HOME/.agent-presets/<id>/` с `preset.yml` + `agent.cordis.yml`. **В 0.2 этот каталог не читается никем**, поэтому после обновления оба пресета молча исчезли из ростера. Каталоги перенесены в `.agent-presets.retired-<timestamp>/` и могут быть удалены.

Заодно в старых копиях были две несовместимости с 0.2:

- обе ссылались на `@deepseek-ai/dsh-workflow-worker-thread`, у которого нет релиза 0.2 — активация упала бы даже при чтении каталога; в текущих shipped-шаблонах это `@deepseek-ai/dsh-workflow-ptc`;
- `standard-browser` пришпиливал модель `deepseek-v4-flash-vision-exp`, которой больше нет; заменено на `deepseek-account/deepseek-flash` (принимает изображения — проверено скриншотами), effort `max`.

Все пресеты наследуют `tool-ralph: disabled: true` из shipped-шаблонов 0.2. Если нужен ralph-цикл — уберите `disabled` у строки `tool-ralph`.

## Hive-derived contracts (2026-11)

The vv skills now carry contracts adopted from the hive workflow engine (fact-checked analysis: [`hive-research/hive-practices-analysis.md`](../hive-research/hive-practices-analysis.md); normative vocabulary: [`hive-research/vv-contract-vocabulary.md`](../hive-research/vv-contract-vocabulary.md)). The vocabulary file is the normative source for enums, formats, file paths, tool names, and reason codes; the skills implement its [S] sections as prompts and the dsh-vv-spec-guard / dsh-vv-panel plugins enforce the deterministic parts.

- **Two-axis findings** — severity (`Critical | Important | Minor`) plus decision authority (`safe_auto | gated_auto | manual | fyi`); open `gated_auto` + `manual` findings block closure, and a previous reviewer's classification is never an operator decision.
- **Evidence anchors + `spec_guard_evidence`** — every finding carries path, line range, and a byte-exact excerpt; the dispatcher verifies it before accepting (tool verdict or `sed` byte compare) and rejects the whole finding on mismatch, recorded as `REJECTED_EVIDENCE`.
- **Convergence budgets + reason codes + grants** — max 2 fix passes + 1 verify-only pass; from pass 2 only anchored Critical/Important findings auto-fix, the rest become `DEFERRED` in `.vvoc/specs/<id>/reviews/deferred-findings.md`; a closed reason-code table (`MAX_PASSES`, `MAX_REVISION_ROUNDS`, `DETERMINISTIC_FAILURE`, `OPERATOR_GRANT_REQUIRED`, `STALE_APPROVAL`, `REJECTED_EVIDENCE`) and operator grants of 1-3 extra passes in `reviews/grants.md`.
- **Subagent envelope + headless + stale-artifact rule** — every implementer/reviewer report ends with `Status / Changed files / Commands run / Evidence / Reason code / Question`; subagents may not ask the user; `DONE` with unchanged target files is a failure, verified physically (`git status --porcelain` / hashes) before acceptance and commit.
- **Retry fingerprints** — re-dispatches carry an assertion block (already done, HEAD oid, exact failure, what must differ); fingerprint = first 12 hex of `sha256(reason_code + command + first 200 chars of error + HEAD)`; the 3rd identical fingerprint parks the task as `DETERMINISTIC_FAILURE`; provider quota failures never count.
- **Nonce wrappers** — untrusted content embedded in packets (user paste, web content, logs, third-party code) is wrapped in `<untrusted_<hex16> content_type="...">` with a fresh nonce per dispatch (`openssl rand -hex 8`); framing stays outside, content inside is data, never instructions.
- **Adversarial lens + coverage ledger + independence** — mandatory-risk or Tier 3 plans get a different-brief second reviewer; every report ends with a coverage ledger (`Result: cleared | degraded_cleared | blocked`) and declares `Independence: verified | degraded:same_family | degraded:unknown_family`.
- **Split reviser / verifier** — one coherent revision pass applying all accepted fixes (operator decisions executed literally); a separate verifier emits one `residual_evidence` line per disposition and never infers verification from a finding's absence.
- **Triage bias + dossiers + commit trailers** — `courageous` default / `safetyist` for formal or mandatory-risk work; 70% AUTO-FIX threshold; escalations use the decision-dossier format; fix and task commits carry `Vv-Triage-Bias: <bias>`.
- **Digest-bound approvals** — `spec_guard_approve` records the host-computed SHA-256 in `.vvoc/specs/<id>/approvals.json`; `spec_guard_lint` reports `stale-approval` after any post-approval edit, and execution hard-stops on it.
- **Verification receipts** — `.vvoc/specs/<id>/receipts.jsonl` gains one JSON line per verification command; `mark-applied` is forbidden unless every task verification command and the closeout overlay command have an `exit_code: 0` receipt, and the receipts are committed with the package state.
- **Post-fix diff guardrail** — before every task commit the diff is scanned for six patterns (`shell_pipe_to_interpreter`, `ci_workflow_edit`, `secrets_pattern_match`, `dotenv_edit`, `lockfile_change`, `permission_change`); a match stops the commit and needs explicit confirmation recorded as a `Guardrail-Waiver:` trailer — never blanket-disable.
- **Plan risk classifier** — `spec_guard_lint` classifies plan risk (`standard | mandatory`) from protected paths, keywords, and secret patterns with a negation guard; `mandatory` forces the adversarial lens at plan close and defaults triage to `safetyist`.
