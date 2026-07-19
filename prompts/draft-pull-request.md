---
description: Draft a pull request, iterate first, create only when I say so
argument-hint: '[ask]'
---

Prepare a pull request for the current branch: identify the base branch (default `main`), the commits, and the full diff. Draft the PR and iterate with me until I'm happy. Do NOT create it until I explicitly say so.

Follow the repo's PR template and any PR guidance in `AGENTS.md`/`docs/` (fallback structure: 🗺 Overview → 🔗 Reference → 🧪 Test plan → 📸 Demo → ✅ Checklist). Use only context from this conversation; don't search for links, tasks, or threads — I'll provide links. My context is for your understanding: judge what belongs in the PR body, never paste it verbatim, and never invent examples or justifications I didn't give.

The description must stand on its own and only describe what this PR changes — never what wasn't done. Be brief and scale it to the change: a small or mechanical change gets a couple of sentences. Keep only details that help a reviewer. In an iterative series of related PRs, reuse identical wording for recurring facts (e.g. a feature-flag callout); standalone PRs need no such alignment. Use backticks for literal UI strings, shortcuts, and code references (variables, components, files). Callouts (`> [!TIP]`/`[!NOTE]`/`[!WARNING]`/`[!IMPORTANT]`/`[!CAUTION]`) may be used in any section, but only when something deserves more prominence than a plain sentence and provides real value to the reviewer — never by default.

Overview: lead with what the PR does, then why if not obvious. Mention previous behavior only when it adds value, never as the opening. Don't frame refactors/ports as problem→solution. Skip implementation details unless complex or controversial. Unwrapped paragraphs (no manual line breaks). Use the names from the code and our conversation; never invent labels like "modern"/"new"/v1/v2.

Test plan: for non-behavioral changes (refactors, ports, internal-only), the whole plan is "Code review and CI checks should be sufficient" — that's the default. Otherwise: explicit reviewer actions, one per bullet, spelling out every step in a continuous flow; `- [ ]` only for observable assertions phrased "Observe that …", nested under their triggering action, never duplicated; no trailing periods; distinct scenarios as `###` subsections. Test only what the diff changes, and never assert runtime behavior you haven't verified from the code — ask me instead of guessing.

Reference: only links I provide (`Closes #...` when applicable); omit if none. Demo: before/after table placeholder for visual changes; a single recording placeholder for bigger features; omit when non-visual. Changelog entry: only when the change is user-facing AND touches something already publicly released — bug fixes, improvements, or changes to fully rolled-out features get one (following the guidelines the template links to) plus the `@external-change` label; iterations on internal/flagged features that haven't shipped publicly get none.

Checklist: if the template has one, keep only items the changes actually warrant; always remove the "manually tested by someone other than the PR author" item; keep the bot-review item by default, but don't mention the bot elsewhere. Title: semantic, matching the commit (e.g. `fix(quick-add): ...`).

Stacked PRs: base each PR on the previous branch and add a `## 🧭 Stack` section right after the Overview (before the Test plan): a numbered list of the full PR URLs in stack order, with the current PR's entry replaced by `👉 This PR`. Every PR in the stack carries the full list, so after creating a new one, go back and update the Stack section of all previously created PRs in the stack.

Label (Doist repos only): `$@` = `ask` → `🙋 Ask PR`; otherwise `👀 Show PR`.

When I approve: create the PR opened (not draft), assigned to me, with the label above. Always end by giving me the PR link.
