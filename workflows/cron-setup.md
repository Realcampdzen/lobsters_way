---
description: Настройка cron-задач на Mac Mini для автоматизации SMM-рутины
---

# Cron Setup — Настройка автоматических задач

Запускай эти команды на Mac Mini через OpenClaw CLI.

## 1. Ежедневная SMM-проверка (12:00 MSK = 09:00 UTC)

```bash
openclaw cron add \
  --name "daily-smm-check" \
  --cron "0 9 * * *" \
  --message "Прочитай HEARTBEAT.md. Проверь ТГ-канал «Реальный Лагерь» на новые посты. Если есть посты без автокоммента — сгенерируй коммент по skills/tg-autocomment/SKILL.md, оцени по scoring. Если score ≥ 7 — опубликуй. Результат запиши в memory/YYYY-MM-DD.md. Если ничего нового — запиши 'SMM check: ничего нового'." \
  --session isolated
```

## 2. Еженедельный отчёт (воскресенье 20:00 MSK = 17:00 UTC)

```bash
openclaw cron add \
  --name "weekly-smm-report" \
  --cron "0 17 * * 0" \
  --message "Создай еженедельный SMM-отчёт по workflows/weekly-report.md. Прочитай daily notes за последние 7 дней. Создай файл memory/weekly/YYYY-WXX.md. Кратко (2-3 предложения) доложи Стёпе результат." \
  --session isolated
```

## 3. Рефлексия памяти (среда 03:00 MSK = 00:00 UTC)

```bash
openclaw cron add \
  --name "memory-reflection" \
  --cron "0 0 * * 3" \
  --message "Прочитай memory/YYYY-MM-DD.md за последнюю неделю. Обнови MEMORY.md значимыми инсайтами. Проверь mistakes.md — есть ли повторяющиеся паттерны? Если да — добавь правило в personality/anti_patterns.md. Проверь scoring-log.md — нужна ли калибровка threshold?" \
  --session isolated \
  --model google/gemini-2.5-flash
```

## 4. Проверка настройки

```bash
# Посмотреть все cron-задачи
openclaw cron list

# Проверить статус gateway
openclaw gateway status

# Логи в реальном времени
openclaw logs --follow
```

## 5. Удаление задачи

```bash
openclaw cron remove --name "daily-smm-check"
```

## Оптимизация

- **Дешёвая модель для рефлексии** — `google/gemini-2.5-flash` (меньше затрат на фоновые задачи)
- **Isolated sessions** — чтобы не засорять основной контекст
- **UTC время** — cron работает в UTC, MSK = UTC+3
