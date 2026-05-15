# Tool Policy

Disables configured tools by name so they do not appear in Pi's active tool set. This is useful when two extensions expose overlapping capabilities and you want the agent to see only one clear tool for a job.

For example, if `pi-smart-fetch` provides the preferred URL fetching tools and `pi-web-access` is installed for search, Tool Policy can disable `fetch_content` so the agent keeps using `web_fetch` / `batch_web_fetch` for URL fetching.

## How It Works

1. On session start and before each agent turn, the extension removes configured tool names from Pi's active tools via `setActiveTools`.
2. If a disabled tool is called anyway, the extension blocks the call with a clear policy message.

Pi activates tools by name, so Tool Policy is intentionally name-based. If a tool name is disabled, that name is unavailable regardless of which extension registered it.

## Configuration

Edit `~/.pi/agent/settings.json`:

```json
{
    "tool-policy": {
        "disabledTools": ["fetch_content"]
    }
}
```

| Setting         | Default | Description                  |
| --------------- | ------- | ---------------------------- |
| `disabledTools` | `[]`    | Tool names to hide and block |
