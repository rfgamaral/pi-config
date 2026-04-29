# Whimsical

Replaces Pi's default working message with a random short whimsical phrase while the agent is streaming in the interactive TUI.

## How It Works

1. At the start of each turn, the extension picks a random short message such as `Schlepping...` or `Pondering...` and shows it in Pi's working row.
2. At the end of the turn, the extension restores Pi's default working message for the next run.

This is a small TUI-only polish extension: it swaps Pi's default working message for a random short whimsical one while the agent is streaming. In non-interactive flows, it has no visible effect.

## Credits

Copied from [`whimsical.ts`](https://github.com/mitsuhiko/agent-stuff/blob/main/extensions/whimsical.ts) from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff), with small local modifications.
