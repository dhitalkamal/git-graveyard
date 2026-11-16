---
inclusion: always
name: tech
description: Stack, git-calling rules and test rules for Graveyard
---

# Tech

- Node 18+, ES modules, no build step. The only runtime dependency is `three`.
- Tests: `npm test` (node:test). Every behavior change gets a test in
  `test/graveyard.test.js` that builds a throwaway repo under `os.tmpdir()`.
- Run `npm test` before every commit. All tests must pass.

## Calling git

- Call git only through `git()` / `tryGit()` in `src/git.js`. They use
  `execFileSync` with an argument array, never a shell string, so file names and
  ref names can never be interpreted by a shell.
- `src/git.js` honors `GRAVEYARD_REAL_GIT` so the git shim does not recurse.
- Read many objects with `catBatch()` (one `git cat-file --batch`), not one call
  per object.
- Never write to the user's real index. Use a throwaway `GIT_INDEX_FILE` in a
  temp dir, as `snapshot()` and the ghost revive do.

## Time

- A grave's death time comes from the reflog entry's own timestamp
  (`git log -g --date=unix`), never from the commit date.
- Expiry uses the repo's `gc.reflogExpireUnreachable` and `gc.pruneExpire`.

## Text

- ASCII only in committed files, except the word "séance". A pre-commit hook
  rejects emoji, arrows, smart quotes and em dashes.
