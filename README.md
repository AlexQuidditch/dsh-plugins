# dsh-plugins

Набор бандл-плагинов для DeepSeek Harness (`dsh`) и порт [vv-opencode](https://github.com/osovv/vv-opencode). Каждый бандл объявляет `dsh.bundle.patch`, поэтому устанавливается командой `dsh plugin add`. Собранные артефакты `lib/` уже закоммичены — **сборка не нужна**.

## Плагины

| Пакет | Что делает |
| --- | --- |
| `dsh-peak-hours` | Одна поверхность пиковых часов DeepSeek: индикатор в шапке сессии с поповером и переключателем «Разрешить работу в peak hours» + хост-гейт вызовов модели (`soft` — warn, `hard` — `PEAK_HOURS_BLOCK`). Расписание одно на оба: его рендерит пилюля и по нему решает `llm/stream`. Переключатель сохраняется в `$DSH_HOME/peak-hours.json`. Пришёл на смену `dsh-peak-indicator` + `dsh-vv-peak-hours`. |
| `hello-world` | Пример-песочница: `/hello` (host) + кнопка 👋 в строке действий сообщения. |
| `scope-router` | Автоподстановка файлов инструкций проекта по обнаруженной области (проект / домен / слой). |
| `dsh-vv-guardian` | Guardian-lite из vv-opencode: авто-одобрение рутинных низкорисковых песочниц-эскалаций (`workspace-write`); рискованное (`danger-full-access`) остаётся в ручном approval-флоу. |
| `dsh-vv-context` | `/context`-инспектор vv-opencode: кнопка в шапке сессии → панель с честной статистикой контекстного окна (токены по корзинам, давление на окно, разбивка состава). |
| `dsh-vv-spec-guard` | SpecGuardPlugin vv-opencode: детерминированный линтер `.vvoc` spec/plan XML (идентичности, зависимости, статусы) + вердикты при чтении файлов. |
| `dsh-managed-sessions` | Модельные инструменты для создания и ведения настоящих managed-сессий в workspace (`session_spawn` / `session_send` / `session_status` / `session_cancel`): самостоятельные root-сессии в сайдбаре с собственным жизненным циклом, а не субагенты. Рядом едет скилл `managed-sessions` — политика выбора между `subagent` и managed-сессией. |
| `dsh-halt-jobs` | Пилюля «остановить все фоновые задачи» в шапке сессии: показывает число живых задач сессии и гасит все `running`-задачи одним кликом. |
| `dsh-plugin-workspace-policy` | Per-workspace политика маршрута LLM: `.dsh/workspace.yaml` в корне воркспейса задаёт модель мастер-сессий, модель всех дочерних агентов и цепочку деградации; применяется на шве `agent/request`, не трогая глобальный `agent-default-model`. |
| `dsh-task-scheduler` | Persistent-планировщик задач: панель в Настройках, AI-задачи из `.md`, скрипты (`bun run`), cron с тикером 15 с и тул `task_trigger`. |
| `dsh-vv-panel` | Панель управления vv-циклом в Web-GUI: шесть кнопок `vv-spec`/`vv-plan`/`vv-execute`/`vv-review`/`vv-reflect`/`vv-handoff` в тулбаре композера между селектором доступа и Vision. Клик сразу отправляет жест скилла `/vv-<name>` (набранный в поле текст дописывается контекстом); видна только в сессиях с пресетом `vv-controller`. Чистый web-client плагин, host-половина — no-op. |

## Пресеты

| Директория | Что это |
| --- | --- |
| `agent-presets` | Бандл с двумя пользовательскими агент-пресетами: `vv-controller` (порт [vv-opencode](https://github.com/osovv/vv-opencode) — spec → plan → execute с review-гейтами, скиллы `vv-spec`/`vv-plan`/`vv-execute`/`vv-review`/`vv-reflect`/`vv-handoff`, `.vvoc`-артефакты) и `standard-browser` (штатный `standard` + браузерные субагенты через `subagent_browser`), плюс два служебных дочерних пресета `vv-worker` / `browser-subagent` для их субагентов. |

Пресет в 0.2 — это declaration-строка `@deepseek-ai/dsh-agent-preset` в патче бандла, а не каталог. Ставится как обычный бандл:

```bash
dsh plugin --profile web add ./agent-presets
# затем перезапуск dsh web: строка пресета грузится на старте процесса
```

Проверка: в списке пресетов все четыре карточки без бейджа «Failed to load»; новая сессия с пресетом `vv-controller` должна показать шесть `vv-*` скиллов в каталоге; сессия с `standard-browser` — инструмент `subagent_browser`.

Состав:

- `cordis.patch.yml` — четыре строки-декларации: два пользовательских пресета и два служебных дочерних, которые субагент-строки выбирают через `agentPreset` (в DSH 0.2.1 персона и тулсет ребёнка задаются только отдельным пресетом — `persona`/`toolFilter` в `tool-subagent` больше не принимаются); каждая список `plugins` — это текущий shipped-пресет того же семейства (`cordis` / `standard`) плюс дельты, поэтому имена пакетов не устаревают вместе с бандлом;
- `skills/*/SKILL.md` — шесть vv-скиллов; роли ревьюеров и имплементера живут как самодостаточные промпты суб-агентов внутри `vv-execute`/`vv-review` (в DSH нет реестра именованных агентов — роли spawn'ятся через `subagent`);
- артефакты совместимы с vv-opencode: `.vvoc/specs/YYYY-MM-DD-<slug>/{spec,plan,design-context}.xml`, `archive/`, `.vvoc/lessons`, `.vvoc/runbooks`, `.vvoc/handoff` — те же пути и XML-формат, так что один проект можно вести и из OpenCode, и из DSH.

Подробности миграции с 0.1 (старый `~/.dsh/.agent-presets/<id>/` больше не читается) — в `agent-presets/README.md`.

## Установка у коллеги

```bash
git clone https://github.com/AlexQuidditch/dsh-plugins.git
cd dsh-plugins

# бандлы (все или выборочно; `dsh plugin add` принимает путь к локальному пакету):
dsh plugin --profile web add ./dsh-peak-hours
dsh plugin --profile web add ./hello-world
dsh plugin --profile web add ./scope-router
dsh plugin --profile web add ./dsh-vv-guardian
dsh plugin --profile web add ./dsh-vv-context
dsh plugin --profile web add ./dsh-vv-spec-guard
dsh plugin --profile web add ./dsh-managed-sessions
dsh plugin --profile web add ./dsh-halt-jobs
dsh plugin --profile web add ./dsh-plugin-workspace-policy
dsh plugin --profile web add ./dsh-task-scheduler
dsh plugin --profile web add ./dsh-vv-panel
dsh plugin --profile web add ./agent-presets     # пресеты vv-controller + standard-browser

dsh web --host 127.0.0.1 --port 3080 --no-open   # перезапуск, чтобы подхватить бандлы
```

Примечания:

- `dsh plugin add` сам добавляет пакет в `dsh.profile.bundles` (ручная запись в `cordis.patch.yml` профиля не нужна). Аргументы после `add` уходят в pnpm, поэтому путь `./<dir>` — это локальный пакет, а голое имя — пакет из реестра (эти пакеты в npm не публикуются).
- Если `dsh` не на PATH — запустите через `pnpm dlx @deepseek-ai/dsh@0.2.1-rc.2 plugin --profile web add ...` или `node <путь-к-репо-deepseek-harness>/apps/cli/lib/bin.js plugin --profile web add ...`.
- После установки обязателен **один перезапуск** `dsh web`. Если на порту уже висит старый `dsh web`, сначала остановите его (Ctrl+C / `kill <PID>`), иначе порт занят.
- Имя профиля (`--profile web`) подставьте своё, если ваша установка использует другое.

## Пересборка (необязательно)

`lib/` закоммичены, поэтому на обычной установке сборка не нужна. Пересобрать можно не всё: исходники (`src/` + `tsconfig.json`) есть только у части пакетов.

- Клиентские бандлы (`hello-world`, `dsh-halt-jobs`, `dsh-vv-context`) требуют чекаут исходников DSH, лежащий сестринской папкой: их `tsdown.config.ts` импортирует `../../deepseek-harness/packages/client/tsdown.client.ts`.
- Серверные `scope-router`, `dsh-vv-guardian`, `dsh-vv-spec-guard` собираются обычным `tsc`; `dsh-plugin-workspace-policy` — `tsdown` (+ тесты `vitest`).
- У `dsh-peak-hours`, `dsh-task-scheduler`, `dsh-managed-sessions` и `agent-presets` исходников в репозитории нет — только готовые `lib/`; в репозитории они не пересобираются.

```bash
# клиентские (нужен сестринский чекаут DSH):
cd hello-world        && pnpm install && pnpm run build
cd ../dsh-halt-jobs   && pnpm install && pnpm run build
cd ../dsh-vv-context  && pnpm install && pnpm run build

# серверные:
cd ../scope-router && pnpm install && pnpm run build   # и так же dsh-vv-guardian, dsh-vv-spec-guard
cd ../dsh-plugin-workspace-policy && pnpm install && pnpm run build && pnpm test
```
