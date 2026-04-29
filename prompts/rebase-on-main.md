---
name: rebase-on-main
description: Fetch and rebase current branch onto the main branch
---

Rebase my current branch onto the latest main. If I'm already on main, STOP!

Check `git status --porcelain` for uncommitted changes. If any, `git stash push -u -m "pi-rebase-auto-stash"` before starting; you'll restore them at the end.

Fetch and update main: `git fetch origin main`, then `git branch -f main origin/main`. If the fetch fails, pop any stash and stop. Run `git rebase origin/main`. If there are conflicts, try to resolve them yourself. If you genuinely can't, `git rebase --abort`, restore the stash, and ask me: explain which file and why.

After a successful rebase, if you stashed earlier, `git stash pop` (resolve conflicts the same way), then `git reset HEAD` to unstage. Drop the stash if it's still in the list. Confirm the result: branch name, commits ahead of main, and whether changes were stashed/restored.

---

Optional post-rebase action: $1

If `push`, run `git push --force-with-lease` after success. Otherwise, don't push. Stop and report unexpected errors.
