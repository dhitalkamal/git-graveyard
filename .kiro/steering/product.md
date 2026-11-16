---
inclusion: always
name: product
description: What Graveyard is, who it is for, and the promises it must never break
---

# Product: Graveyard (npm: git-graveyard)

Graveyard finds work git lost (lost commits, deleted branches, dropped stashes,
staged-then-discarded files) and brings it back. Wards snapshot all work before
an AI agent or a person runs a destructive git command.

## Promises (never break these)

- Reviving never moves HEAD, never touches the index or work tree, and never
  overwrites an existing branch. It only creates `graveyard/<kind>-<sha>`.
- A ward never blocks or changes the command it guards. If snapshotting fails,
  the command still runs.
- Nothing is deleted except a ward ref the user explicitly deletes (two clicks in
  the UI, or `ward delete <id>`). Every delete prints its undo command.
- The UI server binds to 127.0.0.1 only, rejects foreign Host headers, and
  requires the per-run token on every POST.
- The page loads nothing from the internet. three.js is served from node_modules.

## Users

- A developer at 2 AM who just lost work. They need to see what each grave holds
  before choosing, so every grave shows a headline, a summary, files with +/-
  counts, and a full diff.
- An AI agent's operator who wants wards in front of the agent.

## Naming

- The npm package and README command is `git-graveyard` (`npx git-graveyard`).
  The npm name `graveyard` belongs to someone else.
- Grave kinds in UI text: lost commit(s), deleted branch, dropped stash,
  ghost file, ward snapshot.
