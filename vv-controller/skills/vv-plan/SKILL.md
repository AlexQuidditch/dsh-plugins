---
name: vv-plan
description: "Превращает утверждённый spec.xml в поуровневый план реализации plan.xml: задачи, контракты, зависимости и acceptance-критерии. Используй только после явного одобрения спеки."
whenToUse: В .vvoc/specs лежит spec.xml со status="approved", и пользователь хочет его реализовать.
---

# vv-plan

Второй шаг конвейера vv-opencode: из утверждённой спеки — план, из плана — исполнение. Пока план не утверждён, никаких правок кода.

## Предусловия

- Найди утверждённый пакет: `grep -l 'status="approved"' .vvoc/specs/*/spec.xml`. Если несколько — спроси пользователя, какой пакет планируем.
- Если спеки нет или она `draft` — остановись и направь в `vv-spec`.

## Шаг 1: изучи код (только чтение)

- Прочитай spec.xml целиком.
- Исследуй репозиторий: зоны кода из `<COMPONENT-*>`, текущие тесты, конвенции, CI. Не мутируй ничего.

## Шаг 2: plan.xml

Запиши `.vvoc/specs/<package>/plan.xml` со `status="draft"`:

```xml
<plan package="YYYY-MM-DD-<slug>" status="draft">
  <meta>
    <created_at>YYYY-MM-DD</created_at>
    <source_spec>YYYY-MM-DD-<slug></source_spec>
  </meta>
  <architecture>
    <COMPONENT-CACHE-STORE>Как именно меняется эта зона: файлы, интерфейсы, границы.</COMPONENT-CACHE-STORE>
  </architecture>
  <waves>
    <WAVE-1>
      <task_id>TASK-T-001</task_id>
      <task_id>TASK-T-002</task_id>
    </WAVE-1>
  </waves>
  <tasks>
    <TASK-T-001>
      <title>Короткое императивное название</title>
      <component>cache-store</component>
      <files>
        <file>src/cache/store.ts</file>
      </files>
      <contract>Что именно изменится: сигнатуры, схемы, поведение, формат данных.</contract>
      <depends_on>
        <task_id>TASK-T-000</task_id>
      </depends_on>
      <acceptance>
        <criterion>Проверяемый критерий готовности задачи.</criterion>
      </acceptance>
      <verify>
        <command>pnpm --filter=@x/y test store</command>
      </verify>
    </TASK-T-001>
  </tasks>
</plan>
```

Правила:

- **Идентификаторы компонентов берутся из spec.xml как есть.** Компонент плана без компонента спеки — ошибка; вводить новые компоненты нельзя.
- Задачи — `TASK-T-NNN`, волны — `WAVE-N`; уникальны, ссылки `<task_id>` — на существующие задачи; циклов зависимостей быть не должно.
- `<verify>` — конкретные команды проверки (тесты, typecheck, lint). Каждая задача обязана иметь хотя бы один criterion и один verify.
- План покрывает ВСЕ acceptance-критерии спеки; критерии спеки в плане могут только детализироваться, не теряться.
- Поля `snake_case`; XML остаётся grep-able (`grep '<TASK-T-'`, `grep '<criterion>'`).

## Шаг 3: одобрение

- Запиши `plan.xml` (`status="draft"`), затем вызови `ask_user_question` с резюме (число задач/волн, ключевые решения) и вариантами `Approve` / `Edit` / `Redo`.
- **Явное одобрение обязательно.** Разговорное согласие — не одобрение.
- `Approve` → перепиши `status="approved"` и предложи `vv-execute`.
- `Edit` / `Redo` → правки, перезапись, снова вопрос.

## Шаг 4: выход

Утверждённый план — единственный вход в `vv-execute`. Сам не реализуешь ни строчки в рамках этого скилла.
