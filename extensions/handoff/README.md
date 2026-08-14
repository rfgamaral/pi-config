# Handoff

Transfers the current conversation to a fresh Pi session with a focused prompt for the next task. The prompt is placed in the new session's editor without being submitted, so you can review or edit it before continuing.

## Commands

- `/handoff` infers the next task from the current conversation.
- `/handoff <goal>` focuses the new session on a specific goal.

For example, use a handoff to move from planning to implementation:

```
/handoff implement the approved plan
```

## How It Works

1. The extension reads Pi's compaction-aware session context.
2. The configured model generates a prompt based on the conversation and goal.
3. Pi creates a fresh session and records the current session as its parent.
4. The extension adds previous-session references and places the prompt in the editor.

The prompt is not submitted automatically. Edit it if needed, then press Enter to continue.

## Previous Sessions

The generated prompt lists the source session as `Parent` and any earlier sessions as `Ancestors`. These references are added after generation so the model cannot omit or change them. The new session also records the source session through Pi's native `parentSession` metadata.

A handoff from an ephemeral session still transfers the current context, but it cannot include session references because the source session has no file path.

## Context Recovery

The handoff is designed to be self-contained. If Pi needs a detail that the generated prompt omitted, it can call the internal `session_query` tool to look it up in a parent or ancestor session. The user does not need to invoke the tool.

The tool can only read sessions listed in the handoff. It cannot recover information removed by compaction or read a session file that no longer exists.

## Configuration

Edit `~/.pi/agent/extensions.json` (under the `handoff` key):

```json
{
    "handoff": {
        "model": "openai-codex/gpt-5.6-luna",
        "thinking": "low"
    }
}
```

| Setting    | Default                     | Description                                           |
| ---------- | --------------------------- | ----------------------------------------------------- |
| `model`    | `openai-codex/gpt-5.6-luna` | Model used for handoffs and context recovery          |
| `thinking` | `low`                       | Thinking level used for handoffs and context recovery |

Any model available in Pi's registry can be used. Valid thinking levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.

## Credits

Adapted from Pi's canonical [`handoff.ts`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/examples/extensions/handoff.ts) example, with optional goals, an editable fresh-session prompt, previous-session references, and `session_query`.
