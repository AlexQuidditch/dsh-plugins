# dsh-agent-presets

Two user-facing custom agent presets for DeepSeek Harness — plus the two child presets their subagent tools compose — delivered as one **bundle**:

| Preset id | Что это |
| --- | --- |
| `vv-controller` | Порт vv-opencode: spec → plan → execute с review-гейтами. Персона несёт vv work policy, шесть скиллов `vv-spec` / `vv-plan` / `vv-execute` / `vv-review` / `vv-reflect` / `vv-handoff` едут внутри этого пакета, субагенты пришпилены к `deepseek-official/deepseek-flash` (effort max). Модель исполнения фиксирована во всём пресете и не выбирается: после утверждения плана vv-plan не предлагает опций, а сразу передаёт в vv-execute, который выводит из репозитория манифест сессии-исполнителя (корень проекта, URL приложения, статус reverse-proxy/caddy, команды старта, креды `AGENTS.md`, каталог `.agents/e2e/scenarios`), подтверждает его у пользователя и делегирует исполнение отдельной managed-сессии (`session_spawn`, `zai/glm-5.3` effort max, промпт целиком на английском); диспетчеризация имплементации в самой сессии контроллера не предлагается — это только аварийный режим при недоступности `session_spawn` с явного одобрения пользователя. |
| `standard-browser` | Штатный `standard`-агент плюс инструмент `subagent_browser`: браузерные субагенты на `deepseek-flash`, каждый в своём окне Chrome. |
| `vv-worker` | **Служебный** пресет для детей `vv-controller`: персона-исполнитель (одна делегированная роль, без vv-роутинга), `time-context`, кодинг-набор `bash` / `fs` / `jobs` / `todo` / `web` / компакция и `tool-subagent-control` (чтобы ребёнок мог отправлять `send_message` родителю). Браузерная политика персоны несёт базовый PC-вьюпорт **1440×900** для тестов десктоп-версии и дисциплину чтения консоли браузера при отладке UI. Не выбирается для сессии вручную. |
| `browser-subagent` | **Служебный** пресет для детей `standard-browser`: браузерный контракт в персоне + `tool-subagent-control` для `send_message`; своих shell/fs/web-инструментов у детей нет, `chrome_*` приходят host-глобально из `dsh-plugin-chrome`. Окно Chrome сразу после открытия приводится к **1440×900** — базовый PC-вьюпорт по умолчанию для всех страниц и скриншотов. |

Служебные пресеты видны в ростере (в DSH 0.2.1 у пресета нет скрытого флага), но предназначены только для композиции детьми — их указывают в `agentPreset` строк `tool-subagent`.

## Установка

```bash
dsh plugin --profile web add ~/projects/dsh-plugins/agent-presets
# или через plugin_manager: action=install_bundle, target=<абсолютный путь к agent-presets>
```

Затем **перезапустите `dsh web`**: строка пресета грузится на старте процесса. Новые сессии увидят пресеты в списке.

Проверка: в списке пресетов все четыре карточки должны быть без бейджа «Failed to load». Создайте сессию с пресетом `vv-controller` — в каталоге скиллов должны появиться шесть `vv-*`; создайте сессию с `standard-browser` — в каталоге инструментов должен быть `subagent_browser`.

## Как это устроено

`cordis.patch.yml` вставляет четыре строки `@deepseek-ai/dsh-agent-preset` (`preset-vv-worker`, `preset-browser-subagent`, `preset-vv-controller`, `preset-standard-browser`) в конфигурацию профиля. Каждый список `plugins` — это **текущий shipped-пресет того же семейства** (`cordis` и `standard` соответственно), поэтому все имена пакетов разрешаются в этой версии DSH, плюс дельты:

- `vv-controller` = shipped `cordis` − `tool-cordis` (self-modification — граница доверия для авторинга пресетов, а не часть рабочего агента) − `tool-plugin-market` (оба тула правят композицию, рабочему агенту они не нужны) + vv-персона + пришпиленный маршрут субагентов + скиллы из `skills/` + делегирование в `vv-worker`;
- `standard-browser` = shipped `standard` − `tool-plugin-market` + строка `subagent_browser`, выбирающая дочерний пресет `browser-subagent`.

`time-context` и `tool-schedule` берутся из shipped-шаблонов 0.2.1 как есть — контроллеру нужна дата для `YYYY-MM-DD`-идентификаторов spec-пакетов, а планировщик доступен как обычный тул.

### Дети — это отдельные пресеты (DSH 0.2.1)

В 0.2.1 `@deepseek-ai/dsh-tool-subagent` больше не принимает `persona` и `toolFilter` — строка падает при загрузке: «persona is no longer supported; configure persona and tool plugins in an Agent Preset and select it with agentPreset (spawn only)». Поэтому персона и набор инструментов ребёнка живут в собственных пресетах `vv-worker` / `browser-subagent`, а родительские строки ссылаются на них через `agentPreset: <id>`. Следствия:

- `toolFilter` замены не имеет. Прежняя гарантия «у браузерного ребёнка только `chrome_*`» невыразима: `dsh-plugin-chrome` монтирует один host-ряд, поэтому `chrome_*` видны всем агентам; дочерний пресет лишь не даёт ребёнку shell/fs/web-инструментов.
- `backgroundMode` тоже исчез — дети continuable по умолчанию, отдельное поле не нужно.
- **Мессенджер детей сохраняется явно**: ребёнок, который наследует родительский пресет, получает `send_message` из группы `delegation`; у независимого дочернего пресета её нет, поэтому `vv-worker` и `browser-subagent` монтируют `tool-subagent-control` сами. Иначе runtime не вставляет ребёнку инструкцию «отправь результат родителю», и `subagent`-описание теряет канал mid-flight-сообщений.
- Дочерние пресеты объявлены раньше родительских: строка `tool-subagent` проверяет `agentPreset` при монтировании и должна видеть объявление.

Скиллы подключаются через `skill-filesystem.customSkillDirs`; путь к ним вычисляется `!!js`-выражением от `baseUrl` через `createRequire(...).resolve('dsh-agent-presets/package.json')` — тот же идиом, которым shipped-пресет `cordis` подключает свои скиллы. `baseUrl` для строки bundle-патча — каталог профиля, поэтому пакет находится в `node_modules` профиля независимо от того, куда он установлен.

Правки, сохранённые из веб-редактора пресетов, перекрывают эти строки по id из `cordis.patch.yml` профиля, так что бандл остаётся слоем по умолчанию.

## Миграция с 0.1

До появления declaration-строк пользовательский пресет был каталогом `$DSH_HOME/.agent-presets/<id>/` с `preset.yml` + `agent.cordis.yml`. **В 0.2 этот каталог не читается никем**, поэтому после обновления оба пресета молча исчезли из ростера. Каталоги перенесены в `.agent-presets.retired-<timestamp>/` и могут быть удалены.

Заодно в старых копиях были две несовместимости с 0.2:

- обе ссылались на `@deepseek-ai/dsh-workflow-worker-thread`, у которого нет релиза 0.2 — активация упала бы даже при чтении каталога; в текущих shipped-шаблонах это `@deepseek-ai/dsh-workflow-ptc`;
- `standard-browser` пришпиливал модель `deepseek-v4-flash-vision-exp`, которой больше нет; заменено на `deepseek-official/deepseek-flash` (принимает изображения — проверено скриншотами), effort `max`.

Все пресеты наследуют `tool-ralph: disabled: true` из shipped-шаблонов 0.2. Если нужен ralph-цикл — уберите `disabled` у строки `tool-ralph`.
