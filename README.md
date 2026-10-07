# @rfgamaral/pi-config

Personal harness configuration for the [Pi](https://github.com/earendil-works/pi) coding agent: extensions, skills, and prompts.

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

### Paseo branch metadata context

[`paseo-branch-metadata-context`](extensions/paseo-branch-metadata-context.ts) adds the primary worktree path and Git remotes to Paseo's branch/title generation system prompt, letting `AGENTS.md` rules apply outside the source checkout's directory. Read-only and offline; strips URL credentials, queries, and fragments without duplicating naming rules.

Requires Paseo launch markers, an in-memory RPC session, and the recognized branch-generation prompt with its `BranchName` schema. Skips normal chats, commit/PR metadata, unknown formats, and Git failures. Non-Pi provider fallbacks bypass it.

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

| Package                                                                    | Description                                                           |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`Bladebro`](https://github.com/dondai44423/bladebro)                      | Stateful, stealth-focused browser automation for AI agents            |
| [`DonSeTch`](https://github.com/dondai44423/donsetch)                      | Web search, extraction, crawling, screenshots, and PDF/OCR processing |
| [`pi-anthropic-auth`](https://pi.dev/packages/@gotgenes/pi-anthropic-auth) | Anthropic OAuth compatibility for Pi                                  |
| [`pi-blackhole`](https://pi.dev/packages/pi-blackhole)                     | Long-running session memory, recall, and automatic context compaction |
| [`Ponytail`](https://github.com/DietrichGebert/ponytail)                   | Lazy senior developer mode that prioritizes reuse and minimal code    |

## License

The use of this source code is governed by an MIT-style license that can be found in the [LICENSE](LICENSE) file.
