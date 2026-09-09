# dsh-vv-spec-guard

Порт SpecGuardPlugin из vv-opencode: детерминированная проверка `.vvoc` spec/plan XML-артефактов кодом, а не дисциплиной модели.

## Что делает

- **Линтер** (`lib/lint.js`, чистый, без зависимостей): well-formed XML, статусы `draft|approved|applied`, уникальные идентичности `<COMPONENT-UPPER-KEBAB>` / `<TASK-T-NNN>` / `<WAVE-N>`, ссылки волн и `depends_on`, циклы зависимостей, полнота approved-документов, правило «компоненты плана ⊆ компонентам спеки».
- **Пробный тул `spec_guard_lint`** для модели: передай путь к `spec.xml`/`plan.xml` или к пакету `.vvoc/specs/YYYY-MM-DD-<slug>/` — получишь вердикт (для plan.xml подхватывается sibling spec.xml).
- **Лог-вердикты** при наблюдении spec-файлов через `fs/observed` (событие уведомительное: результат тула оно менять не может, поэтому явный тул — основной канал).

## Установка

```bash
dsh plugin --profile web add dsh-vv-spec-guard   # + перезапуск dsh web
```

## Тест

```bash
pnpm install --store-dir ../.pnpm-store --offline
pnpm run build
node activation.test.mjs   # 20+ юнит-кейсов линтера + активация и пробный тул
```

Тот же движок переиспользует CLI `vvoc lint` (пакет `vvoc`).
