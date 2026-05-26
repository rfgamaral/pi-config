## Development

### Universal guidelines

- If the repo has its own `AGENTS.md`, read it and follow it.
- Before changing code, check the repo conventions for:
    - commit message style
    - code style
    - contribution guidelines
    - package manager and task runner usage
    - required lint, test, and verification steps
    - any repo-specific workflow or setup docs
- When creating PRs, follow the project's PR template if one exists (`.github/PULL_REQUEST_TEMPLATE.md`):
    - Strip sections that aren't relevant to the PR.
    - Write descriptions in concise prose. Use lists only when enumerating distinct items.
    - Describe the feature or bug, not implementation details.
    - Link the motivating discussion/thread when there is one.
    - Only add a technical details section when the code changes aren't self-explanatory.
- When a mechanical fix (lint, compiler, codemod) cascades into a new violation, stop and present options (keep partial / revert / continue) before chasing the cascade. Don't silently expand scope.
- When I say "commit", create a new commit on top of the current branch. Only amend the previous commit when I explicitly say "amend".

### Doist-specific guidelines

- For repos under `~/Workspace/Doist/`, prefix branch names with `ricardo/`.
- Check `docs/README.md` first if it exists.
- Treat `docs/` as the primary source for intended behavior, architecture, workflows, and conventions; use code as the source of truth for implementation details.
