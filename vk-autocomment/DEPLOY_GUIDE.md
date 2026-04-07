# VK Auto-Comment Worker — Пошаговый Deploy Guide для агента

> **Главное:** папка `vk-autocomment/` — это ПОЛНЫЙ, ГОТОВЫЙ Cloudflare Worker.
> Здесь нет "другого боевого кода" где-то ещё. Это и есть весь worker целиком.
> Тебе нужно только: настроить, задеплоить, подключить VK Callback.

---

## Ответы на твои конкретные вопросы

### Entrypoint существующего worker-а

```
vk-autocomment/src/index.ts
```

Это Hono-роутер. Три роута:
- `POST /api/vk/callback` — сюда VK шлёт Callback API события
- `GET /api/debug` — KV-снимки для отладки
- `GET /health` — health check

### Handler callback-событий

```
vk-autocomment/src/vk-handler.ts
```

Функция `processVkCallbackEvent()` — 350 строк, обрабатывает:
- `wall_post_new` → генерирует комментарий через OpenAI → `wall.createComment`
- `wall_reply_new` → проверяет триггеры → отвечает в ветке через `reply_to_comment`

### Конфиг/секреты/биндинги Cloudflare

```
vk-autocomment/wrangler.toml
```

Биндинги:
- `VK_AUTOCOMMENT_KV` — KV namespace (нужно создать и вставить ID)

Env-переменные (задаются через `wrangler secret put`):

| Имя | Что это |
|-----|---------|
| `OPENAI_API_KEY` | API ключ OpenAI |
| `VK_GROUP_ID` | Числовой ID сообщества VK (без минуса) |
| `VK_SECRET` | Секретный ключ Callback API сервера в VK |
| `VK_CONFIRMATION_CODE` | Строка подтверждения (VK даёт при добавлении сервера) |
| `VK_ACCESS_TOKEN` | Токен сообщества с правами `wall`, `manage` |
| `OPENAI_PROXY_BASE_URL` | (опционально) прокси для OpenAI |
| `OPENAI_PROXY_TOKEN` | (опционально) токен прокси |
| `NV_DISABLE_VK` | (опционально) `1` чтобы выключить |

### Структура KV ключей

Все ключи начинаются с `nv:vk:` — вот полный список:

| Ключ | Зачем | TTL |
|------|-------|-----|
| `nv:vk:dedupe:{eventId}` | Дедупликация событий | 24 часа |
| `nv:vk:post:{ownerId}:{postId}:commented` | «Уже комментировали этот пост» (значение = commentId) | 30 дней |
| `nv:vk:myComment:{commentId}` | «Это наш комментарий» (для ответов в ветке) | 60 дней |
| `nv:vk:conv:{ownerId}:{postId}` | История ветки (массив MemoryMessage[]) | 30 дней |
| `nv:vk:lastCallback` | Последний полученный callback | 14 дней |
| `nv:vk:lastEvent` | Последнее обработанное событие | 14 дней |
| `nv:vk:lastWallPostNew` | Результат обработки wall_post_new | 14 дней |
| `nv:vk:lastWallReplyNew` | Результат обработки wall_reply_new | 14 дней |
| `nv:vk:lastCreateCommentError` | Последняя ошибка VK API | 7 дней |
| `nv:vk:lastOpenAIError` | Последняя ошибка OpenAI | 14 дней |
| `nv:vk:lastForbidden` | Последний rejected callback | 14 дней |
| `nv:vk:lastDisabled` | Последний disabled event | 14 дней |
| `nv:vk:lastUnhandledError` | Необработанные ошибки | 14 дней |

**Безопасность:** если у тебя уже есть другой бот с KV — просто создай ОТДЕЛЬНЫЙ KV namespace. Ключи не пересекутся.

### Промпт и генератор

```
vk-autocomment/src/config.ts
```

Здесь лежит:
- `SYSTEM_PROMPT` — личность бота (сейчас НейроВалюша, **ЗАМЕНИ на Кота Бро**)
- `FEW_SHOT_EXAMPLES` — примеры стиля комментариев
- `OPENAI_MODEL` — модель (сейчас `gpt-4o`)
- `VK_MESSAGE_PREFIX` — технический префикс перед комментарием
- `REPLY_TRIGGER_KEYWORDS` — слова-триггеры для ответов на чужие комментарии
- `FORBIDDEN_EMOJIS` — запрещённые эмодзи

---

## Пошаговый план деплоя

### Шаг 1. Перейди в папку

```bash
cd vk-autocomment
```

### Шаг 2. Установи зависимости

```bash
npm install
```

### Шаг 3. Замени промпт на Кота Бро

