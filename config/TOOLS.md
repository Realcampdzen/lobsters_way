# TOOLS.md — Окружение Кота Бро

## Host

- **Машина:** Mac Mini (ферма друга Стёпы — [31337Ghost](https://github.com/31337Ghost))
- **Runtime:** Docker-контейнер (поднят из [31337Ghost/openclaw](https://github.com/31337Ghost/openclaw))
- **Доступность:** 24/7
- **Владелец хоста:** друг Стёпы, любезно поделился местом на ферме
- **Home directory:** подмонтирован volume-ом → можно обновлять себя
- **Самообновление:** да, Лобстер может сам обновлять свои файлы

## Capabilities

### Audio Transcription (локальная)
- **Движок:** OpenAI Whisper API (локальный)
- **URL:** из переменной `OPENAI_WHISPER_BASE_URL` в `.env`
- **Модель:** `whisper-1`
- **Config:**
```json
"tools": {
  "profile": "full",
  "media": {
    "audio": {
      "enabled": true,
      "baseUrl": "${OPENAI_WHISPER_BASE_URL}",
      "models": [
        {
          "provider": "openai",
          "model": "whisper-1"
        }
      ]
    }
  }
}
```

### Memory Search (локальный embedder)
- **Движок:** Ollama (локальный)
- **URL:** `http://host.docker.internal:11434/v1`
- **API key:** `ollama`
- **Модель:** `nomic-embed-text`
- **Chunking:** 400 tokens, overlap 80
- **Config:**
```json
"agents": {
  "defaults": {
    "memorySearch": {
      "enabled": true,
      "provider": "openai",
      "remote": {
        "baseUrl": "http://host.docker.internal:11434/v1",
        "apiKey": "ollama"
      },
      "fallback": "none",
      "model": "nomic-embed-text",
      "chunking": {
        "tokens": 400,
        "overlap": 80
      },
      "sync": {
        "watch": true
      }
    }
  }
}
```

## Recovery / Restart

### Перезапуск контейнера
```bash
openclaw-restart
# Отправляет SIGTERM лаунчеру → полный рестарт контейнера
```

### Перезапуск только gateway
```bash
openclaw-restart --gateway
# Отправляет SIGUSR1 процессу openclaw-gateway → мягкий рестарт
```

### Справка
```bash
openclaw-restart --help
```

## Платформы

| Платформа | Что делаю | Формат |
|-----------|-----------|--------|
| Telegram (канал) | Автокомменты к постам | Чистый текст, 2-3 предложения |
| Telegram (бот) | Ответы в личку | Markdown OK |
| Яндекс Дзен | Рубрика «НейроЛагерь» | Лонгриды 600-1500 слов |
| VK (группа) | Комментарии от имени группы | Чистый текст |

## Модель для генерации

| Задача | Temperature | Max tokens |
|--------|-------------|------------|
| Автокомменты | 0.7 | 150 |
| Контент/блог | 0.8 | 500 |
| Анализ текста | 0.3 | 1000 |

## API ключи

Все ключи в `.env` файле (не коммитить!). См. `env.example`.

## Заметки

_(Добавляй сюда свои заметки по мере работы)_
