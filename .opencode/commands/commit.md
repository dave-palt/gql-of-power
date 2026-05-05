---
description: Run precommit checks and commit changes
agent: build
---

Run `bun run precommit` first. If it fails, fix the issues and re-run before proceeding.

Then analyze all changed/untracked files via `git status` and `git diff`.

## Commit rules

1. **Default**: Only stage and commit files related to the current task/context. Leave unrelated changes unstaged.
2. **If the user explicitly asks to commit unrelated changes too**:
   - Group changes into separate commits by category when detectable (e.g., refactor, feature, docs, config).
   - Unless the user says "commit everything together" — then create a single commit.
3. Write concise commit messages following the repo's recent style (check `git log`).
