# @rfgamaral/pi-config

Personal harness configuration for the [Pi](https://github.com/badlogic/pi-mono) coding agent: extensions, skills, and prompts.

## Using as a Pi Package

> [!NOTE]
> This is a personal configuration repo. Some skills and settings are tailored to my setup and may need adjustments for yours.

This only exports the custom extensions, skills, and prompts listed below. Third-party packages need to be installed separately.

```bash
pi install git:github.com/rfgamaral/pi-agent-config
```

Then run `pi config` to enable or disable individual extensions, skills, and prompts. Alternatively, use [package filtering](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md#package-filtering) in `settings.json`.

## AGENTS.md

Global agent instructions loaded into every Pi session as a system prompt extension. Contains communication preferences and development rules, not project contribution guidelines. Only applies when this repo is cloned directly as `~/.pi/agent/`.

## Included Packages

The repo includes its own set of extensions, skills, and prompts, also exported as a [Pi package](#using-as-a-pi-package) for independent installation.

> [!NOTE]
> Provenance: `●` original · `⑂` forked & modified, or inspired & adapted

### Extensions

|     | Extension                                           | Description                                                                                                                |
| --- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| ●   | [`auto-session-name`](extensions/auto-session-name) | LLM-generated session titles after the first exchange, with automatic re-evaluation on compaction                          |
| ⑂   | [`clipboard-image`](extensions/clipboard-image)     | Clipboard image paste for WSL with format conversion, resize, and in-memory attachment via `Alt+V`                         |
| ●   | [`cockpit-panel`](extensions/cockpit-panel)         | Custom editor with rounded-box border, per-project colors, git status, GitHub PR checks, and model/context usage widget    |
| ⑂   | [`oracle`](extensions/oracle)                       | Second opinion from an alternate model with ranked auto-selection, automatic thinking caps, and optional context injection |
| ⑂   | [`pi-mem`](extensions/pi-mem)                       | Daily memory for Pi with long-term notes, daily logs, scratchpad, and automatic context injection                          |
| ⑂   | [`pi-reflect`](extensions/pi-reflect)               | Iterative reflection for Pi that analyzes recent sessions and updates behavioral files and memory                          |
| ⑂   | [`whimsical`](extensions/whimsical)                 | Random short whimsical working messages for Pi's interactive TUI                                                           |

### Skills

|     | Skill                                     | Description                                                                                                    |
| --- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| ●   | [`commit`](skills/commit)                 | Git commits with convention detection, intelligent staging, multi-commit splitting, and diff review guardrails |
| ●   | [`obsidian-vault`](skills/obsidian-vault) | Read, search, create, and edit Obsidian vault notes with filesystem guardrails and backlink-aware operations   |

### Prompts

|     | Prompt                                        | Description                                                                                           |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| ●   | [`rebase-on-main`](prompts/rebase-on-main.md) | Rebase current branch onto main with automatic stashing, conflict resolution, and optional force-push |

## Community Packages

In addition to the included packages, the setup relies on these community [Pi packages](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md) which are installed separately.

| Package                                                                  | Description                                                                                    |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [`pi-btw`](https://pi.dev/packages/pi-btw)                               | Parallel side conversations in Pi via `/btw` while the main agent keeps running                |
| [`pi-context7`](https://pi.dev/packages/@dreki-gg/pi-context7)           | Pi-native Context7 docs lookup with direct HTTP, cache, and raw-doc retrieval                  |
| [`pi-copy-user-message`](https://pi.dev/packages/pi-copy-user-message)   | Slash command to copy the most recent user message to the clipboard                            |
| [`pi-github`](https://pi.dev/packages/pi-github)                         | GitHub toolkit for Pi with thread formatting, PR inspection, and repo search                   |
| [`pi-gpt-config`](https://github.com/edxeth/pi-gpt-config)               | Codex-parity settings panel for supported OpenAI models                                        |
| [`pi-handoff`](https://pi.dev/packages/@ssweens/pi-handoff)              | Context handoff for Pi with `/handoff`, auto-handoff on compaction, and parent-session queries |
| [`pi-guardrails`](https://pi.dev/packages/@aliou/pi-guardrails)          | Security hooks to reduce accidental destructive actions and secret access                      |
| [`pi-questionnaire`](https://pi.dev/packages/@dreki-gg/pi-questionnaire) | Structured questionnaire flow for Pi with multi-step prompts and normalized answers            |
| [`pi-smart-fetch`](https://pi.dev/packages/pi-smart-fetch)               | Browser-grade fetch for Pi with TLS impersonation, readable extraction, and batch fetch        |
| [`pi-subagents`](https://pi.dev/packages/@tintinweb/pi-subagents)        | Claude Code-style subagents for Pi with background runs, steering, resume, and custom agents   |
| [`pi-tool-display`](https://pi.dev/packages/pi-tool-display)             | OpenCode-style tool rendering for Pi with compact output and richer diffs                      |

## License

The use of this source code is governed by an MIT-style license that can be found in the [LICENSE](LICENSE) file.
