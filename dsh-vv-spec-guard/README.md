# dsh-vv-spec-guard

Порт SpecGuardPlugin из vv-opencode: детерминированная проверка `.vvoc` spec/plan XML-артефактов кодом, а не дисциплиной модели. Плюс три хост-инструмента из hive-контракта: digest-одобрения (§K), byte-evidence checker (§M) и классификатор риска плана (§N); проверка verification-receipts (§L) встроена в линт.

## Что делает

- **Линтер** (`lib/lint.js`, чистый, без зависимостей): well-formed XML, статусы `draft|approved|applied`, уникальные идентичности `<COMPONENT-UPPER-KEBAB>` / `<TASK-T-NNN>` / `<WAVE-N>`, ссылки волн и `depends_on`, циклы зависимостей, полнота approved-документов, правило «компоненты плана ⊆ компонентам спеки».
  - **§K**: для артефакта в статусе `approved` сверяет записанный digest с текущими байтами — error `stale-approval` (правка после одобрения) или warning `approval-unverified` (записи нет; backward-compatible для старых пакетов). Статус `applied` digest не проверяет: переход approved→applied — собственный флип executor'а (mark-applied), исполнение потребило clearance, а контентные правки applied-пакета вне окна guard'а (пакет терминален и сразу архивируется).
  - **§L**: для applied-плана (или при `checkReceipts: true`) требует по receipts-записи с `exit_code: 0` на каждую verification-команду — error `receipt-missing` / `receipt-failed`.
- **§N risk-классификатор** (`classifyPlanRisk`, `lib/lint.js`): по сырому тексту plan.xml выдаёт `standard | mandatory` + причины; хост печатает строку `risk: standard` или `risk: mandatory (<category>: <evidence>)` после вердикта plan.xml.
- **Тул `spec_guard_lint`** для модели: путь к `spec.xml`/`plan.xml` или к пакету `.vvoc/specs/YYYY-MM-DD-<slug>/` — вердикт (для plan.xml подхватывается sibling spec.xml, sidecar-файлы пакета читаются хостом). Путь можно давать абсолютным или относительным: относительный разрешается от текущего рабочего каталога сессии (`fs.resolve(path, { cwd })`).
- **Тул `spec_guard_approve`** (§K): хост сам считает SHA-256 сырых байтов approved-артефакта и пишет запись в `<package>/approvals.json`. Принимает файл или директорию пакета (тогда одобряются оба существующих артефакта).
- **Тул `spec_guard_evidence`** (§M): побайтовая проверка evidence anchor (`path`, `start_line`, `end_line`, `excerpt`) с вердиктами `MATCH | MISMATCH | OUT_OF_RANGE | UNREADABLE` и `anchor_digest`.
- **Лог-вердикты** при наблюдении spec-файлов через `fs/observed` (событие уведомительное: результат тула оно менять не может, поэтому явные тулы — основной канал).

## Sidecar-файлы пакета

### `approvals.json` (§K)

Пишется только хост-тулом `spec_guard_approve`; последняя запись на артефакт побеждает (история других артефактов сохраняется):

```json
{
  "approvals": [
    {
      "artifact": "plan.xml",
      "sha256": "<hex64>",
      "status_at_approval": "approved",
      "approved_at": "<ISO-8601>"
    }
  ]
}
```

- Тул пишет digest только если top-level status артефакта — `approved`; иначе типизированный отказ `status must be approved, found X` и файл не меняется.
- `spec_guard_lint` (в режиме пакета и одиночного файла): status `approved` + digest совпал → ok; digest не совпал → **error `stale-approval`**; записи нет → **warning `approval-unverified`**. Статус `applied` сверкой digest не считается устаревшим: approved→applied — легальный флип executor'а, исполнение потребило очистку (см. §K выше).
- `stale-approval` — жёсткий стоп для vv-execute: артефакт менялся после одобрения, нужно повторное `spec_guard_approve`.

### `receipts.jsonl` (§L)

Одна JSON-строка на каждую выполненную verification-команду; пишет executor-сессия (не плагин). Поля контракта: `ts`, `task_id`, `ac_id`, `command`, `exit_code`, `output_digest`, `output_tail`, `head_oid`, `provenance`.

```json
{"ts":"<ISO-8601>","task_id":"T-001","ac_id":"AC-002","command":"pnpm test","exit_code":0,"output_digest":"<sha256 hex>","output_tail":"...","head_oid":"<git rev-parse HEAD>","provenance":"executor"}
```

