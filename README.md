# dsh-plugins

Набор бандл-плагинов для DeepSeek Harness (`dsh`) и порт [vv-opencode](https://github.com/osovv/vv-opencode). Каждый бандл объявляет `dsh.bundle.patch`, поэтому устанавливается командой `dsh plugin add`. Собранные артефакты `lib/` уже закоммичены — **сборка не нужна**.

## Плагины

| Пакет | Что делает |
| --- | --- |
| `dsh-peak-indicator` | Индикатор в шапке сессии: пиковые часы DeepSeek API (01:00–04:00 и 06:00–10:00 UTC, пн–пт). Красное свечение в пик, обратный отсчёт до конца/начала пика; в подсказке — окно пика с пересчётом в местное время. |
| `hello-world` | Пример-песочница: `/hello` (host) + кнопка 👋 в строке действий сообщения. |
| `scope-router` | Автоподстановка файлов инструкций проекта по обнаруженной области (проект / домен / слой). |
| `dsh-vv-guardian` | Guardian-lite из vv-opencode: авто-одобрение рутинных низкорисковых песочниц-эскалаций (`workspace-write`); рискованное (`danger-full-access`) остаётся в ручном approval-флоу. |
| `dsh-vv-context` | `/context`-инспектор vv-opencode: кнопка в шапке сессии → панель с честной статистикой контекстного окна (токены по корзинам, давление на окно, разбивка состава). |
| `dsh-vv-peak-hours` | PeakHoursPlugin vv-opencode: хост-гейт вызовов модели в пиковые часы провайдера — режимы `soft` (warn в лог) и `hard` (блок ошибкой `PEAK_HOURS_BLOCK`). |
| `dsh-vv-spec-guard` | SpecGuardPlugin vv-opencode: детерминированный линтер `.vvoc` spec/plan XML (идентичности, зависимости, статусы) + вердикты при чтении файлов. |
| `dsh-managed-sessions` | Модельные инструменты для создания и ведения настоящих managed-сессий в workspace (`session_spawn` / `session_send` / `session_status` / `session_cancel`): самостоятельные root-сессии в сайдбаре с собственным жизненным циклом, а не субагенты. Рядом едет скилл `managed-sessions` — политика выбора между `subagent` и managed-сессией. |

## CLI

| Пакет | Что делает |
| --- | --- |
| `vvoc` | CLI-порт `vvoc`: `install`/`sync`/`status` (ставит бандл `agent-presets` в профиль), `lint` (проверка `.vvoc`-артефактов), `analytics cache-hit-rate` (агрегация JSONL), `role`/`preset` (модельные роли). Zero-deps, ставится `npm link` / `node vvoc/lib/bin.js`. |

## Пресеты

| Директория | Что это |
| --- | --- |
| `agent-presets` | Бандл с двумя агент-пресетами: `vv-controller` (порт [vv-opencode](https://github.com/osovv/vv-opencode) — spec → plan → execute с review-гейтами, скиллы `vv-spec`/`vv-plan`/`vv-execute`/`vv-review`/`vv-reflect`/`vv-handoff`, `.vvoc`-артефакты) и `standard-browser` (штатный `standard` + браузерные субагенты через `subagent_browser`). |

Пресет в 0.2 — это declaration-строка `@deepseek-ai/dsh-agent-preset` в патче бандла, а не каталог. Ставится как обычный бандл:

```bash
dsh plugin --profile web add ~/projects/dsh-plugins/agent-presets
# затем перезапуск dsh web: строка пресета грузится на старте процесса
```

Проверка: новая сессия с пресетом `vv-controller` должна показать шесть `vv-*` скиллов в каталоге; сессия с `standard-browser` — инструмент `subagent_browser`.

Состав:

- `cordis.patch.yml` — две строки-декларации; каждая список `plugins` — это текущий shipped-пресет того же семейства (`cordis` / `standard`) плюс дельты, поэтому имена пакетов не устаревают вместе с бандлом;
- `skills/*/SKILL.md` — шесть vv-скиллов; роли ревьюеров и имплементера живут как самодостаточные промпты суб-агентов внутри `vv-execute`/`vv-review` (в DSH нет реестра именованных агентов — роли spawn'ятся через `subagent`);
- артефакты совместимы с vv-opencode: `.vvoc/specs/YYYY-MM-DD-<slug>/{spec,plan,design-context}.xml`, `archive/`, `.vvoc/lessons`, `.vvoc/runbooks`, `.vvoc/handoff` — те же пути и XML-формат, так что один проект можно вести и из OpenCode, и из DSH.

Подробности миграции с 0.1 (старый `~/.dsh/.agent-presets/<id>/` больше не читается) — в `agent-presets/README.md`.

## Установка у коллеги

```bash
git clone https://github.com/AlexQuidditch/dsh-plugins.git
cd dsh-plugins

# бандлы (все или выборочно):
dsh plugin --profile web add dsh-peak-indicator
dsh plugin --profile web add hello-world
dsh plugin --profile web add scope-router
dsh plugin --profile web add dsh-vv-guardian
dsh plugin --profile web add dsh-vv-context
dsh plugin --profile web add dsh-vv-peak-hours
dsh plugin --profile web add dsh-vv-spec-guard
dsh plugin --profile web add dsh-managed-sessions
dsh plugin --profile web add agent-presets     # пресеты vv-controller + standard-browser

# CLI:
npm link vvoc    # или node vvoc/lib/bin.js <cmd>

dsh web --host 127.0.0.1 --port 3080 --no-open   # перезапуск, чтобы подхватить бандлы
```

Примечания:

- `dsh plugin add` сам добавляет пакет в `dsh.profile.bundles` (ручная запись в `cordis.patch.yml` профиля не нужна).
- Если `dsh` не на PATH — запустите через `pnpm dlx @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web add ...` или `node <путь-к-репо-deepseek-harness>/apps/cli/lib/bin.js plugin --profile web add ...`.
- После установки обязателен **один перезапуск** `dsh web`. Если на порту уже висит старый `dsh web`, сначала остановите его (Ctrl+C / `kill <PID>`), иначе порт занят.
- Имя профиля (`--profile web`) подставьте своё, если ваша установка использует другое.

## Пересборка (необязательно)

`lib/` закоммичены, поэтому на обычной установке сборка не нужна. Для пересборки клиентских бандлов (`dsh-peak-indicator`, `hello-world`) нужен чекаут исходников DSH, лежащий сестринской папкой (пресет `packages/client/tsdown.client.ts` импортируется по относительному пути `../../deepseek-harness/...`):

```bash
cd dsh-peak-indicator && pnpm install && pnpm run build
cd ../hello-world        && pnpm install && pnpm run build
cd ../scope-router       && pnpm install && pnpm run build
```
