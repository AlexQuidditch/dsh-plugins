# vvoc

CLI-порт `vvoc` из vv-opencode для DeepSeek Harness. Zero runtime-зависимостей (только node builtins), TypeScript → `lib/`, бинарь `vvoc`.

## Команды

```bash
vvoc install [--profile=<name>]   # бандл agent-presets → профиль (делегирует в dsh plugin add)
vvoc sync [--profile=<name>]      # то же + проверка frontmatter скиллов бандла
vvoc status [--profile=<name>]    # бандл в профиле, скиллы, каталог аналитики
vvoc lint [paths...] [--archive] [--strict]
                              # линт .vvoc spec/plan XML (exit 1 при ошибках)
vvoc analytics cache-hit-rate [--group-by day|week|month|session|model|provider] [--since Nd|Nw|Nm|YYYY-MM-DD] [--json]
vvoc role list | set <role> <provider/model> [--global] | unset <role> [--global]
vvoc preset list | show <name> | <name> [--global]
```

Профиль берётся из `--profile=<name>`, иначе из `$DSH_PROFILE`, иначе `web`.

## Пресеты

До 0.2 `vvoc install` копировал каталог пресета в `~/.dsh/.agent-presets/vv-controller`. Этот каталог больше **никем не читается**: пресет в 0.2 — это declaration-строка в патче бандла. Поэтому `install`/`sync` теперь делегируют в `dsh plugin --profile <p> add <repo>/agent-presets`, а `status` проверяет, что бандл реально перечислен в `dsh.profile.bundles` профиля (а не просто скопирован на диск).

После `install`/`sync` нужен перезапуск `dsh web` — строка пресета грузится на старте процесса.

## Модельные роли

Роли (`default`, `smart`, `fast`, `reviewer`, любые lowercase-hyphenated) маппятся на `provider/model` в `./.vvoc/vvoc.json` (проект) или `~/.dsh/vv-vvoc.json` (машина, `--global`). Скиллы `vv-execute`/`vv-review` пресета читают карту при спавне суб-агентов. Пресеты — именованные наборы ролей в `{"presets": {...}}`, применяются атомарно.

## Линт

Предпочитает движок соседнего пакета `dsh-vv-spec-guard` (один источник истины); без него работает встроенный fallback с тем же контрактом вердиктов.

## Сборка и тесты

```bash
pnpm install --store-dir ../.pnpm-store --offline
pnpm run build
pnpm test          # node --test: lint, analytics, roles/preset, install/sync
```

Тесты используют фейковые `DSH_HOME`/cwd (`VVOC_TEST_*`) и не трогают реальный `~/.dsh`.
