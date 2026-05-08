<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logo-dark.png" />
    <source media="(prefers-color-scheme: light)" srcset="logo.png" />
    <img src="logo.png" alt="pi-mem" width="300" />
  </picture>
</p>

# pi-mem

Surprisingly useful daily memory for the [pi](https://pi.dev/) coding agent.

Keep durable facts, day-to-day logs, and working context in plain Markdown across sessions. Recent memory is loaded back into the prompt, and the extension provides tools to write, read, and search that memory.

It is inspired by [OpenClaw](https://openclaw.ai)'s approach to agent memory. You can read the original blog post [here](https://pradeep.md/2026/02/11/pi-mem.html).

**capture durable facts → keep a daily log → reload the right context → the agent stays grounded across sessions.**

## Fork-specific changes

> **Upstream:** https://github.com/jo-inc/pi-mem

**Fixes:**

- Bootstrap bug: memory instructions were skipped until a memory file already had content
- Daily logging bug on empty memory: the Daily Log Rule was skipped, so meaningful interactions stopped being logged
- Pi 0.74 session lifecycle compatibility: `session_start` now covers new/resume/fork session replacement paths, replacing the removed `session_switch` event

## Layout

Memory files live under `~/.pi/agent/memory/` (override with `PI_MEMORY_DIR`):

| Path                  | Purpose                                                            |
| --------------------- | ------------------------------------------------------------------ |
| `MEMORY.md`           | Curated long-term memory (decisions, preferences, durable facts)   |
| `SCRATCHPAD.md`       | Checklist of things to keep in mind / fix later                    |
| `daily/YYYY-MM-DD.md` | Daily append-only log (today + yesterday loaded at session start)  |
| `notes/*.md`          | LLM-created files (lessons, self-review, reference material, etc.) |

Identity and behavioral files (e.g. `SOUL.md`, `AGENTS.md`, `HEARTBEAT.md`) can also live in the memory directory and be injected into context via `PI_CONTEXT_FILES`.

## Tools

| Tool            | Description                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `memory_write`  | Write to `long_term` (MEMORY.md), `daily` (today's log), or `note` (notes/filename). Supports `append` and `overwrite` modes.                          |
| `memory_read`   | Read MEMORY.md (`long_term`), SCRATCHPAD.md (`scratchpad`), daily logs (`daily`), notes (`note`), any root file (`file`), or list everything (`list`). |
| `memory_search` | Search across all files — filenames and content. Case-insensitive keyword search across root, notes/, and daily/.                                      |
| `scratchpad`    | Manage a checklist: `add`, `done`, `undo`, `clear_done`, `list`.                                                                                       |

## Context Injection

The following are automatically injected into the system prompt before every agent turn:

- Files listed in `PI_CONTEXT_FILES` (e.g. `SOUL.md,AGENTS.md,HEARTBEAT.md`)
- `MEMORY.md`
- `SCRATCHPAD.md` (open items only)
- Today's and yesterday's daily logs

Files in `notes/` and older daily logs are **not** injected — they're accessible on-demand via `memory_search` and `memory_read`.

## Configuration

Settings can be configured via environment variables or a `.pi-mem.json` file in the memory directory. Environment variables take precedence over file values.

### .pi-mem.json

Place a `.pi-mem.json` in your memory directory (default `~/.pi/agent/memory/.pi-mem.json`):

```json
{
    "searchDirs": ["catchup", "projects"],
    "contextFiles": ["SOUL.md", "AGENTS.md"],
    "autocommit": true
}
```

### Environment variables

Environment variables override `.pi-mem.json` values when set.

| Env Var            | Default                 | Description                                                                                                                                                        |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PI_MEMORY_DIR`    | `~/.pi/agent/memory/`   | Root directory for all memory files                                                                                                                                |
| `PI_DAILY_DIR`     | `$PI_MEMORY_DIR/daily/` | Directory for daily logs                                                                                                                                           |
| `PI_CONTEXT_FILES` | _(empty)_               | Comma-separated list of extra files to inject into context (e.g. `SOUL.md,AGENTS.md,HEARTBEAT.md`)                                                                 |
| `PI_SEARCH_DIRS`   | _(empty)_               | Comma-separated list of subdirectories (relative to `PI_MEMORY_DIR`) to include in `memory_search`. Searched recursively one level deep. (e.g. `catchup,projects`) |
| `PI_AUTOCOMMIT`    | `false`                 | When `1` or `true`, auto-commit to git after every write                                                                                                           |

## Dashboard Widget

An auto-generated "Last 24h" summary is shown on session start and switch:

- Scans recent session files for titles, costs, and sub-agent counts
- Groups by topic using an LLM call (falls back to flat list)
- Rebuilt every 15 minutes in the background
- Also shows open scratchpad items

## Related

- **[pi-reflect](https://github.com/jo-inc/pi-reflect)** — Self-improving reflection engine for pi. Analyzes recent conversations and iterates on memory, behavioral rules, and identity files. Pairs naturally with pi-mem.

## Installation

```bash
pi install git:github.com/jo-inc/pi-mem
```

## License

MIT
