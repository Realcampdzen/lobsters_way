# Кот Бро — Release Source для живого TG-лобстера

`lobsters_way` больше не markdown-архив. Это release-источник для уже работающего 24/7 Кота Бро на Mac Mini.

Репо хранит baseline личности, навыков, правил и seed-памяти. Живая память, секреты и runtime-state живут локально в `OPENCLAW_HOME/shared` и не должны попадать в git.

## Модель релиза

На машине бота держится стабильный `OPENCLAW_HOME`:

```text
OPENCLAW_HOME/
├── current -> releases/20260407T013501Z-3e1eacb
├── releases/
│   └── <timestamp>-<sha>/
├── shared/
│   ├── .env
│   ├── USER.md
│   ├── HEARTBEAT.md
│   ├── TOOLS.md
│   ├── MEMORY.md
│   ├── memory/
│   ├── config/admin-allowlist.json
│   └── runtime/
│       ├── state/update-state.json
│       └── logs/
└── staging/
```

`current` — единственный live workspace для OpenClaw. Внутри каждого release repo-owned файлы копируются заново, а mutable пути приходят через symlink в `shared/`.

## Что в репо

```text
├── identity/          baseline identity
├── config/            workspace instructions + machine-readable policy
├── personality/       tone, facts, style corpus
├── skills/            SMM and writing skills
├── workflows/         daily/weekly operational routines
├── runtime/release/   build, validate, rollback, status tooling
└── .openclaw/extensions/kot-bro-release/
                     deterministic slash commands
```

## Deterministic admin commands

После первого cutover live bot получает три deterministic команды, которые не идут в LLM:

- `/self_rebuild <github-url> [ref] [dry-run|apply]`
- `/release_status`
- `/rollback_release [previous|release-id]`

Они работают только для Telegram admin allowlist из `shared/config/admin-allowlist.json` и принимают только canonical repo URL из `lobster.manifest.json`.

## Как работает self-rebuild

### `dry-run`

1. Клонирует repo/ref в staging
2. Валидирует manifest, обязательные пути и env
3. Собирает новый release без cutover
4. Возвращает summary в Telegram

### `apply`

1. Клонирует repo/ref в staging
2. Валидирует manifest и runtime prerequisites
3. Собирает новый release в `releases/<timestamp>-<sha>`
4. Переключает `current`
5. Делает restart gateway
6. Ждёт health check
7. При ошибке откатывается на предыдущий release и снова делает restart
8. Шлёт confirmation в Telegram

## Источник правды

### Repo-owned

- `identity/`
- `config/`
- `personality/`
- `skills/`
- `workflows/`
- `.openclaw/`
- `runtime/`
- `lobster.manifest.json`

### Shared-local

- `.env`
- `USER.md`
- `HEARTBEAT.md`
- `TOOLS.md`
- `MEMORY.md`
- `memory/`
- `config/admin-allowlist.json`
- `runtime/state/`
- `runtime/logs/`

`memory/MEMORY.md` из репо используется только как seed. После bootstrap живая память принадлежит `shared/`.

## One-time bootstrap

Полностью self-hosted deterministic rebuild возможен только после первого cutover, потому что текущий legacy workspace ещё не несёт этот plugin/runtime слой. Поэтому первая миграция на `OPENCLAW_HOME/current` всё ещё one-time операционная задача.

Минимальная схема:

1. Настроить `OPENCLAW_HOME`
2. Положить `shared/.env`
3. Запустить bootstrap dry-run:

```bash
OPENCLAW_HOME=/Users/you/.openclaw-kot-bro \
node runtime/release/cli.mjs bootstrap --source . --mode dry-run
```

4. Выполнить первый apply вручную или из текущего live окружения
5. Переключить OpenClaw workspace на `OPENCLAW_HOME/current`
6. Убедиться, что plugin `kot-bro-release` загружается из `.openclaw/extensions/`

После этого следующие обновления можно делать уже через Telegram slash-команды.

## OpenClaw config template

Шаблон лежит в [config/openclaw.template.json](config/openclaw.template.json). Там зафиксированы:

- workspace = `__OPENCLAW_HOME__/current`
- `commands.native = "auto"`
- `commands.nativeSkills = "auto"`
- включён plugin `kot-bro-release`

## Центральный scoring policy

Source of truth: [config/scoring-policy.json](config/scoring-policy.json)

- `publish >= 7`
- `5-6` только manual review
- `< 5` skip

Все markdown-инструкции должны ссылаться на этот файл и не расходиться с ним.

## Валидация

Основные команды:

```bash
node runtime/release/cli.mjs validate-local --source .
node runtime/release/cli.mjs status
node runtime/release/cli.mjs bootstrap --source . --mode dry-run
python3 skills/text-optimization/analyze_metrics.py personality/blog/neurocamp_issue_001.md --json
```

## Важное ограничение

Этот репозиторий не должен использоваться как live workspace напрямую. Если OpenClaw смотрит прямо на git checkout, ты теряешь overlay-модель, rollback и разделение между baseline и живой памятью.
