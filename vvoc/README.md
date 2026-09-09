# vvoc

CLI-порт `vvoc` из vv-opencode для DeepSeek Harness. Zero runtime-зависимостей (только node builtins), TypeScript → `lib/`, бинарь `vvoc`.

## Команды

```bash
vvoc install [--force]        # пресет vv-controller → ~/.dsh/.agent-presets/
vvoc sync [--force]           # перезапись + проверка frontmatter скиллов
vvoc status                   # пресет, скиллы, каталог аналитики
vvoc lint [paths...] [--archive] [--strict]
                              # линт .vvoc spec/plan XML (exit 1 при ошибках)
vvoc analytics cache-hit-rate [--group-by day|week|month|session|model|provider] [--since Nd|Nw|Nm|YYYY-MM-DD] [--json]
vvoc role list | set <role> <provider/model> [--global] | unset <role> [--global]
vvoc preset list | show <name> | <name> [--global]
```

## Модельные роли

Роли (`default`, `smart`, `fast`, `reviewer`, любые lowercase-hyphenated) маппятся на `provider/model` в `./.vvoc/vvoc.json` (проект) или `~/.dsh/vv-vvoc.json` (машина, `--global`). Скиллы `vv-execute`/`vv-review` пресета читают карту при спавне суб-агентов. Пресеты — именованные наборы ролей в `{"presets": {...}}`, применяются атомарно.

## Линт

Предпочитает движок соседнего пакета `dsh-vv-spec-guard` (один источник истины); без него работает встроенный fallback с тем же контрактом вердиктов.

## Сборка и тесты

```bash
pnpm install --store-dir ../.pnpm-store --offline
pnpm run build
pnpm test          # node --test: 24 кейса (lint, analytics, roles/preset, install/sync)
```

Тесты используют фейковые `DSH_HOME`/cwd (`VVOC_TEST_*`) и не трогают реальный `~/.dsh`.
