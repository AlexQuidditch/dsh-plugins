# dsh-scope-router

Host-плагин DeepSeek Harness: **автоматическое внедрение инструкций проекта по скоупу работы агента**.

Определяет, над чем работает агент — в каком проекте (`projectRoots`), в каком доменном
пакете (`packages/domains/<name>`) и на каком слое (backend/frontend) — по трём сигналам:

1. текст сообщения (упоминание домена / ключевые слова слоя);
2. файловая активность (`fs/observed`);
3. shell-активность (`tools/result` для `bash`/`pwsh`: `workdir` и пути в `command`).

При смене скоупа перед шагом модели внедряется бандл инструкций: ядро (`coreFiles`) +
доменный файл (`domainCandidates`) + послойные карты (`layerFiles`). Новая подборка
текстуально заменяет предыдущую. Вне проекта роутер бездействует.

## Сборка

```bash
pnpm install
pnpm run build        # tsc → lib/
node activation.test.mjs
```

## Установка в профиль

```bash
dsh plugin --profile web add ~/projects/dsh-plugins/scope-router
dsh --dump-config --profile web   # строка scope-router в дереве
# перезапустить dsh web
```

## Конфиг (в cordis.patch.yml пакета)

| Ключ | Описание |
| --- | --- |
| `projectRoots` | абсолютные корни проектов; без них плагин неактивен |
| `coreFiles` | root-относительные файлы ядра (всегда) |
| `layerFiles` | `{ backend: [], frontend: [] }` — послойные карты |
| `domainsDir` | каталог, поддиректории которого = домены |
| `domainCandidates` | шаблоны доменных файлов, `{domain}` заменяется именем |
| `maxBundleChars` | кап одного бандла (по умолчанию 80000) |
| `probeTool` | регистрировать отладочный тул `scope_router_status` |
| `log` | логировать инъекции |
