---
name: commit
description: Create git commits with clear messages. Use when the user asks to commit, stage changes, or says "commit".
---

# Commit

Create git commits with clear, well-scoped messages.

## Detect Project Convention

Before writing any commit message, check the project's style:

1. Check for commitlint/commitizen config (`.commitlintrc*`, `.czrc`, `commitlint.config.*`, `package.json` `commitlint` or `config.commitizen` fields).
2. Check `CONTRIBUTING.md` for commit message guidelines.
3. If neither exists, run `git log -n 20 --pretty=format:%s` and infer the pattern.
4. If no convention is evident, default to Conventional Commits.

## Conventional Commits Format

```
<type>(<scope>): <summary>

[optional body]
```

| Type       | Purpose                             |
| ---------- | ----------------------------------- |
| `feat`     | New feature                         |
| `fix`      | Bug fix                             |
| `docs`     | Documentation only                  |
| `style`    | Formatting (no logic change)        |
| `refactor` | Code restructuring (no feature/fix) |
| `perf`     | Performance improvement             |
| `test`     | Add/update tests                    |
| `build`    | Build system/dependencies           |
| `ci`       | CI/config changes                   |
| `chore`    | Maintenance/misc                    |
| `revert`   | Revert a previous commit            |

- Summary: imperative mood, <= 72 chars, no trailing period.
- Scope: optional, short noun for the affected area. Check `git log` for commonly used scopes.
- Body: optional. If needed, explain what and why, not how.
- Do NOT include breaking-change markers or footers unless explicitly asked.

## Breaking Changes

Only include when explicitly asked:

- Exclamation mark: `feat!: remove deprecated endpoint`
- Footer: `BREAKING CHANGE: extends key behavior changed`

## Workflow

1. Check `git status`. If files are already staged, review with `git diff --staged`. Otherwise review with `git diff`.
2. If changes span unrelated areas, split into multiple commits:
    - Split by: feature vs refactor, frontend vs backend, formatting vs logic, tests vs production code, dependency bumps vs behavior changes.
    - Use `git add -p` for mixed changes in the same file.
3. Stage only what belongs in the current commit.
4. Review staged changes with `git diff --cached`.
    - No secrets, tokens, or credentials.
    - No accidental debug logging.
    - No unrelated formatting churn.
5. If it's unclear whether a file should be included, ask.
6. Infer the commit type and scope from the staged changes. Write the message following the detected convention.
7. Run `git commit`.

## Handling Instructions

When the user provides context with the commit request:

- File paths or globs (e.g., "commit src/api/\*"): only stage and commit those files.
- Descriptive instructions (e.g., "commit - refactored error handling"): use them to guide the commit message.
- If both are given, respect the file scope and use the description for the message.

## Rules

- One logical change per commit.
- Use present tense ("add" not "added") and imperative mood ("fix bug" not "fixes bug").
- Only commit. NEVER push.
- NEVER skip hooks (`--no-verify`) unless explicitly asked.
- NEVER amend previous commits unless explicitly asked.
- If a commit hook fails, fix the issue and create a new commit.
