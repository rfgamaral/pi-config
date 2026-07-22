# Session Defaults

Sets the model and thinking level for every fresh persistent Pi session.

## Why It Exists

When you change the model or thinking level, Pi saves the new choice for future sessions. For example, switching to a cheaper model for a small task also makes the next new session start with that model. This extension stores the model and thinking level you want to start with, then applies them whenever a session begins without conversation history. You can still switch models within a session.

## How It Works

1. On startup and after `/new`, the extension checks whether the session is persistent and has no conversation history.
2. It loads the configured model and thinking level.
3. It applies those values before the first prompt in the new session.

Sessions opened with `/resume`, sessions created with `/fork`, and ephemeral sessions keep their existing model and thinking level.

## Configuration

Edit `~/.pi/agent/extensions.json`:

```json
{
    "sessionDefaults": {
        "model": "anthropic/claude-opus-4-8",
        "thinking": "high"
    }
}
```

| Setting    | Default  | Description                                                 |
| ---------- | -------- | ----------------------------------------------------------- |
| `model`    | `""`     | Provider and model ID to use for fresh persistent sessions. |
| `thinking` | `"high"` | Thinking level to use for fresh persistent sessions.        |
