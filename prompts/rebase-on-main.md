---
name: rebase-on-main
description: Fetch and rebase current branch onto the latest origin/main
---

Rebase my current branch onto the latest origin/main. Stop if I'm already on main. Leave local main and other worktrees untouched.

Fetch first. Preserve uncommitted changes, including untracked files, and their staging; restore them after the rebase.

Resolve straightforward conflicts. Ask me if the intended result is unclear.

Report the result: branch name, commits ahead of origin/main, and whether uncommitted changes were preserved.

---

Optional post-rebase action: $1

If `push`, run `git push --force-with-lease` after the rebase and restoration succeed. Otherwise, don't push. Stop and report unexpected errors.
