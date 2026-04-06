# 🐱 Кот Бро — SMM Агент «Реального Лагеря»

Портативный репозиторий для самонастройки SMM-агента Кота Бро. Содержит личность, память, навыки, workflows и базу знаний.

## Что внутри

```
├── identity/          # Кто ты (SOUL, IDENTITY, USER)
├── config/            # Как работать (AGENTS, HEARTBEAT, TOOLS)
├── memory/            # Что помнишь (MEMORY + seed)
├── personality/       # Что знаешь (факты, тон, FAQ, антипаттерны)
├── skills/            # Что умеешь
│   ├── tg-autocomment/    💬 Автокомменты в ТГ-канал
│   ├── content-creation/  ✍️ Создание контента
│   ├── text-optimization/ 📊 Оптимизация текстов
│   ├── social-listening/  👂 Мониторинг соцсетей
│   ├── content-calendar/  📅 Контент-план
│   └── visual-content/    🎨 Визуальный контент
└── workflows/         # Автоматизированные процессы
    ├── daily-posting.md     Ежедневный цикл
    ├── comment-reply.md     Ответ на комменты
    └── weekly-report.md     Еженедельный отчёт
```

## Быстрый старт (Bootstrap)

### 1. Клонируй репо

```bash
git clone <URL> ~/kot-bro-smm
```

### 2. Настрой workspace

Скопируй файлы в корень workspace OpenClaw-агента:

```bash
# Личность
cp identity/SOUL.md ~/workspace/SOUL.md
cp identity/IDENTITY.md ~/workspace/IDENTITY.md
cp identity/USER.md ~/workspace/USER.md

# Конфигурация
cp config/AGENTS.md ~/workspace/AGENTS.md
cp config/HEARTBEAT.md ~/workspace/HEARTBEAT.md
cp config/TOOLS.md ~/workspace/TOOLS.md

# Память
cp -r memory/ ~/workspace/memory/

# Personality и skills — линковать или копировать
cp -r personality/ ~/workspace/personality/
cp -r skills/ ~/workspace/skills/
cp -r workflows/ ~/workspace/workflows/
```

### 3. Настрой окружение

```bash
cp config/env.example .env
# Заполни .env реальными токенами
```

### 4. Подключи Telegram-бота

1. Создай бота через @BotFather в Telegram
2. Скопируй токен в `.env` → `TELEGRAM_BOT_TOKEN`
3. Добавь бота в discussion-группу канала
4. Пропиши `TELEGRAM_CHANNEL_ID` и `TELEGRAM_DISCUSSION_GROUP_ID`

### 5. Запусти

```bash
# Через OpenClaw
openclaw gateway run
```

### 6. Проверь

Напиши боту в Telegram — он должен ответить как Кот Бро.

## Для бота: Self-Setup

Если ты — бот, который получил ссылку на этот репо:

1. **Клонируй** репо в свой workspace
2. **Прочитай** `identity/SOUL.md` — это кто ты
3. **Прочитай** `identity/USER.md` — это кто твой человек
4. **Скопируй** файлы по инструкции выше
5. **Настрой** `.env` (попроси Стёпу дать токены)
6. **Прочитай** все skills в `skills/` — это твои возможности
7. **Прочитай** `personality/` — это твоя база знаний
8. **Запусти** heartbeat по `config/HEARTBEAT.md`
9. **Запиши** в `memory/YYYY-MM-DD.md` что ты настроился

Ты готов. Погнали, бро! 🐱

## Обновления

Репо обновляется из основного источника. Чтобы получить обновления:

```bash
cd ~/kot-bro-smm
git pull
# Затем заново скопируй нужные файлы
```

## Кто это сделал

Создано командой «Реального Лагеря» для переноса SMM-агента с Windows на Mac Mini.

---

_Кот Бро. Всегда на связи. Всегда за своего._ 🐱
