# dsh-vv-peak-hours

Порт PeakHoursPlugin из vv-opencode: хост-гейт вызовов модели в пиковые часы провайдера.

## Что делает

Слушает водопад `llm/stream` первым (`{ prepend: true, global: true }`) и сверяет `options.provider` с расписаниями:

- **soft** (по умолчанию): вызов проходит, в лог пишется `PEAK_HOURS`-предупреждение;
- **hard**: вызов отклоняется ошибкой `PEAK_HOURS_BLOCK: provider "deepseek" is in peak hours until …` до всякой работы адаптера.

Окна — `HH:MM` в явном tz (по умолчанию UTC), могут пересекать полночь, опционально `days` (0=вс..6=сб). Матчатся **провайдеры**, не модели; неизвестный провайдер и битое окно — fail-open (warn, никогда не блок). Дефолтное расписание DeepSeek: 01:00–04:00 и 06:00–10:00 UTC (как у индикатора `dsh-peak-indicator`).

## Матчинг провайдеров: ключ — семейство, а не id рантайма

Ключ расписания называет **семейство** и покрывает все варианты маршрута:

```yaml
schedules:
  deepseek:            # покрывает deepseek, deepseek-official, deepseek-vision
    windows: [...]
```

Правило разрешения (`resolveSchedule`):

1. **точный ключ** выигрывает всегда — вариант может нести свои окна и свой `mode`
   (`deepseek-vision: {...}` перекроет семейное `deepseek` только для vision-маршрута);
2. иначе матчится **самый длинный** ключ, являющийся префиксом id по разделителю `-`
   (`deepseek` → `deepseek-official`, но `deep` ≠ `deepseek` и `deepseek` ≠ `deepseekish`);
3. иначе расписания нет — гейт открыт, как для неизвестного провайдера.

Это важно, потому что конфиг и рантайм называют провайдера по-разному: расписание
пишется как `deepseek`, а `options.provider` приходит как `deepseek-official`.
При точном матчинге гейт не срабатывал **никогда**.

## Как включить блокировку

`soft` только пишет предупреждение в лог хоста (`ctx.logger.warn`) — то есть в вывод
процесса `dsh web`; отдельного файла лога у хоста нет. Чтобы вызовы действительно
отклонялись, поставьте `mode: hard` (глобально или на конкретное семейство):

```yaml
config:
  enabled: true
  mode: hard
```

В `hard` вызов падает ошибкой `PEAK_HOURS_BLOCK: provider "deepseek-official" is in
peak hours until 04:00 UTC (elevated pricing); …` до всякой работы адаптера — это
видно прямо в чате.

## Конфиг (cordis.patch.yml бандла)

```yaml
config:
  enabled: true
  mode: soft            # или hard
  schedules:
    deepseek:
      windows: [{ start: "01:00", end: "04:00", tz: "UTC" }, { start: "06:00", end: "10:00", tz: "UTC" }]
```

## Тест

```bash
pnpm install --store-dir ../.pnpm-store --offline
pnpm run build
node activation.test.mjs   # юнит-кейсы движка + soft/hard/unknown через водопад
```
