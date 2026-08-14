# Session Favorites

Mark Pi sessions as favorites and resume them from a focused session picker. The extension keeps
favorite state separate from session data and uses Pi's built-in session picker.

## Commands

- `/favorite` adds the current persisted session to favorites. If it is already a favorite, nothing
  changes.
- `/unfavorite` removes the current session from favorites. If it is not a favorite, nothing
  changes.
- `/favorites` opens the session picker with favorite sessions only.

## Picker Behavior

The picker starts with favorites from the current folder. Press Tab to show favorites from all
folders.

Because the extension uses Pi's built-in session picker, it also supports:

- Search
- Threaded, recent, and fuzzy sorting
- Named-session filtering
- Session path display
- Rename and delete actions
- Current-session highlighting
- Session switching

## How It Works

Each favorite is an empty file named after the session ID. The `favorites` directory mirrors Pi's
project directories under `sessions`:

```text
sessions/
└── <project-directory>/
    └── <timestamp>_<session-id>.jsonl

favorites/
└── <project-directory>/
    └── <session-id>
```

The extension resolves each marker to its local session file when the picker opens. A marker with
no matching session file does not appear in the picker. If a previously resolved session is deleted
from the picker, the extension also removes its marker.

Marker files contain no session content or path metadata. The extension has no configuration.
