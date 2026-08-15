# Session Snap

Session Snap helps clean up Pi's session history without adding a database or changing session files. Run `/snap` to review short, disposable sessions and move older sessions out of `/resume` while keeping them available for manual restoration.

## How It Works

1. `/snap` scans Pi's session directory, excluding the current session.
2. Sessions below both deletion limits are marked for deletion. Older sessions that do not meet both limits are marked for archiving. The rest are kept.
3. The review shows each session's project, message count, and last activity. You can filter the results and change any proposed action before confirming.
4. Session Snap applies the confirmed actions, removes successful results from the review, and leaves failures available to inspect or retry.

Favorite protection integrates with the Session Favorites extension. When `keepFavorites` is enabled, sessions marked by that extension are kept. Unreadable, malformed, and unsupported files appear as skipped and are also kept by default. If favorite protection cannot be verified, the scan stops without changing anything.

Session Snap runs only when you call `/snap`. Deleted sessions are moved to your system trash when possible and permanently deleted otherwise. Archiving preserves the original session file without overwriting an existing archive.

## Archive and Restore

Archived sessions keep their original project directory and filename:

```text
sessions/
├── <project-directory>/
│   └── <timestamp>_<session-id>.jsonl
└── .archive/
    └── <project-directory>/
        └── <timestamp>_<session-id>.jsonl
```

Pi discovers only direct `.jsonl` children of project directories, so the extra project-directory level under `.archive` keeps archived sessions out of `/resume`. Session Snap preserves the JSONL file unchanged and uses no database, compression, sidecar metadata, or index.

There is no `/archive` command. To restore a session, move its JSONL file from `.archive/<project-directory>/` back to `sessions/<project-directory>/` without renaming it.

## Configuration

Add or edit the `sessionSnap` section in `~/.pi/agent/extensions.json`:

```json
{
    "sessionSnap": {
        "deleteMaxDurationMinutes": 5,
        "deleteMaxUserMessages": 3,
        "archiveAfterDays": 180,
        "keepFavorites": true
    }
}
```

| Setting                    | Default | Description                                                       |
| -------------------------- | ------- | ----------------------------------------------------------------- |
| `deleteMaxDurationMinutes` | `5`     | Conversation duration must be below this value for deletion       |
| `deleteMaxUserMessages`    | `3`     | User-message count must also be below this value for deletion     |
| `archiveAfterDays`         | `180`   | Archive sessions whose last activity is older than this many days |
| `keepFavorites`            | `true`  | Keep sessions with Session Favorites marker files                 |

## Credits

Inspired by the original [Session Snap](https://github.com/tomsej/pi-ext/tree/0446348a0bde13dafb61aeb9f06ad664eecbfcc4/extensions/session-snap) extension by [Tomáš Sejkora](https://github.com/tomsej).
