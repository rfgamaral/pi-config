# @rfgamaral/pi-config

Personal harness configuration for the [Pi](https://github.com/earendil-works/pi) coding agent: extensions, skills, and prompts.

## Using as a Pi Package

> [!NOTE]
> This is a personal configuration repo. Some skills and settings are tailored to my setup and may need adjustments for yours.

This only exports the custom extensions, skills, and prompts listed below. Third-party packages need to be installed separately. Package installation does not apply repository-level configuration files, such as `settings.json` or `keybindings.json`.

```bash
pi install git:github.com/rfgamaral/pi-config
```

Then run `pi config` to enable or disable individual extensions, skills, and prompts. Alternatively, use [package filtering](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md#package-filtering) in `settings.json`.

## AGENTS.md

Global agent instructions loaded into every Pi session as a system prompt extension. Contains communication preferences and development rules, not project contribution guidelines. Pi loads it globally when this repo is the agent directory (`~/.pi/agent/` by default, configurable with `PI_CODING_AGENT_DIR`) and project-locally when this repo is the current directory or an ancestor.

## Included Packages

The repo includes its own set of extensions, skills, and prompts, also exported as a [Pi package](#using-as-a-pi-package) for independent installation.

> [!NOTE]
> Provenance: `●` original · `⑂` forked & modified, or inspired & adapted

### Extensions

|     | Extension                                           | Description                                                                                                                |
| --- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| ●   | [`auto-session-name`](extensions/auto-session-name) | LLM-generated session titles after the first exchange, with automatic re-evaluation on compaction                          |
| ●   | [`cockpit-panel`](extensions/cockpit-panel)         | Custom editor with rounded-box border, per-project colors, git status, GitHub PR checks, and model/context usage widget    |
| ⑂   | [`handoff`](extensions/handoff)                     | Goal-directed context handoff to an editable fresh-session prompt, with parent-session recall                              |
| ⑂   | [`oracle`](extensions/oracle)                       | Second opinion from an alternate model with ranked auto-selection, automatic thinking caps, and optional context injection |
| ●   | [`session-defaults`](extensions/session-defaults)   | Sets the model and thinking level for each fresh persistent Pi session                                                     |
| ●   | [`session-favorites`](extensions/session-favorites) | Manage favorite sessions and resume them through Pi's standard session picker                                              |
| ⑂   | [`session-snap`](extensions/session-snap)           | Review and clean up trivial or old sessions with configurable rules and a filesystem-only archive                          |
| ⑂   | [`whimsical`](extensions/whimsical)                 | Random short whimsical working messages for Pi's interactive TUI                                                           |

### Skills

|     | Skill                                     | Description                                                                                                    |
| --- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| ●   | [`commit`](skills/commit)                 | Git commits with convention detection, intelligent staging, multi-commit splitting, and diff review guardrails |
| ●   | [`obsidian-vault`](skills/obsidian-vault) | Read, search, create, and edit Obsidian vault notes with filesystem guardrails and backlink-aware operations   |
| ⑂   | [`orwell-writing`](skills/orwell-writing) | Draft and revise prose using Orwell's rules and Simplified Technical English                                   |

### Prompts

|     | Prompt                                                    | Description                                                                                           |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| ●   | [`draft-pull-request`](prompts/draft-pull-request.md)     | Draft a pull request iteratively and create it only after explicit approval                           |
| ●   | [`explain-pull-request`](prompts/explain-pull-request.md) | Explain a GitHub PR in plain language with Mermaid diagrams as a themed HTML report                   |
| ●   | [`rebase-on-main`](prompts/rebase-on-main.md)             | Rebase current branch onto main with automatic stashing, conflict resolution, and optional force-push |

## Community Packages

In addition to the included packages, the setup relies on these community [Pi packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md) which are installed separately.

| Package                                                                                | Description                                                                             |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`pi-anthropic-auth`](https://pi.dev/packages/@gotgenes/pi-anthropic-auth)             | Anthropic OAuth compatibility for Pi                                                    |
| [`pi-context`](https://pi.dev/packages/pi-context)                                     | Agentic context management with checkpoints, timelines, and conversation compaction     |
| [`pi-github`](https://pi.dev/packages/pi-github)                                       | GitHub toolkit for Pi with thread formatting, PR inspection, and repo search            |
| [`pi-gpt-config`](https://github.com/edxeth/pi-gpt-config)                             | Codex-parity settings panel for supported OpenAI models                                 |
| [`pi-guardrails`](https://pi.dev/packages/@aliou/pi-guardrails)                        | Security hooks to reduce accidental destructive actions and secret access               |
| [`pi-mcp-adapter`](https://pi.dev/packages/pi-mcp-adapter)                             | Adapter to run MCP (Model Context Protocol) servers as Pi extensions                    |
| [`pi-memory`](https://pi.dev/packages/pi-memory)                                       | Durable memory, daily logs, scratchpad, and qmd-powered search                          |
| [`pi-subagents`](https://pi.dev/packages/@tintinweb/pi-subagents)                      | Claude Code-style subagents with parallel runs, live widget, mid-run steering, and more |
| [`pi-tasks`](https://pi.dev/packages/@tintinweb/pi-tasks)                              | Claude Code-style task tracking with dependencies and a persistent widget               |
| [`pi-tool-display`](https://pi.dev/packages/pi-tool-display)                           | OpenCode-style tool rendering for Pi with compact output and richer diffs               |
| [`pi-usage-extension`](https://pi.dev/packages/@tmustier/pi-usage-extension)           | Dashboard with aggregated usage statistics across all sessions                          |
| [`pi-web-access`](https://pi.dev/packages/pi-web-access)                               | Web search, URL fetch, GitHub repo cloning, and PDF/YouTube/video extraction            |
| [`ponytail`](https://github.com/DietrichGebert/ponytail)                               | Minimal coding and review workflows focused on YAGNI and reducing over-engineering      |
| [`rpiv-ask-user-question`](https://pi.dev/packages/@juicesharp/rpiv-ask-user-question) | Structured clarifying questions with a tabbed dialog and side-by-side previews          |
| [`superpowers`](https://github.com/obra/superpowers)                                   | Development workflow skills for planning, debugging, testing, and review                |

## License

The use of this source code is governed by an MIT-style license that can be found in the [LICENSE](LICENSE) file.
