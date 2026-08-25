---
description: Draft a pull request, iterate first, create only when I say so
argument-hint: '[ask]'
---

Prepare a pull request for the current branch: identify the base branch (default `main`), the commits, and the full diff. Draft the PR and iterate with me until I'm happy. Do NOT create it until I explicitly say so.

Follow the repo's PR template and any PR guidance in `AGENTS.md`/`docs/` (fallback structure: 🗺 Overview → 🔗 Reference → 🧪 Test plan → 📸 Demo → ✅ Checklist). Use only context from this conversation; don't search for links, tasks, or threads — I'll provide links. My context is for your understanding: judge what belongs in the PR body and never paste it verbatim. Infer rationale from the conversation, commits, and code when the evidence is clear. Never speculate or invent examples or rationale.

The description must stand on its own by explaining what the PR changes and why the change is being made. Keep it scoped to this PR and never discuss what wasn't done. Be brief and scale it to the change: a small or mechanical change usually gets one short paragraph of two to four sentences, including at least one sentence of reviewer-relevant context or motivation. Keep only details that help a reviewer. In an iterative series of related PRs, reuse identical wording for recurring facts (e.g. a feature-flag callout); standalone PRs need no such alignment. Use backticks for literal UI strings, shortcuts, and code references (variables, components, files). Callouts (`> [!TIP]`/`[!NOTE]`/`[!WARNING]`/`[!IMPORTANT]`/`[!CAUTION]`) may be used in any section, but only when something deserves more prominence than a plain sentence and provides real value to the reviewer — never by default.

Overview: lead with what the PR does, then give the concise context or motivation for the change. Mention previous behavior only when it helps explain that context, never as the opening. Don't frame refactors/ports as problem→solution. Skip implementation details unless complex or controversial. Unwrapped paragraphs (no manual line breaks). Use the names from the code and our conversation; never invent labels like "modern"/"new"/v1/v2.

Test plan: for non-behavioral changes (refactors, ports, internal-only), the whole plan is "Code review and CI checks should be sufficient" — that's the default. Otherwise: explicit reviewer actions as numbered steps, one action per item, spelling out every step in a continuous flow; `- [ ]` only for observable assertions phrased "Observe that …", nested under their triggering action, with each observable outcome asserted only once; no trailing periods; distinct scenarios as `###` subsections. Test only what the diff changes, and never assert runtime behavior you haven't verified from the code — ask me instead of guessing. Silently verify these rules before returning the draft.

Reference: only links I provide (`Closes #...` when applicable); omit if none. Demo: before/after table placeholder for visual changes; a single recording placeholder for bigger features; omit when non-visual. Changelog entry and `@external-change` are coupled: include both or neither. Include them only when available repository evidence confirms that the affected behavior is already publicly released; user-facing behavior alone is not sufficient. Inspect feature flags, rollout guards, surrounding code and documentation, and available commit context. Do not ask me to confirm release status. If the feature is internal, flagged, unpublished, partially rolled out, or its release status is unclear, omit both by default. Bug fixes and improvements to confirmed fully released features get both, with the changelog entry following the guidelines the template links to.

Checklist: if the template has one, keep only items the changes actually warrant; always remove the "manually tested by someone other than the PR author" item; keep the bot-review item by default, but don't mention the bot elsewhere. Title: semantic, matching the commit (e.g. `fix(quick-add): ...`).

Label (Doist repos only): `$@` = `ask` → `🙋 Ask PR`; otherwise `👀 Show PR`.

When I approve: create the PR opened (not draft), assigned to me, with the label above. Always end by giving me the PR link.
