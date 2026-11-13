# dsh-vv-panel

Панель управления рабочим циклом **vv-controller** в Web-GUI DeepSeek Harness:
шесть кнопок — `vv-spec` / `vv-plan` / `vv-execute` / `vv-review` / `vv-reflect` /
`vv-handoff` — в строке инструментов композера, между селектором доступа
(«Workspace Write») и правыми контролами (Vision / модель / отправка), плюс
седьмой чип **операционного состояния** активного пакета `.vvoc/specs/`.

Версия 0.2.0: чип состояния — v2 по контракту §P
(`hive-research/vv-contract-vocabulary.md`), живой, по реальным файлам
рабочей области; при недоступности моста — откат на v1-запрос к агенту
(см. ниже). Host-половина пакета остаётся no-op.

## Что делает

- Клик по кнопке **сразу отправляет** в сессию жест скилла `/vv-<name>` — тот же
  эффект, что набрать `/vv-plan` и нажать Enter: композерный пайплайн (адьюдация,
  queue-эхо, очистка черновика) отрабатывает штатно, а `dsh-tool-skill` на
  `agent/pre-step` инжектит контент скилла в шаг модели.
- Если в поле ввода уже набран текст, он **дописывается контекстом** после жеста:
  `/vv-plan\n\n<набранный текст>`. Инлайновые reference-чипы при этом
  разворачиваются в текст (ограничение `setDraft`).
- **Чип состояния** показывает состояние активного пакета `.vvoc/specs/`
  (словарь §P, см. ниже); клик отправляет контекстно правильный жест:
  `ready-to-execute`/`executing` → `/vv-execute`, `draft-plan` →
  `/vv-plan`, `draft-spec` → `/vv-spec` и т.д. Подсказка (`title`) содержит
  id пакета, состояние и следующий жест.
- Панель рендерится **только в сессиях с пресетом `vv-controller`** (читается
  проекция `agentPreset`); в остальных пресетах чипы не занимают места.
- Пока идёт отправка (`adjudicating`/`submitting`), кнопки блокируются.

## Операционное состояние (v2)

Закрытый словарь §P (`hive-research/vv-contract-vocabulary.md`), выводится из
файлов активного пакета:

| Состояние | Вывод |
|---|---|
| `draft-spec` | `spec.xml` есть, `status=draft`, интервью не завершено (нет `<goal>`/`<requirement>`) |
| `awaiting-spec-approval` | `spec.xml` draft + есть и `<goal>`, и `<requirement>` (эвристика §P) |
| `spec-approved` | `spec.xml` `approved`/`applied`, `plan.xml` отсутствует |
| `draft-plan` | `plan.xml` есть, `status=draft` |
| `ready-to-execute` | `plan.xml` `approved`, `receipts.jsonl` отсутствует/пуст |
| `executing` | `plan.xml` `approved`, `receipts.jsonl` непустой |
| `applied` | `plan.xml` `status=applied` |
| `stale-approval` | `approvals.json` содержит запись для `spec.xml`/`plan.xml`, чей `sha256` не совпадает с текущими байтами файла — **переопределяет любое другое состояние** (§K). Проверяется только статус `approved`: `applied` — легальный флип executor'а после исполнения, а не устаревание |
| `archived` | пакет в `.vvoc/specs/archive/` — такие каталоги исключаются из выбора активного |
| `no-package` | `.vvoc/specs/` отсутствует или в нём нет неархивных каталогов |

Правила вывода и сознательные упрощения (задокументированы, не скрыты):

- Статус читается из атрибута `status` корневого `<spec>`/`<plan>` (так его
  читает `spec_guard_lint`); поддерживается и элемент `<status>…</status>`.
  Отсутствующий статус = `draft` — как в lint-движке.
- `awaiting-plan-approval` **сворачивается в `draft-plan`**: §P требует
  lint-clean, а lint-движок живёт на host'е и браузеру недоступен.
- `awaiting-review` **сворачивается в `executing`**: §P сам определяет это
  состояние как v1-эвристику.
- `stale-approval` вычисляется через WebCrypto (`crypto.subtle.digest`);
  в безопасном контексте (localhost/127.0.0.1) он доступен. Если WebCrypto
  нет, устаревание не заявляется вовсе — состояние выводится без него.
- Активный пакет — **последний по имени** неархивный каталог `.vvoc/specs/`
  (соглашение об именах `YYYY-MM-DD-<slug>`, поэтому порядок имён = порядок
  возраста). Читается только он: ≤4 небольших файла за обновление
  (`spec.xml`, `plan.xml`, `approvals.json`, `receipts.jsonl`).
