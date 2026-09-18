---
name: obsidian-vault
description: Use when reading, searching, creating, or editing notes in the Obsidian vault, or when the user mentions a vault, knowledge base, notes, snippets, meeting notes, review notes, or similar note-taking content.
---

# Obsidian Vault

## Overview

Direct filesystem access to read and edit Markdown notes. No CLI or running Obsidian instance required.

## Vault Location

```
~/Documents/Obsidian/
```

## Note Placement

- Apply these rules only when creating a note. For edits or appends, use the requested note instead.
- Use an explicit destination when one is provided.
- Otherwise, search the vault and create related notes beside the related material.
- Otherwise, place temporary or unrelated notes at the vault root.
- Move root notes only when asked to persist them elsewhere.

## Conventions

- **Links:** Use standard Markdown `[text](path)`, not `[[wikilinks]]`. This convention takes precedence over `obsidian-markdown`.
- **Attachments:** Stored in `./attachments/` relative to the note's folder
- **Templates:** Located in `Templates/`. Treat them as read-only reference unless the user explicitly asks to create or edit a template.
- **Markdown syntax:** For Obsidian-specific syntax other than links, follow the `obsidian-markdown` skill when it is available.

## Guardrails

**`.obsidian/` is OFF-LIMITS.** Never read, modify, or delete anything inside `.obsidian/` unless the user gives explicit approval. Always ask first — never assume. This contains all app settings, plugins, and workspace state.

**Never overwrite or delete existing notes without explicit user approval.** Always show the user what will change before modifying an existing file. For new files, confirm the path and show a preview of the content before writing.

**When editing existing notes**, use surgical edits (find and replace) rather than full file rewrites to minimize risk of data loss.

**When moving or renaming notes**, find affected links first, then update incoming links and any affected relative links or attachment paths.
