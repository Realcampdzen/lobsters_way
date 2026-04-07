# VK Auto-Comment Module (Cloudflare Workers)

Standalone Cloudflare Workers module для автоматического комментирования постов ВКонтакте с помощью OpenAI.

## Что делает

1. **`wall_post_new`** — при появлении нового поста в сообществе ВК, бот генерирует AI-комментарий и оставляет его от имени сообщества.
2. **`wall_reply_new`** — если кто-то отвечает на комментарий бота (или триггерное слово), бот отвечает в ветке.

## Архитектура

```
vk-autocomment-module/
├── src/
│   ├── index.ts          # Entry point — Hono роутер + вебхуки
│   ├── vk-handler.ts     # Вся логика: дедуп, генерация, отправка
│   ├── openai.ts         # OpenAI ChatCompletion wrapper
│   ├── kv.ts             # KV-утилиты (get/put/dedupe)
│   ├── memory.ts         # Контекст бесед (history per post)
│   ├── config.ts         # Системный промпт + настройки
│   └── types.ts          # TypeScript-типы
├── wrangler.toml         # Конфиг для Cloudflare Workers
├── package.json
├── tsconfig.json
├── .dev.vars.example     # Пример секретов для локальной разработки
└── README.md
```

## Быстрый старт

### 1. Установка

```bash
cd vk-autocomment-module
npm install
```

### 2. Настройка секретов

Скопируй `.dev.vars.example` → `.dev.vars` для локальной разработки:

```bash
cp .dev.vars.example .dev.vars
```

Заполни:

```env
OPENAI_API_KEY=sk-...
VK_GROUP_ID=123456789
VK_SECRET=your_callback_secret
VK_CONFIRMATION_CODE=abc123
VK_ACCESS_TOKEN=vk1.a.xxxxx
```

### 3. Создай KV namespace

```bash
npx wrangler kv namespace create VK_AUTOCOMMENT_KV
```

Получишь ID — вставь в `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "VK_AUTOCOMMENT_KV"
id = "ПОЛУЧЕННЫЙ_ID"
```

### 4. Локальный запуск

```bash
npm run dev
```

Worker запустится на `http://localhost:8787`.
VK callback URL для тестов: `http://localhost:8787/api/vk/callback`

### 5. Деплой

```bash
npm run deploy
```

После деплоя:
- URL будет вида `https://your-worker.your-subdomain.workers.dev`
- VK Callback URL: `https://your-worker.your-subdomain.workers.dev/api/vk/callback`

### 6. Настройка VK

1. Зайди в **Настройки сообщества → Работа с API → Callback API**
2. Добавь сервер:
   - URL: `https://your-worker.your-subdomain.workers.dev/api/vk/callback`
   - Секретный ключ: значение `VK_SECRET`
3. Подтверди сервер (VK пришлёт `type=confirmation`, worker ответит `VK_CONFIRMATION_CODE`)
4. Включи события:
   - ✅ `wall_post_new` — Новые записи на стене
   - ✅ `wall_reply_new` — Новые комментарии на стене
5. Убедись, что у Access Token сообщества есть права: `wall`, `manage`

### 7. Прод-секреты

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put VK_GROUP_ID
npx wrangler secret put VK_SECRET
npx wrangler secret put VK_CONFIRMATION_CODE
npx wrangler secret put VK_ACCESS_TOKEN
```

## Переменные окружения

| Переменная | Обязательна | Описание |
|-----------|------------|----------|
| `OPENAI_API_KEY` | ✅ | API ключ OpenAI |
| `VK_GROUP_ID` | ✅ | Числовой ID сообщества VK |
| `VK_SECRET` | ✅ | Секрет Callback API |
| `VK_CONFIRMATION_CODE` | ✅ | Строка подтверждения сервера |
| `VK_ACCESS_TOKEN` | ✅ | Токен сообщества с правами на стену |
| `OPENAI_PROXY_BASE_URL` | ❌ | Proxy URL для OpenAI (если нужен) |
| `OPENAI_PROXY_TOKEN` | ❌ | Токен прокси |
| `NV_DISABLE_VK` | ❌ | `1` чтобы отключить бота |

## Кастомизация

### Сменить системный промпт

Отредактируй `src/config.ts` → `SYSTEM_PROMPT`. Текущий промпт заточен под детский лагерь, замени на свой контекст.

### Сменить модель OpenAI

В `src/config.ts` → `OPENAI_MODEL`. По умолчанию `gpt-4o`.

### Изменить логику триггеров

В `src/vk-handler.ts` → `shouldReplyToText()`. Замени ключевые слова на свои.

### Изменить формат комментариев

В `src/vk-handler.ts` → `normalizeOutgoingText()`. Настрой длину, эмодзи, markdown-стриппинг.

## Debug

`GET /api/debug` — показывает KV-снимки последних событий:

```json
{
  "ok": true,
  "env": {
    "hasOpenAIKey": true,
    "hasKV": true,
    "hasVkGroupId": true,
    "hasVkAccessToken": true
  },
  "vk": {
    "lastCallback": { "ts": 1712345678, "type": "wall_post_new" },
    "lastWallPostNew": { "ts": 1712345678, "ok": true, "commentId": 12345 },
    "lastCreateCommentError": null
  }
}
```

## Как это работает (техническая схема)

```
VK Community
    │
    │ Callback API (POST /api/vk/callback)
    ▼
┌──────────────────────────┐
│   Cloudflare Worker      │
│                          │
│  1. Валидация secret     │
│  2. Дедупликация (KV)    │
│  3. wall_post_new:       │
│     → Генерация через    │
│       OpenAI             │
│     → wall.createComment │
│  4. wall_reply_new:      │
│     → Проверка: ответ    │
│       на наш коммент?    │
│     → Генерация ответа   │
│     → wall.createComment │
│       (reply_to_comment) │
└──────────────────────────┘
         │
         │ KV Storage
         ▼
    ┌─────────┐
    │   KV    │  Дедуп, память веток,
    │Namespace│  маркеры своих комментов
    └─────────┘
```

## Лицензия

Внутренний модуль. Свободно используйте и модифицируйте.
