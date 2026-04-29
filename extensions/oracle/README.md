# Oracle

Get a second opinion from an alternate AI model without leaving your session. `/oracle` sends your current conversation and question to another model, shows the response in a scrollable view, and only adds it to the conversation if you accept it.

Forked from [w-winter/dot314](https://github.com/w-winter/dot314) with the following user-facing changes:

- Auto-selects the Oracle model from a configurable ranked list instead of prompting
- Starts at the highest guessed thinking level and falls back automatically if needed
- Redesigned result view with a full-width rounded-box border
- Inherits [cockpit-panel](../cockpit-panel) styling when available, otherwise uses Pi theme defaults
- Simplified accept/discard keybindings instead of a button toggle

## Usage

Run `/oracle` with optional flags first and the prompt last. The model is selected automatically:

```
/oracle is there a better way to handle this error?
```

With a thinking override:

```
/oracle -t low is there a better way to handle this error?
```

Optional flags can be combined in any order, as long as the prompt comes last. Flags placed after the prompt are treated as part of the prompt text.

| Flag               | Description                                                                   |
| ------------------ | ----------------------------------------------------------------------------- |
| `-m`, `--model`    | Override model selection (fuzzy matches against model ID or `provider/model`) |
| `-t`, `--thinking` | Override thinking level (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`)  |
| `-f`, `--file`     | Include a file's contents as additional context (can be repeated)             |

## Configuration

Edit `~/.pi/agent/extensions/oracle.json`:

```json
{
    "models": ["anthropic/claude-opus-4-7", "openai-codex/gpt-5.4"],
    "maxThinking": "auto"
}
```

| Setting       | Default                                                 | Description                                                                                  |
| ------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `models`      | `["anthropic/claude-opus-4-7", "openai-codex/gpt-5.4"]` | Ranked list of models to consult. The first available non-current model is used.             |
| `maxThinking` | `auto`                                                  | Starting thinking level, or `auto` for Oracle's highest guess. Falls back lower if rejected. |

Oracle picks the first entry that exists in Pi's model registry, has a valid API key, and is not the model currently in use. Models are compared by ID, so the same model from a different provider (e.g., Copilot Opus vs Anthropic Opus) is still skipped.

Set `maxThinking` to a lower starting level if you want to reduce token usage, or use `-t` for a strict per-invocation override.
