---
name: obsidian-vault
description: Use when reading, searching, creating, or editing notes in the Obsidian vault, or when the user references their personal knowledge base
---

# Obsidian Vault

## Overview

Direct filesystem access to the user's Obsidian vault. Read, search, create, and edit markdown notes. No CLI or running Obsidian instance required.

## Vault Location

```
~/Documents/Obsidian/
```

## Structure

```
Obsidian/
├── .obsidian/          # ⛔ NEVER TOUCH
├── Templates/          # Obsidian templates (read-only reference)
├── Doist/              # Work notes
├── Personal/           # Personal notes
└── *.md                # Root-level notes
```

## Conventions

- **Links:** Standard markdown `[text](path)` (not `[[wikilinks]]`)
- **Attachments:** Stored in `./attachments/` relative to the note's folder
- **Templates:** Located in `Templates/`, used by Obsidian's core template plugin
- **Markdown syntax:** If the `obsidian-markdown` skill is available, follow it for Obsidian-specific syntax (callouts, embeds, properties, etc.)

## Guardrails

**`.obsidian/` is OFF-LIMITS.** Never read, modify, or delete anything inside `.obsidian/` unless the user gives explicit approval. Always ask first — never assume. This contains all app settings, plugins, and workspace state.

**Never overwrite or delete existing notes without explicit user approval.** Always show the user what will change before modifying an existing file. For new files, confirm the path and show a preview of the content before writing.

**When editing existing notes**, use surgical edits (find and replace) rather than full file rewrites to minimize risk of data loss.

**When moving or renaming notes**, always search for and update all references to the note across the vault. Use the backlinks command to find affected files before moving.

## Operations Quick Reference

| Task                 | How                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------- | --- | --------------------------------- |
| Find notes           | `find ~/Documents/Obsidian/ -name "*.md" -not -path "*/.obsidian/*"`                                                                    |
| Search content       | `rg "query" ~/Documents/Obsidian/ --glob "!.obsidian"`                                                                                  |
| Read a note          | Read tool with the file path                                                                                                            |
| Create a note        | Write tool — confirm path and preview content with user first                                                                           |
| Edit a note          | Edit tool — show the change to the user first                                                                                           |
| Recent notes (Linux) | `find ~/Documents/Obsidian/ -name "*.md" -not -path "*/.obsidian/*" -mtime -7 -printf "%T@ %p\n" \| sort -rn \| cut -d' ' -f2-`         |
| Recent notes (macOS) | `find ~/Documents/Obsidian/ -name "*.md" -not -path "*/.obsidian/*" -mtime -7 -exec stat -f "%m %N" {} + \| sort -rn \| cut -d' ' -f2-` |
| Backlinks            | `rg "Note Name" ~/Documents/Obsidian/ --glob "!.obsidian" -l`                                                                           |
| Vault overview       | `find ~/Documents/Obsidian/ -type d -not -path "*/.obsidian/*"`                                                                         |
| Notes per folder     | `find ~/Documents/Obsidian/ -name "_.md" -not -path "_/.obsidian/\*" \| sed 's                                                          | /[^/]\*$ |     | ' \| sort \| uniq -c \| sort -rn` |
| Find todos           | `rg "\- \[ \]" ~/Documents/Obsidian/ --glob "!.obsidian"`                                                                               |
| Find tags            | `rg "#[\w][\w/-]+" ~/Documents/Obsidian/ --glob "!.obsidian" -o \| sort \| uniq -c \| sort -rn`                                         |