Открой `src/config.ts` и замени:
- `SYSTEM_PROMPT` — вставь личность Кота Бро
- `FEW_SHOT_EXAMPLES` — вставь примеры в стиле Кота Бро
- `VK_MESSAGE_PREFIX` — поменяй на `'Мяу от Кота Бро:'` или `''` (пустая строка чтобы убрать)
- `REPLY_TRIGGER_KEYWORDS` — добавь свои триггеры если нужно

### Шаг 4. Создай KV namespace

```bash
npx wrangler kv namespace create VK_AUTOCOMMENT_KV
```

Получишь что-то вроде:
```
{ binding = "VK_AUTOCOMMENT_KV", id = "abc123def456" }
```

### Шаг 5. Вставь KV ID в wrangler.toml

Открой `wrangler.toml`, замени строку:
```toml
id = "ВСТАВЬ_СЮДА_ID_ОТ_WRANGLER"
```
на полученный id.

Также можно поменять `name` worker-а:
```toml
name = "kot-bro-vk-autocomment"
```

### Шаг 6. Задай секреты

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put VK_GROUP_ID
npx wrangler secret put VK_SECRET
npx wrangler secret put VK_CONFIRMATION_CODE
npx wrangler secret put VK_ACCESS_TOKEN
```

Каждая команда спросит значение интерактивно.

### Шаг 7. Деплой

```bash
npm run deploy
```

Worker задеплоится и выдаст URL вроде:
```
https://kot-bro-vk-autocomment.YOUR_SUBDOMAIN.workers.dev
```

### Шаг 8. Подключи VK Callback

1. Зайди в **Настройки сообщества → Работа с API → Callback API**
2. Добавь сервер:
   - URL: `https://kot-bro-vk-autocomment.YOUR_SUBDOMAIN.workers.dev/api/vk/callback`
   - Секретный ключ: значение `VK_SECRET`
3. VK пришлёт `type=confirmation` — worker автоматически ответит `VK_CONFIRMATION_CODE`
4. Включи события:
   - ✅ Записи на стене → Добавление
   - ✅ Комментарии → Добавление

### Шаг 9. Проверь

1. Открой: `https://YOUR_WORKER_URL/health` — должно быть `{"ok":true}`
2. Открой: `https://YOUR_WORKER_URL/api/debug` — покажет состояние
3. Напиши пост в VK-сообществе — через 5-15 секунд должен появиться комментарий

---

## Файловая карта (что за что отвечает)

```
vk-autocomment/
├── src/
│   ├── index.ts          ← ENTRYPOINT: Hono роутер, 3 роута
│   ├── vk-handler.ts     ← ЯДРО: вся логика wall_post_new + wall_reply_new
│   ├── config.ts         ← НАСТРОЙКИ: промпт, модель, триггеры ⚠️ ЗАМЕНИ
│   ├── openai.ts         ← OpenAI Chat Completion API wrapper
│   ├── kv.ts             ← Cloudflare KV утилиты (get/put/dedupe)
│   ├── memory.ts         ← Conversation memory (история веток)
│   └── types.ts          ← TypeScript типы (Env, VkPayload, etc)
├── wrangler.toml         ← Cloudflare Workers конфиг ⚠️ ВСТАВЬ KV ID
├── package.json          ← Зависимости (hono + wrangler)
├── tsconfig.json         ← TypeScript конфиг
├── .dev.vars.example     ← Шаблон секретов для локальной разработки
└── .gitignore
```

## Как VK Callback API работает (если забыл)

```
VK Community → POST /api/vk/callback → Worker
                                          │
                    ┌─────────────────────┤
                    │                     │
              type=confirmation    type=wall_post_new
              → ответ: CODE       → OpenAI → wall.createComment
                                          │
                                   type=wall_reply_new
                                   → check trigger
                                   → OpenAI → wall.createComment(reply_to_comment)
```

Worker ВСЕГДА отвечает `"ok"` на любой callback (иначе VK отключит сервер).

---

## Частые проблемы

| Симптом | Причина | Решение |
|---------|---------|---------|
| VK не подтверждает сервер | Неправильный `VK_CONFIRMATION_CODE` | Проверь код в настройках VK |
| Комментарии не появляются | Нет `VK_ACCESS_TOKEN` или нет прав | Создай токен с правами `wall` |
| OpenAI не отвечает | Нет `OPENAI_API_KEY` | `wrangler secret put OPENAI_API_KEY` |
| Дублирующиеся комментарии | KV не подключен | Проверь `wrangler.toml` → KV binding |
| debug показывает lastForbidden | VK_SECRET не совпадает | Проверь секрет в VK и в env |
