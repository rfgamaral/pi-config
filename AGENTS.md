## Superpowers

Superpowers is OPT-IN. Do not invoke any Superpowers skill unless I explicitly ask to use Superpowers. This instruction overrides any Superpowers text requiring mandatory or automatic invocation.

For normal tasks, implement directly and run proportional verification. Do not create specs or implementation plans, or request design approval, unless explicitly requested.

## Communication

- Treat questions as questions, not permission to act or edit. Do not infer unstated intent; ask when an instruction is ambiguous.
- Answer only the question asked. Do not mention what you would not do or revisit rejected approaches unless I ask or it prevents a likely mistake.
- Do not guess. Read the relevant documentation and source, then verify before answering.
- Be critical. Push back when something does not make sense; do not agree by default.
- Don't apologize, say "you're right", or narrate fault. Just correct the mistake and continue.
- Prefer commas, colons, or semicolons to em or en dashes. Use dashes only when no other punctuation works.

## Workspace

When I mention a project by name or folder name, find its unique matching directory under `~/Workspace` and work there, even if the session started elsewhere. Ask only when no unique match exists.

## Development

### Universal guidelines

- Before editing code, identify and follow the repository’s development conventions, tooling, and required checks, including contribution docs, package/task runners, and lint/test commands.
- For substantial changes, work in the smallest self-contained, independently reviewable increments and stop for feedback after each one unless I ask otherwise.
- Do not create or modify tests for bug fixes or features unless I explicitly request them. Validate implementation without new test code; existing tests may still be run.
- If a mechanical fix triggers additional violations, stop and ask whether to keep the partial fix, revert it, or continue; never expand scope silently.
- “Commit” means create a new commit on top of `HEAD`; “amend” means amend `HEAD`. Never amend unless I explicitly say “amend”.
- Never modify, restore, or undo my manual code changes unless I explicitly ask. Treat unexpected concurrent/manual edits as intentional and preserve them.

### Code style

#### Code comments

- Do not add code comments unless I explicitly request them. Handle requested comments one piece at a time.
- Match nearby documentation: do not document new props or variables unless their peers are documented.
- Use JSDoc for comments on module-level declarations, including types, constants, functions, and classes. Format each JSDoc comment as a multiline block, even when its description is one line.
- Fill JSDoc lines up to, but never past, column 100. Separate the description and different tag groups with blank lines; keep tags of the same kind together.
- Use `//` for comments on lines, blocks, and declarations inside functions; never use JSDoc there.
- Omit terminal periods from single-sentence inline code comments; use terminal periods in JSDoc descriptions.

### Doist-specific guidelines

- For repos under `~/Workspace/Doist/`, prefix branch names with `ricardo/`.
- Check `docs/README.md` first if it exists.
- Treat `docs/` as the primary source for intended behavior, architecture, workflows, and conventions; use code as the source of truth for implementation details.
