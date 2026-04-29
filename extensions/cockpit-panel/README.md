# Cockpit Panel

Replaces Pi's default editor and footer with a workspace-aware status bar. Hides the default footer entirely and adds two components: a custom editor with a rounded box border, and a status widget below it.

## Editor

The default editor is wrapped in a rounded box border with the project name and git information displayed in the title bar:

```
todoist-web · main* ⇡1 ≡2 ✎3
```

### Project Name Detection

The project name is resolved in this order:

1. The `name` field from `package.json` in the current directory
2. The first `#` heading in `README.md`
3. The folder name as a fallback

This can be overridden per project using `nameOverrides` in the configuration (see below).

### Git Information

The git status is displayed next to the project name with the following indicators:

| Indicator | Meaning                                  |
| --------- | ---------------------------------------- |
| `*`       | Uncommitted changes (dirty working tree) |
| `⇡n`      | Commits ahead of upstream                |
| `⇣n`      | Commits behind upstream                  |
| `≡n`      | Staged files                             |
| `✎n`      | Modified files (unstaged)                |
| `?n`      | Untracked files                          |

Git status is polled at a configurable interval (default: every 5 seconds).

### Border Color

The border color can be customized per project using the `colors` configuration. When no custom color is set, the border uses Pi's default thinking-level color. When using bash commands (`!` or `!!`), the custom color is disabled and Pi's default border color is used instead.

## Status Widget

A single-line widget displayed below the editor, split into two sides:

```
● PR #142 • ✓ 12/12 • ✎ 2       Opus 4.6 (xhigh) • ↑120.5k ↓45.2k • 650.0k/1.0M (65%)
```

### Left Side: PR Status

Displays pull request information for the current branch using the `gh` CLI:

| Element               | Description                                                               |
| --------------------- | ------------------------------------------------------------------------- |
| `●` / `○` / `◉` / `◌` | PR state: open (green), closed (red), merged (purple), draft (gray)       |
| `PR #142`             | PR number, clickable link to GitHub                                       |
| `✓ 12/12`             | CI checks: pass/total (green ✓, red ✕ for failures, yellow ◔ for pending) |
| `✎ 2`                 | Unresolved review thread count (fetched via GitHub GraphQL API)           |

PR status is polled at a configurable interval (default: every 30 seconds). If no PR exists for the current branch or `gh` is not authenticated, the left side is empty.

### Right Side: Model & Context

| Element             | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `Opus 4.6 (xhigh)`  | Active model name and thinking level                   |
| `↑120.5k ↓45.2k`    | Input and output tokens for the session                |
| `650.0k/1.0M (65%)` | Context window usage (tokens used / total, percentage) |

### Responsive Layout

When the terminal is too narrow to fit everything, segments are progressively removed right-to-left. On the right side: context percentage goes first, then token counts, keeping the model name as the last visible element. On the left side: review threads go first, then CI checks, keeping the PR number as the last visible element.

## Style sharing

When a project has a custom border color configured, Cockpit Panel publishes the style via Pi's inter-extension event bus (`cockpit:style`). Other extensions can subscribe to match the editor's visual identity.

The emitted style object contains:

| Property        | Type                    | Description                                                                   |
| --------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `borderColor`   | `(s: string) => string` | Custom project border color function                                          |
| `textLight`     | `(s: string) => string` | Brightened variant of the border color, used for titles and the prompt marker |
| `textLightBold` | `boolean`               | Whether text using `textLight` should be rendered bold                        |

The event is only emitted when a custom project color is active. Extensions should compute their own thinking-level colors locally as a fallback.

## Configuration

Edit `~/.pi/agent/extensions/cockpit-panel.json` to customize behavior.

```json
{
    "gitPollInterval": 5000,
    "prPollInterval": 30000,
    "workspaceProfiles": {
        "nameOverrides": {
            "/.pi/agent": "Pi"
        },
        "colors": {
            "todoist": "#e06155"
        }
    }
}
```

### Settings

| Setting           | Default | Description                                                  |
| ----------------- | ------- | ------------------------------------------------------------ |
| `gitPollInterval` | `5000`  | How often to refresh git status (in milliseconds)            |
| `prPollInterval`  | `30000` | How often to refresh PR status from GitHub (in milliseconds) |

### Workspace Profiles

#### `nameOverrides`

Maps path substrings to custom display names. The match is case-insensitive against the full working directory path. If the key appears anywhere in the path, the corresponding value is used as the project name in the editor title bar.

For example, `"/.pi/agent": "Pi (Agent)"` will match any working directory containing `/.pi/agent` and display "Pi (Agent)" instead of the auto-detected name.

#### `colors`

Maps project name substrings to hex border colors. The match is case-insensitive against the auto-detected project name (before any name overrides are applied). If the key appears anywhere in the project name, the corresponding hex color is used for the editor border.

For example, `"todoist": "#e06155"` will apply a red border to any project whose detected name contains "todoist".
