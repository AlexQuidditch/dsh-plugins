# dsh-plugins

Набор бандл-плагинов для DeepSeek Harness (`dsh`). Каждый пакет объявляет `dsh.bundle.patch`, поэтому устанавливается командой `dsh plugin add`. Собранные артефакты `lib/` уже закоммичены — **сборка не нужна**.

## Плагины

| Пакет | Что делает |
| --- | --- |
| `dsh-peak-indicator` | Индикатор в шапке сессии: пиковые часы DeepSeek API (01:00–04:00 и 06:00–10:00 UTC, пн–пт). Красное свечение в пик, обратный отсчёт до конца/начала пика; в подсказке — окно пика с пересчётом в местное время. |
| `hello-world` | Пример-песочница: `/hello` (host) + кнопка 👋 в строке действий сообщения. |
| `scope-router` | Автоподстановка файлов инструкций проекта по обнаруженной области (проект / домен / слой). |

## Установка у коллеги

```bash
git clone https://github.com/AlexQuidditch/dsh-plugins.git
cd dsh-plugins

# по одному плагину (или все три):
dsh plugin --profile web add dsh-peak-indicator
dsh plugin --profile web add hello-world
dsh plugin --profile web add scope-router

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
