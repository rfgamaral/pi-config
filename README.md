# @rfgamaral/pi-config

Personal harness configuration for the [Pi](https://github.com/earendil-works/pi) coding agent: extensions, skills, and prompts.

I keep this repo at `~/.pi/agent` on a mini PC that serves as my central development machine. I access it remotely from different clients, using the same Pi environment wherever I connect.

## Using as a Pi Package

> [!NOTE]
> This is a personal configuration repo. Some skills and settings are tailored to my setup and may need adjustments for yours.

This exports the custom skills and prompts listed below. The setup also uses the community extensions listed below, which need to be installed separately. Package installation does not apply repository-level configuration files, such as `settings.json`.

```bash
pi install git:github.com/rfgamaral/pi-config
```

Then run `pi config` to enable or disable installed extensions, skills, and prompts. Alternatively, use [package filtering](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md#package-filtering) in `settings.json`.

## AGENTS.md

Global agent instructions loaded into every Pi session as a system prompt extension. Contains communication preferences and development rules, not project contribution guidelines. Pi loads it globally when this repo is the agent directory (`~/.pi/agent/` by default, configurable with `PI_CODING_AGENT_DIR`) and project-locally when this repo is the current directory or an ancestor.

## Local Extensions

These extensions load automatically when this repo is the Pi agent directory. They are not exported by the package manifest.

### Paseo metadata context

[`paseo-branch-metadata-context`](extensions/paseo-branch-metadata-context.ts) adds the primary worktree path and Git remotes to Paseo's branch/title generation system prompt, letting `AGENTS.md` rules apply outside the source checkout's directory. Read-only and offline; strips URL credentials, queries, and fragments without duplicating naming rules. Before returning JSON, it asks the model to check the branch against the applicable `AGENTS.md` rules, including required prefixes. This check relies on model compliance, not deterministic enforcement.

For commit-message generation, it reads the full [`commit`](skills/commit/SKILL.md) skill and adds it to the system prompt. A scope instruction limits the skill to read-only convention checks and JSON message output, without staging, committing, amending, or pushing. The skill remains the single source of truth.

Requires Paseo launch markers, an in-memory RPC session, and a recognized generation prompt with its `BranchName` or `CommitMessage` schema. Skips normal chats, PR metadata, unknown formats, and branch-context Git failures. Non-Pi provider fallbacks bypass it.

New sessions load it automatically; existing sessions need `/reload`.

### Long-term memory

[`long-term-memory`](extensions/long-term-memory.ts) gives Pi persistent memory across sessions as plain Markdown files in `memory/` under the agent directory. `MEMORY.md` holds facts that apply everywhere, `projects/<repo>.md` holds facts about one repository (named from its Git origin, so all worktrees share it), and `daily/` holds short session notes. The memory for the current project is added to the system prompt once per session, so the prompt cache stays valid.

A background pass summarizes new conversation after enough new prompts or after an idle period. It uses the model set as `longTermMemory.summaryModel` in [`settings.json`](settings.json), written as `provider/id`, and falls back to the session's model when that one is unavailable. It never blocks a turn and does no work at shutdown, because apps that run Pi as a subprocess can kill it within milliseconds of exiting. Sessions that ended before their content was saved are summarized later by whichever Pi process runs next. Progress is journaled per session, so a kill at any point neither loses nor duplicates memory, and many Pi processes can share the memory directory safely.

It provides the `memory_write`, `memory_read`, `memory_forget`, `memory_restore`, `memory_search`, `scratchpad`, and `memory_status` tools, compatible with [`pi-memory`](https://github.com/jayzeng/pi-memory), which it is based on. Search is a built-in keyword search; `deep` mode also searches past session transcripts. Tunables are constants at the top of the file. Background activity is logged to `memory/.state/activity.log`. When the summary model hits its usage limit, summaries keep failing for an hour, or a message has to be skipped, every open session shows a notification when its next turn starts (in the terminal, right away).

New sessions load it automatically; existing sessions need `/reload`.

### Anthropic skills

[`anthropic-skills`](extensions/anthropic-skills.ts) makes Claude load skills the way Claude Code does, because Claude often skips Pi's "read the skill file" instruction, mostly for skills about how to do work it thinks it already knows, such as writing or reviewing. It applies only to the `anthropic` provider; other providers keep Pi's default skill handling.

- Adds a `skill` tool, sent to Anthropic OAuth requests as `Skill`, with Claude Code's input (`skill`, `args`) and an adapted version of its tool prompt. The tool returns the same skill block as Pi's `/skill:name` expansion.
- Replaces Pi's "use the read tool" line above `<available_skills>` with instructions to use the `Skill` tool. The catalog itself comes from Pi, so installed skills need no configuration.
- After each tool turn, adds a short hidden reminder to load any skill that covers the next step. The reminder is saved in the session, so the prompt cache stays valid; it adds about 100 tokens per tool turn.

New sessions load it automatically; existing sessions need `/reload`.

## Included Packages

The repo exports its skills and prompts as a [Pi package](#using-as-a-pi-package) for independent installation.

> [!NOTE]
> Provenance: `●` original · `⑂` forked & modified, or inspired & adapted

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

| Package                                                                                | Description                                                           |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`Bladebro`](https://github.com/dondai44423/bladebro)                                  | Stateful, stealth-focused browser automation for AI agents            |
| [`DonSeTch`](https://github.com/dondai44423/donsetch)                                  | Web search, extraction, crawling, screenshots, and PDF/OCR processing |
| [`pi-anthropic-auth`](https://pi.dev/packages/@gotgenes/pi-anthropic-auth)             | Anthropic OAuth compatibility for Pi                                  |
| [`pi-blackhole`](https://pi.dev/packages/pi-blackhole)                                 | Long-running session memory, recall, and automatic context compaction |
| [`Ponytail`](https://github.com/DietrichGebert/ponytail)                               | Lazy senior developer mode that prioritizes reuse and minimal code    |
| [`rpiv-ask-user-question`](https://pi.dev/packages/@juicesharp/rpiv-ask-user-question) | Structured questions with selectable options and native Paseo forms   |
| [`rpiv-todo`](https://pi.dev/packages/@juicesharp/rpiv-todo)                           | Task tracking that survives compaction, with native Paseo task lists  |

## License

The use of this source code is governed by an MIT-style license that can be found in the [LICENSE](LICENSE) file.
