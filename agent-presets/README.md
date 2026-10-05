# dsh-agent-presets

Two custom agent presets for DeepSeek Harness, delivered as one **bundle**:

| Preset id | Что это |
| --- | --- |
| `vv-controller` | Порт vv-opencode: spec → plan → execute с review-гейтами. Персона несёт vv work policy, шесть скиллов `vv-spec` / `vv-plan` / `vv-execute` / `vv-review` / `vv-reflect` / `vv-handoff` едут внутри этого пакета, субагенты пришпилены к `deepseek-official/deepseek-flash` (effort max). |
| `standard-browser` | Штатный `standard`-агент плюс инструмент `subagent_browser`: браузерные субагенты с доступом только к `chrome_*`, каждый в своём окне Chrome. |

## Установка

```bash
dsh plugin --profile web add ~/projects/dsh-plugins/agent-presets
# или через plugin_manager: action=install_bundle, target=<абсолютный путь к agent-presets>
```

Затем **перезапустите `dsh web`**: строка пресета грузится на старте процесса. Новые сессии увидят пресеты в списке.

Проверка: создайте сессию с пресетом `vv-controller` — в каталоге скиллов должны появиться шесть `vv-*`; создайте сессию с `standard-browser` — в каталоге инструментов должен быть `subagent_browser`.

## Как это устроено

`cordis.patch.yml` вставляет две строки `@deepseek-ai/dsh-agent-preset` (`preset-vv-controller`, `preset-standard-browser`) в конфигурацию профиля. Каждый список `plugins` — это **текущий shipped-пресет того же семейства** (`cordis` и `standard` соответственно), поэтому все имена пакетов разрешаются в этой версии DSH, плюс дельты:

- `vv-controller` = shipped `cordis` − `tool-cordis` (self-modification — граница доверия для авторинга пресетов, а не часть рабочего агента) + vv-персона + пришпиленный маршрут субагентов + скиллы из `skills/`;
- `standard-browser` = shipped `standard` + строка `subagent_browser` с `toolFilter.allow` по `chrome_*` и `send_message`.

Скиллы подключаются через `skill-filesystem.customSkillDirs`; путь к ним вычисляется `!!js`-выражением от `baseUrl` через `createRequire(...).resolve('dsh-agent-presets/package.json')` — тот же идиом, которым shipped-пресет `cordis` подключает свои скиллы. `baseUrl` для строки bundle-патча — каталог профиля, поэтому пакет находится в `node_modules` профиля независимо от того, куда он установлен.

Правки, сохранённые из веб-редактора пресетов, перекрывают эти строки по id из `cordis.patch.yml` профиля, так что бандл остаётся слоем по умолчанию.

## Миграция с 0.1

До появления declaration-строк пользовательский пресет был каталогом `$DSH_HOME/.agent-presets/<id>/` с `preset.yml` + `agent.cordis.yml`. **В 0.2 этот каталог не читается никем**, поэтому после обновления оба пресета молча исчезли из ростера. Каталоги перенесены в `.agent-presets.retired-<timestamp>/` и могут быть удалены.

Заодно в старых копиях были две несовместимости с 0.2:

- обе ссылались на `@deepseek-ai/dsh-workflow-worker-thread`, у которого нет релиза 0.2 — активация упала бы даже при чтении каталога; в текущих shipped-шаблонах это `@deepseek-ai/dsh-workflow-ptc`;
- `standard-browser` пришпиливал модель `deepseek-v4-flash-vision-exp`, которой больше нет; заменено на `deepseek-official/deepseek-flash` (принимает изображения — проверено скриншотами), effort `max`.

Оба пресета наследуют `tool-ralph: disabled: true` из shipped-шаблонов 0.2. Если нужен ralph-цикл — уберите `disabled` у строки `tool-ralph`.
