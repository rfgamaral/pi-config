## Superpowers

Superpowers is OPT-IN. Do not invoke any Superpowers skill unless I explicitly ask to use Superpowers. This instruction overrides any Superpowers text requiring mandatory or automatic invocation.

For normal tasks, implement directly and run proportional verification. Do not create specs or implementation plans, or request design approval, unless explicitly requested.

## Workspace

When I mention a project by name or folder name, find its unique matching directory under `~/Workspace` and work there, even if the session started elsewhere. Ask only when no unique match exists.

## Development

### Universal guidelines

- Before editing code, identify and follow the repository’s development conventions, tooling, and required checks, including contribution docs, package/task runners, and lint/test commands.
- For substantial changes, work in the smallest self-contained, independently reviewable increments and stop for feedback after each one unless I ask otherwise.
- Do not create or modify tests for bug fixes or features unless I explicitly request them. Validate implementation without new test code; existing tests may still be run.
- If a mechanical fix triggers additional violations, stop and ask whether to keep the partial fix, revert it, or continue; never expand scope silently.
- “Commit” means create a new commit on top of `HEAD`; “amend” means amend `HEAD`. Never amend unless I explicitly say “amend”.

### Doist-specific guidelines

- For repos under `~/Workspace/Doist/`, prefix branch names with `ricardo/`.
- Check `docs/README.md` first if it exists.
- Treat `docs/` as the primary source for intended behavior, architecture, workflows, and conventions; use code as the source of truth for implementation details.
