# Graveyard

Find and bring back the work git lost, and save your work before an AI agent can destroy it.

It's 2 AM. You, or your AI agent, just ran `git reset --hard`, and three days of work are gone.

Except they aren't. Git rarely deletes anything right away. Lost commits, dropped stashes,
deleted branches and staged-then-discarded files usually stay inside your repo for weeks.
You just can't see them. Graveyard shows them to you, tells you what each one holds, and
brings any of them back on a new branch without touching the work you have now.

```
npx graveyard        # list the dead
npx graveyard ui     # walk the cemetery in 3D
```

## What it finds

| Grave | What it is | Where git keeps it | Expires |
|---|---|---|---|
| Lost commits | Commits no branch points at, after `reset --hard`, `rebase`, `commit --amend` | the reflog | `gc.reflogExpireUnreachable`, 30 days by default |
| Deleted branch | Commits from a branch you deleted with `branch -D` | HEAD's reflog | 30 days by default |
| Dropped stash | A stash you dropped or cleared | unreachable objects | `gc.pruneExpire`, 2 weeks by default |
| Ghost file | A file version you staged once, then threw away | a nameless blob | 2 weeks by default |
| Ward snapshot | A copy of all your work, saved by a ward before a risky command | `refs/graveyard/ward/*` | never, until you delete it |

Each grave shows:

- **what** it is, with a readable headline ("Uncommitted changes on main", "Snapshot before git reset --hard")
- **where** it came from (the branch) and **what killed it** (the reflog line, or the branch that was deleted)
- **what is inside**: commits, files and `+added -removed` line counts
- **the full diff**, so you can read the changes before you raise anything
- **time left** before `git gc` may delete it for good. Stones crack and lean as that time runs out.

Ghosts are blobs with no file name. The séance compares each ghost with the files in `HEAD`
and guesses where it belonged, with a match score. The diff for a ghost shows your current
file against the lost version.

## Install

Needs Node 18+ and git.

```
npx graveyard
```

or install it globally:

```
npm install -g graveyard
```

## Commands

```
graveyard [scan] [--json] [--no-ghosts]   list lost commits, stashes, ghosts and ward snapshots
graveyard show <id>                       print what a grave holds: commits and the full diff
graveyard revive <id>                     bring one back on a new branch
graveyard ui [--port N]                   open the 3D cemetery in your browser
graveyard ward snapshot [reason]          save all work now (staged, unstaged, untracked)
graveyard ward run -- <command...>        snapshot first if the command is destructive, then run it
graveyard ward install                    add the Claude Code hook to .claude/settings.json
graveyard ward shim [--dir D]             install a git shim that guards every agent and shell
graveyard ward unshim [--dir D]           remove the git shim
graveyard ward list                       list ward snapshots
```

Find what matters first:

```
graveyard --dying              # git may prune these within 3 days: save them first
graveyard --big                # 100+ changed lines or 10+ files
graveyard --sort dying         # or: newest (default), biggest
```

The cemetery has the same filters under the tabs. The sort decides who stands in the
front row. Big graves stand taller, and dying ones pulse red.

Ids look like `c:2a3a289` (commit), `s:546a946` (stash), `g:6156d44` (ghost) and
`w:20261116T060717` (ward). A unique sha prefix works too.

### Example

```
$ graveyard
[grave] c:ee5353b  add refunds  [fresh, 27d left]
    2 commits, on feature/payments, 1 file, +26 -0 | died 2d ago | killed by "branch feature/payments deleted"
      +26 -0  payments.js

[stash] s:546a946  Uncommitted changes on main  [fresh, 11d left]
    on main, 1 file, +1 -0 | died 2d ago | killed by "stash dropped or cleared"
      +1 -0  app.js

$ graveyard show c:ee5353b      # read the commits and the diff
$ graveyard revive c:ee5353b
Raised c:ee5353b on branch graveyard/commit-ee5353b.
```

## Reviving is safe

`revive` only creates a new branch, `graveyard/<kind>-<sha>`. It never moves `HEAD`, never
touches your index or work tree, and never overwrites a branch that already exists. A ghost
comes back as a new commit on top of `HEAD` with the file under `recovered/<sha>/<path>`,
so it can't overwrite the real file either. Look at the branch, then merge, cherry-pick or
copy what you need.

