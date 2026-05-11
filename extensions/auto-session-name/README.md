# Auto Session Name

Automatically generates descriptive session names using a fast LLM call. After the first exchange between user and agent, the extension sends a summary of the conversation to a lightweight model and sets the returned title as the session name. The name appears in the session selector instead of the raw first message.

## How It Works

1. After the first `agent_end` (user prompt + agent response), the conversation is converted into a naming digest and sent to a fast model with a prompt asking for a descriptive title.
2. The generated title is set via `setSessionName` and appears in the session selector.
3. If the session already has a name (e.g., from a previous run or manual rename), no automatic naming occurs on startup.

The naming digest uses pi's compaction-aware session context, keeps the full conversation arc when possible, and strips execution noise such as tool results, thinking blocks, and tool calls. If the digest is too large, the extension summarizes chronological slices before asking for the final title, so long-session renames are based on the whole conversation rather than just the beginning or end.

Titles use sentence case (first word capitalized, rest lowercase unless proper nouns/acronyms) and aim for 80-90 characters, up to 100 if needed.

### Re-evaluation on Compaction

When `renameOnCompaction` is enabled (the default), the session name is re-evaluated after each compaction. Compaction is a natural signal that a conversation has been running for a while and may have shifted focus. The current title is included in the prompt so the model can keep it unchanged if it still fits, or generate a new one if the conversation has drifted. Sessions that were manually renamed are never touched by compaction.

### On-demand Rename

Use `/rename-session-name` to re-evaluate the session name at any time. The current title is passed to the model, so it will keep it if it still describes the conversation arc or generate a new one if the conversation has drifted. If the session was manually renamed, the command will warn and do nothing. Use `/rename-session-name -f` (or `--force`) to override a manual name and generate a fresh one.

## Configuration

Edit `~/.pi/agent/extensions/auto-session-name.json`:

```json
{
    "model": "openai-codex/gpt-5.4-mini",
    "renameOnCompaction": "on"
}
```

| Setting              | Default                     | Description                                              |
| -------------------- | --------------------------- | -------------------------------------------------------- |
| `model`              | `openai-codex/gpt-5.4-mini` | Model to use for name generation                         |
| `renameOnCompaction` | `on`                        | Whether to re-evaluate the session name after compaction |

Any model available in Pi's registry can be used. Prefer fast, cheap models since the task is trivial: `openai-codex/gpt-5.4-mini`, `anthropic/claude-haiku-4-5`, and `google-gemini-cli/gemini-2.5-flash` are all good choices.