- Обновление чипа: при монтировании панели, при смене `sessionId` и на
  границе хода (когда `running` в Session-снапшоте меняется) — файлы меняются
  именно во время хода, поэтому граница хода и есть точка «живого» обновления.
  Опрос и `fs.watch` не используются.

### Никогда не выдумывать состояние

Клиент **не имеет доступа к файловой системе** и не извлекает состояние из
текста переписки. Все чтения выполняет Host через собственный Remote-мост
`workspaceFiles`; на клиент приходят уже прочитанные байты. Если мост
недоступен, доступ к ресурсу сессии запрещён, чтение упало или пакет
не распознан — **чип состояния не показывается как факт**: вместо него
рендерится откатный чип `state` (v1), который просто отправляет агенту
самодостаточный промпт и не заявляет никакого состояния. Явное `no-package`
показывается только при подтверждённом отсутствии неархивных пакетов.

## Откуда берётся состояние (мост)

Данные идут через Host-generated Remote namespace **`workspaceFiles`**
(`@deepseek-ai/dsh-api-workspace-files`, смонтирован в Web-сборке через
`@deepseek-ai/dsh-api-remotes`):

```js
ctx.remote.workspaceFiles.list(sessionId, '.vvoc/specs', signal)
ctx.remote.workspaceFiles.readBytes(sessionId, path, {}, signal)   // → Uint8Array
```

- **Обязательный inject.** Клиентский ctx — прокси, который не отдаёт
  undeclared-сервисы: `ctx.get('remote')` возвращает лицо, а доступ к
  `face.workspaceFiles` бросает `cannot get property "remote.workspaceFiles"
  without inject`. Этот throw приходит из React-effect и роняет весь slot-entry
  — то есть исчезает вся панель, а не только state-чип (именно так панель
  пропала в 0.2.0). Правильный паттерн (так делают все shipped client-плагины,
  вызывающие Remote): динамический
  `ctx.inject(['remote', 'remote.workspaceFiles'], (child) => ...)`, и лицо
  живёт только пока Remote-строки смонтированы. Без лица чип честно уходит в
  fallback-режим.
- На провод уходит **только sessionId**: корень рабочей области Host выводит
  из заголовка сессии, клиент не может подменить или задать путь-корень.
- Чтения read-only, ограничены по размеру и проверяются access-контролем
  peer'а; панель дополнительно гейтит их хуком
  `useAccess('workspaceFiles/list')` из стандартных props session-слота.
- Клиент складывает полученные байты в словарь §P (чистая функция
  `deriveOperationalState` в `client.js`), включая `stale-approval` по
  `approvals.json` из §K.

Хост-половина пакета при этом ничего не добавляет: см. следующий раздел,
почему вывод состояния не может жить в host-половине статического bundle.

## Откат (v1): точный промпт

Если живой мост недоступен, чип `state` (в ru-локали — «состояние») при клике
отправляет ровно этот текст (тем же механизмом `inputActions.setDraft` +
`submit`, с дописыванием набранного пользователем текста после пустой строки):

```
Operational-state check for this repository, with no assumptions about prior context.

Locate the active vv spec package: the latest non-archived directory under .vvoc/specs/ (skip .vvoc/specs/archive/). If none exists, report `operational-state: no-package` and stop.
Otherwise run the spec_guard_lint tool on that package directory (.vvoc/specs/<id>/) and read the package files: spec.xml, plan.xml, approvals.json, receipts.jsonl.
Then report exactly this, without editing any file:

operational-state: <one of: draft-spec, awaiting-spec-approval, spec-approved, draft-plan, awaiting-plan-approval, ready-to-execute, executing, awaiting-review, applied, stale-approval, archived, no-package>
package: <package path>
next: /<vv-spec|vv-plan|vv-execute|vv-review|vv-reflect|vv-handoff>
why: <one short line>

Rules: stale-approval overrides every other state (approvals.json digest mismatch reported by spec_guard_lint). Use only the state names above. If spec_guard_lint is unavailable, say so and report the state from the files you could read, marking the evidence you used.
```

Промпт самодостаточен: агент может не иметь никакого контекста сессии, но
получает путь, инструмент, закрытый словарь, формат ответа и запрет на правки.

## Почему состояние выводит не host-половина

Расследование API (cordis_inspect_list / cordis_inspect_query, host
`Service.listService`, точные контракты; клиентские провайдеры в этой сессии
недоступны — GUI требует аутентифицированный URL, поэтому клиентские типы
сверены по декларациям установленных пакетов):