- Линт читает файл, если он есть; битые строки пропускаются с warning `receipt-malformed`.
- Проверка включается для плана в статусе `applied` (или при явном `checkReceipts: true`): каждая команда из `<verification><command>` (unique-tag план) и legacy `<verify><command>` должна иметь строку с тем же `command` (trim) и `exit_code: 0`. Нет строки вообще → error `receipt-missing`; строки есть, но ни одной с exit 0 → error `receipt-failed`.
- Для draft/approved без явного запроса receipts не проверяются.

## Форматы артефактов

Плагин встречает два поколения vv-артефактов:

- **legacy (атрибутный)**: `status` — атрибут корневого элемента, идентичности `COMPONENT-UPPER-KEBAB` / `TASK-T-NNN` / `WAVE-N`. Для него работают все структурные правила линтера (well-formed, идентичности, ссылки, циклы, полнота).
- **unique-tag (текущие шаблоны preset'ов)**: `status` — прямой дочерний элемент `<status>`, идентичности `C-*` / `T-NNN` / `wave-N`, `<verification><command>` вместо `<verify><command>`. Его структуру валидирует preset, поэтому legacy-правила полноты на нём молчат (иначе — только ложные срабатывания); при этом формат-независимые §K (approval digest), §L (receipts) и §N (risk) применяются к обоим форматам.

`spec_guard_approve` принимает `status` в обоих видах. §L-требование receipts для applied-планов действует и на legacy-пакеты: если у старого applied-плана нет `receipts.jsonl`, линт покажет `receipt-missing` (это и есть цель контракта — «applied» без доказательств больше не считается закрытым).

## Классификатор риска плана (§N)

`classifyPlanRisk(text)` — чистая функция в `lib/lint.js`; хост вызывает её для plan.xml и печатает дополнительную строку после вердикта:

```
risk: mandatory (auth_secrets_permissions: src/auth/guard.ts)
risk: standard
```

Категории (порядок фиксирован): `auth_secrets_permissions`, `destructive_data_schema`, `public_compatibility`, `concurrency_recovery_ownership`, `deployment_release_supply_chain`.

Сигналы:
- объявленные `<file>`/`<path>` и path-подобные токены против защищённых glob'ов: migrations (`*migration*`, `*.sql`, `drizzle/*`), auth/secret (`**/auth**`, `**/secret**`, `**/*permission*`, `.env*`), CI (`.github/workflows/*`, `.gitlab-ci.yml`), lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `Gemfile.lock`), deploy/release (`Dockerfile`, `*deploy*`, `*release*`);
- ключевые слова категорий по всему тексту (auth/authenticate/authorize/permission/role/token/password/credential; drop/delete/truncate/migrate/schema change/data loss; breaking change/public API/deprecate/export change; race/lock/mutex/queue/retry/ownership/lease; dependency/upgrade package/publish/release/supply chain);
- литеральные секреты где угодно: `AKIA[0-9A-Z]{16}`, `ghp_[A-Za-z0-9]{20,}`, `-----BEGIN … PRIVATE KEY-----`.

Один подтверждённый сигнал → `mandatory` (обязателен adversarial-lens по §H, triage-биас по умолчанию `safetyist`), ноль сигналов → `standard`. Неразборчивый XML деградирует в `standard` с note.

Негация (v1): если в той же строке перед ключевым словом стоит `no`, `not`, `without`, `zero` или `never` — сигнал не срабатывает. Ограничение: нет разбора предложений и negация с другой строки не учитывается; negация в предыдущей клаузе той же строки может подавить реальный сигнал. Это документированное упрощение, а не полноценный NLP.

## Конфиг

Патч `cordis.patch.yml` (patch replaces the whole row config, поэтому все ключи перечислены):

```yaml
- insert:
  - id: vv-spec-guard
    name: "dsh-vv-spec-guard"
    config:
      enabled: true
      probeTool: true       # spec_guard_lint
      approveTool: true     # spec_guard_approve (§K)
      evidenceTool: true    # spec_guard_evidence (§M)
      verdictMaxChars: 200  # cap одной лог-строки вердикта
```

## Установка

```bash
dsh plugin --profile web add ~/projects/dsh-plugins/dsh-vv-spec-guard   # + перезапуск dsh web
```

## Тест

```bash
pnpm install --store-dir ../.pnpm-store   # общий кэш репозитория; первый раз скачает devDeps из npm
pnpm run build
node activation.test.mjs   # 70+ юнит-кейсов линтера/риск-классификатора/receipts/approval/evidence + активация и все три тула
```

`e2e-relative-path.mjs` — отдельный end-to-end прогон `spec_guard_lint` по реальным пакетам `.vvoc/specs` (нужен путь `~/projects/foundation`, указан внутри скрипта).

Движок доступен только через тулы: отдельного CLI в комплекте нет (пакет `vvoc` с `vvoc lint` удалён из репозитория — линтер встроен в плагин).