## The cemetery

```
graveyard ui
```

This opens a three.js scene at `http://127.0.0.1:4747/`:

- Drag to orbit, right-drag to pan, scroll to zoom.
- Hover a grave for a quick card with its summary and top files.
- Click a grave to open its panel. **Overview** shows facts, commits and files with
  change bars. **Changes** shows the colored diff, file by file.
- Press **Raise on a new branch**. A beam of light comes down and the grave rises.
- Tabs at the top filter by kind.

The server binds to `127.0.0.1` only and rejects other host names. Raising needs a random
token that is made fresh on each run. three.js is served from your own `node_modules`,
so the page loads nothing from the internet.

## Wards: never need Graveyard again

Git only saves what it has seen. An edit you never staged is not in git at all, so after
`git reset --hard` or `git clean -fd` nothing can bring it back. A ward fixes this. Just
before a destructive git command runs, it saves everything (staged, unstaged and untracked
files, minus ignored ones) as a commit under `refs/graveyard/ward/`. It uses a throwaway
index, so your real index and files are never touched.

Commands that trigger a ward: `reset --hard/--merge/--keep`, `clean -f`, `checkout -- <path>`
and `checkout .`, `switch --discard-changes/-f`, `restore` (except `--staged` only),
`stash drop/clear`, `branch -D`, `worktree remove --force`, `reflog expire/delete`,
`gc --prune`, `filter-branch` and `filter-repo`.

A ward never blocks or changes the command. It only saves first.

### Any agent or shell: the git shim

```
graveyard ward shim
export PATH="$HOME/.graveyard/bin:$PATH"     # add to ~/.zshrc or ~/.bashrc
```

The shim is a small `git` script placed first on `PATH`. It checks the subcommand in plain
shell, so `git status` and `git diff` cost almost nothing. Only possibly destructive commands
start Node to decide whether to snapshot. It then runs your real git with the same
arguments. `-C <dir>` is handled.

To guard only one agent:

```
PATH="$HOME/.graveyard/bin:$PATH" claude
PATH="$HOME/.graveyard/bin:$PATH" codex
```

Turn it off with `graveyard ward unshim`.

### Claude Code: the hook

```
graveyard ward install
```

This adds a `PreToolUse` hook for the `Bash` tool to `.claude/settings.json` in the repo.
The hook reads the command, snapshots if it's destructive, and lets it run.

### By hand

```
graveyard ward run -- git reset --hard origin/main
graveyard ward snapshot "before trying something risky"
```

Ward snapshots never expire. Delete one with `git update-ref -d refs/graveyard/ward/<name>`.

## How it works

- **Lost commits** come from `git log -g --all`. Each reflog entry that is no longer reachable
  becomes a candidate, and the newer entry that moved the ref is recorded as the killer.
  Chains are collapsed so one `reset --hard HEAD~3` is one grave holding 3 commits.
- **Deleted branches** leave no reflog of their own. Graveyard finds them through `HEAD`'s
  `checkout: moving from <branch>` lines and checks that the branch is gone.
- **Stashes and anything else unreachable** come from `git fsck --unreachable --no-reflogs`.
  Stash commits are recognized by their message and parents. Their untracked-files parent
  is included in the diff.
- **Ghosts** are unreachable blobs that don't belong to any grave. The séance scores each
  one against the text files in `HEAD` by shared lines (Jaccard) and keeps matches of 40%
  or more.
- **Time left** uses your own `gc.reflogExpireUnreachable` and `gc.pruneExpire` settings.
  For loose objects the clock starts at the object file's time. It's an estimate: git does
  not record exactly when it will prune.

## Limits

- Graveyard can't recover something git never stored. That's what wards are for.
- After `git gc --prune=now`, unreachable objects are gone for good.
- Packed unreachable objects have no file time, so their "time left" is a rough guess.
- The ghost scan looks at the 200 newest blobs and compares files up to 512 KB.

## Development

```
npm install
npm test
./scripts/sandbox.sh      # builds ../graveyard-sandbox, a repo full of git disasters to try things on
```

## License

MIT
