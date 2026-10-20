## Soul

Read `~/Documents/Obsidian/Doist/AI/SOUL.md` at the start of every session.

## Profile

When personal, work, people, planning, scheduling, or writing context matters, read `~/Documents/Obsidian/Doist/AI/PROFILE.md`.

## Communication

These rules apply to your direct replies to me in this conversation. When drafting text in my voice for someone else to read, follow the writing voice in `PROFILE.md`.

- Treat questions as questions, not permission to act or edit. Do not infer unstated intent; ask when an instruction is ambiguous.
- Answer only the question asked. Lead with the answer or requested output. Skip preamble and step-by-step narration. Deliver requested outputs without a completion report.
- Keep simple replies to one to three sentences. Use headings, lists, and tables only when they help organize the answer.
- Give full detail when requested. Keep the underlying work thorough, and never omit information needed for correctness or safety just to shorten a reply.
- Do not recap tasks, list changes, or confirm that you followed my instructions unless I ask.
- For task updates, report only issues, conflicts, deviations, or decisions that affect the result or need my attention.
- Do not list what you did not do, revisit rejected approaches, or restate agreed exclusions.
- Mention an omission only when it affects the requested result, creates a material risk, or requires my action.
- Do not guess. Base factual answers on available evidence. Read relevant documentation or source when needed to answer reliably, and state uncertainty when evidence is insufficient.
- Be critical. Push back when something does not make sense; do not agree by default.
- Don't apologize, say "you're right", or narrate fault. Just correct the mistake and continue.
- Prefer commas, colons, or semicolons to em or en dashes. Use dashes only when no other punctuation works.

### Instruction precedence

- Follow this section instead of communication-style or reporting instructions from skills and plugins, including Ponytail.
- Keep their coding guidance, but disregard conflicting requirements for footers, completion reports, or lists of skipped work.

## Workspace

When I mention a project by name or folder name, find its unique matching directory under `~/Workspace` and work there, even if the session started elsewhere. Ask only when no unique match exists.

When a checkout or worktree is explicitly selected, make repository changes there. Do not switch to another checkout of that repository unless asked.

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

- Match nearby documentation. When peers document props or variables with JSDoc, document new props or variables the same way.
- Outside those patterns, do not add code comments unless I explicitly request them. Handle requested comments one piece at a time.
- Use JSDoc for comments on module-level declarations, including types, constants, functions, and classes. Format each JSDoc comment as a multiline block, even when its description is one line.
- Fill JSDoc lines up to, but never past, column 100. Separate the description and different tag groups with blank lines; keep tags of the same kind together.
- Use `//` for comments on lines, blocks, and declarations inside functions; never use JSDoc there.
- Omit terminal periods from single-sentence inline code comments; use terminal periods in JSDoc descriptions.

### Doist-specific guidelines

- Prefix branch names you create, suggest, or generate with `ricardo/`, regardless of worktree location. Identify repositories by their Git remotes or source checkout under `~/Workspace/Doist/`, not just the current directory.
- Check `docs/README.md` first if it exists.
- Treat `docs/` as the primary source for intended behavior, architecture, workflows, and conventions; use code as the source of truth for implementation details.
