# AGENTS.md - Source Repo

This repository is the source of truth for Kot Bro's baseline identity, skills, and release tooling.

## What This Repo Is

- A release source, not the live workspace itself
- The live OpenClaw workspace is assembled into `OPENCLAW_HOME/current`
- Mutable state must stay outside git in `OPENCLAW_HOME/shared`

## Canonical Sources

- `identity/` - baseline identity files
- `config/` - baseline workspace instructions and templates
- `personality/` - tone, facts, anti-patterns, style corpus
- `skills/` - skills shipped with the release
- `workflows/` - operational routines
- `runtime/release/` - self-rebuild, status, rollback, validation tooling
- `.openclaw/extensions/kot-bro-release/` - deterministic slash commands

## Live Workspace Model

The release assembler materializes a runtime workspace from this repo:

- Root runtime files are generated from `identity/`, `config/`, and `memory/`
- Repo-owned assets are copied into each release
- Mutable files are symlinked to `OPENCLAW_HOME/shared`
- Runtime writes must never become incidental git changes

## Editing Rules

- Edit source files in this repo, not generated files on the Mac Mini
- If a runtime behavior depends on a threshold or policy, keep the source of truth in machine-readable config first
- If you change release layout or admin command behavior, update `README.md`, `config/AGENTS.md`, and `lobster.manifest.json` together