| Что проверено | Вердикт |
|---|---|
| `workspaceFiles` (host Remote: `list`/`read`/`readBytes`/`stat`/`changes`) | **Выбран.** Client-callable, scope = sessionId, read-only, корень выводит Host. |
| `commands` (`@Remote list`/`execute`) | Host-половина могла бы регистрировать команду с выводом состояния, но `commands.execute` пишет `command/run` и `command/done` в лог сессии на каждое обновление — отвергнуто как загрязнение лога и шум в транскрипте. |
| `sessionProjections` + `wire.view` | Документированный канал host→client для значений, выводимых из сессии, но `init`/`apply`/`view` — чистые синхронные свёртки событий лога и не могут читать файловую систему; для файлового состояния непригоден. |
| `fs`, `workingDirectory` | Host-сервисы без client-callable поверхности; из браузера недостижимы. |
| `actionCards` (`@Remote act`) | RPC привязан к карточке-результату вызова инструмента; в композерном слоте карточки нет. |
| `webServer.register` + `fetch` | Плагин-собственный HTTP-маршрут со своей авторизацией — спекулятивная инфраструктура, не «поддерживаемый мост». Отвергнуто. |
| Client `Service`/`Slots` inspect-провайдеры | Таймаут: страница на `127.0.0.1:3080` отвечает «dsh web authentication required»; визуальная проверка в браузере в этой сессии невозможна. |

Ключевое ограничение: **у статически установленного bundle нет собственного
client-callable RPC между половинами**. Набор Client Remote фиксируется на
этапе сборки Web-приложения (`dsh-api-remotes`: «The capability set is fixed
by explicit build-time value imports; the Client does not discover the Host's
active Services or Remote definitions at runtime»), а `ctx.get('remote')`
даёт только эти сгенерированные namespace'ы. Поэтому host и выполняет все
чтения (через `workspaceFiles`), а клиент лишь складывает байты в §P; отдельная
host-половина не добавлялась — `package.json#files/exports` и
`cordis.patch.yml` не менялись.

## Как устроено

Web-client плагин: строка в `cordis.patch.yml` + браузерная половина
`client.js`, регистрирующая entry в аддитивный слот `conversation.input.left`
(компакт-контролы левой группы тулбара композера, `kind: list`,
`replaceRisk: none`, `scope: session`). Host-половина — no-op. Стили — только
токены темы `--dsw-alias-*`; тултипы и подписи — через клиентский
locale-сервис (словарь `vvPanel`, en/ru). Логика вывода состояния
(`deriveOperationalState`, `scanOperationalState`) — чистый JS без React/DOM.

Тюнинг (`TARGET_PRESET`, список скиллов, `SPECS_DIR`, `ARCHIVE_DIR`) —
константы в `client.js`; при частых правках имеет смысл вынести в Config
строки патча.

## Установка

```sh
dsh plugin --profile web add ./dsh-vv-panel
```

Проверка: в сессии с пресетом `vv-controller` в тулбаре композера между
«Workspace Write» и Vision появляются шесть компакт-чипов; в сессиях других
пресетов их нет. Клик отправляет сообщение `/vv-<name>` (видно в логе сессии
как обычное пользовательское сообщение, за которым идёт шаг модели с
загруженным скиллом). При наличии `.vvoc/specs/<id>/spec.xml` рядом появляется
чип состояния с id пакета и следующим жестом в подсказке.

## Проверено

- `node --check client.js`, `node --check index.js` — OK.
- `JSON.parse` для `locale/en.json`, `locale/ru.json` и `package.json` — OK.
- Чистая функция вывода состояния извлечена из `client.js` и прогнана на
  фикстурах: все выводимые состояния §P (`draft-spec`, `awaiting-spec-approval`,
  `spec-approved`, `draft-plan`, `ready-to-execute`, `executing`, `applied`,
  `stale-approval`), override `stale-approval` (совпадающий и
  несовпадающий дайджест, «последняя запись побеждает»), элементная форма
  статуса, невалидный статус → unknown, выбор последнего неархивного пакета,
  отсутствие `.vvoc/specs` → `no-package`, ошибки транспорта → `unavailable`.
- Фабрика плагина и рендер панели прогнаны со stub-React и stub-загрузчиком:
  регистрация локалей en+ru, слот `conversation.input.left`, шесть скилл-чипов,
  седьмой чип для каждого состояния, подсказки, отправляемые жесты
  (`/vv-execute`, `/vv-plan`, `/vv-spec`, откатный промпт), preset-гейт.
- **Визуальная проверка в браузере не выполнена**: GUI требует
  аутентифицированный URL (`dsh web authentication required`), браузерного
  контроля в этой сессии нет. Установка пакета в профиль также не выполнялась.
