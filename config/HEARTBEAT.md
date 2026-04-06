# HEARTBEAT.md — Периодические SMM-задачи

> Этот файл читается при каждом heartbeat-полле (каждые ~30 мин).
> Держи его компактным — экономь токены.

## Чеклист (ротация)

### При каждом heartbeat:
- [ ] Есть новые посты в ТГ-канале без автокоммента? → `skills/tg-autocomment/`
- [ ] Есть непрочитанные сообщения в ТГ от Стёпы? → ответить

### 2-4 раза в день:
- [ ] Проверить комменты подписчиков → нужен ли ответ? → `workflows/comment-reply.md`
- [ ] Нет ли негатива? → если есть, уведомить Стёпу

### 1 раз в день (утро):
- [ ] Записать daily note в `memory/YYYY-MM-DD.md`
- [ ] Проверить контент-план → `skills/content-calendar/`

## State Tracking

Используй `memory/heartbeat-state.json` чтобы не проверять одно дважды:

```json
{
  "lastChecks": {
    "tg_channel": 0,
    "tg_comments": 0,
    "daily_note": null,
    "content_plan": null
  },
  "lastPostCommented": null,
  "commentsToday": 0
}
```

## Тихие часы

- **23:00-08:00 MSK** → HEARTBEAT_OK (без проверок)
- Исключение: прямое сообщение от Стёпы

## Оптимизация

- Heartbeat использует дешёвую модель (настроить в openclaw.json)
- Не делать тяжёлых задач (анализ, генерация контента) — для этого есть cron
- Если ничего нового → HEARTBEAT_OK
