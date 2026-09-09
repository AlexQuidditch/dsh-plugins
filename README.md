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
| `dsh-vv-analytics` | AnalyticsPlugin vv-opencode: локальная JSONL-телеметрия каждого шага модели (`~/.dsh/vv-analytics/usage-YYYY-MM.jsonl`) + живой индикатор «кэш NN%» в шапке сессии. |
| `dsh-vv-peak-hours` | PeakHoursPlugin vv-opencode: хост-гейт вызовов модели в пиковые часы провайдера — режимы `soft` (warn в лог) и `hard` (блок ошибкой `PEAK_HOURS_BLOCK`). |
| `dsh-vv-spec-guard` | SpecGuardPlugin vv-opencode: детерминированный линтер `.vvoc` spec/plan XML (идентичности, зависимости, статусы) + вердикты при чтении файлов. |

## CLI

| Пакет | Что делает |
| --- | --- |
| `vvoc` | CLI-порт `vvoc`: `install`/`sync`/`status` (пресет vv-controller), `lint` (проверка `.vvoc`-артефактов), `analytics cache-hit-rate` (агрегация JSONL), `role`/`preset` (модельные роли). Zero-deps, ставится `npm link` / `node vvoc/lib/bin.js`. |

## Пресеты

| Директория | Что это |
| --- | --- |
| `vv-controller` | Агент-пресет: порт [vv-opencode](https://github.com/osovv/vv-opencode) на DSH — spec → plan → execute с review-гейтами, `.vvoc`-артефактами и скиллами `vv-spec`, `vv-plan`, `vv-execute`, `vv-review`, `vv-reflect`, `vv-handoff`. |

Пресет — это не бандл: он ставится копированием в пользовательский root DSH:

```bash
scripts/install-vv-controller.sh            # установить в ~/.dsh/.agent-presets/vv-controller
scripts/install-vv-controller.sh --force    # перезаписать (старая копия → .bak-<timestamp>)
```

После установки создайте в веб-интерфейсе новую сессию и выберите пресет `vv-controller`. Проверка: в каталоге скиллов сессии должны появиться шесть `vv-*` скиллов. Обновление пресета — `--force` и новая сессия (пресет читается при старте сессии).

Состав пресета:

- `agent.cordis.yml` — копия shipped-пресета `cordis` минус self-modification-инструменты, с персоной-политикой vv-controller (маршрутизация: прямое изменение / расследование / spec → plan → execute);
- `skills/*/SKILL.md` — шесть скиллов рабочего процесса; роли ревьюеров и имплементера живут как самодостаточные промпты суб-агентов внутри `vv-execute`/`vv-review` (в DSH нет реестра именованных агентов — роли spawn'ятся через `subagent`);
- артефакты совместимы с vv-opencode: `.vvoc/specs/YYYY-MM-DD-<slug>/{spec,plan,design-context}.xml`, `archive/`, `.vvoc/lessons`, `.vvoc/runbooks`, `.vvoc/handoff` — те же пути и XML-формат, так что один проект можно вести и из OpenCode, и из DSH.

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
dsh plugin --profile web add dsh-vv-analytics
dsh plugin --profile web add dsh-vv-peak-hours
dsh plugin --profile web add dsh-vv-spec-guard

# пресет vv-controller + CLI:
./scripts/install-vv-controller.sh
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
