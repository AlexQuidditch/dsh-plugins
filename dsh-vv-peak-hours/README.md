# dsh-vv-peak-hours

Порт PeakHoursPlugin из vv-opencode: хост-гейт вызовов модели в пиковые часы провайдера.

## Что делает

Слушает водопад `llm/stream` первым (`{ prepend: true, global: true }`) и сверяет `options.provider` с расписаниями:

- **soft** (по умолчанию): вызов проходит, в лог пишется `PEAK_HOURS`-предупреждение;
- **hard**: вызов отклоняется ошибкой `PEAK_HOURS_BLOCK: provider "deepseek" is in peak hours until …` до всякой работы адаптера.

Окна — `HH:MM` в явном tz (по умолчанию UTC), могут пересекать полночь, опционально `days` (0=вс..6=сб). Матчатся **провайдеры**, не модели; неизвестный провайдер и битое окно — fail-open (warn, никогда не блок). Дефолтное расписание DeepSeek: 01:00–04:00 и 06:00–10:00 UTC (как у индикатора `dsh-peak-indicator`).

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
