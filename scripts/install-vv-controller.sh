#!/usr/bin/env bash
# Установка пресета vv-controller в пользовательский root DSH.
# Использование:
#   scripts/install-vv-controller.sh          # установить (откажется перезаписывать)
#   scripts/install-vv-controller.sh --force  # перезаписать (старая копия — в .bak-<timestamp>)
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$repo_root/vv-controller"
dest_root="${DSH_HOME:-$HOME/.dsh}/.agent-presets"
dest="$dest_root/vv-controller"

if [[ ! -f "$src/agent.cordis.yml" || ! -f "$src/preset.yml" ]]; then
  echo "Ошибка: исходный пресет не найден в $src" >&2
  exit 1
fi

mkdir -p "$dest_root"

if [[ -e "$dest" ]]; then
  if [[ "${1:-}" == "--force" ]]; then
    backup="$dest.bak-$(date +%Y%m%d-%H%M%S)"
    mv "$dest" "$backup"
    echo "Старая копия перемещена в $backup"
  else
    echo "Пресет уже установлен: $dest" >&2
    echo "Для перезаписи запустите: $0 --force" >&2
    exit 1
  fi
fi

cp -R "$src" "$dest"

echo "Установлено: $dest"
echo "Дальше: в веб-интерфейсе DSH создайте новую сессию и выберите пресет «vv-controller»."
echo "Проверка: в сессии должен появиться скилл-каталог с vv-spec, vv-plan, vv-execute, vv-review, vv-reflect, vv-handoff."
