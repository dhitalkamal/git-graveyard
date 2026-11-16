---
inclusion: always
name: structure
description: Where code lives in Graveyard and the file-size rule
---

# Structure

| Path | Job |
|---|---|
| `bin/graveyard.js` | CLI entry: argument parsing and printing only |
| `src/git.js` | the only place that spawns git |
| `src/scan.js` | finds graves: reflog, fsck, ghosts, wards |
| `src/changes.js` | diff ranges, `+/-` stats and patches per grave |
| `src/filter.js` | big / dying / sort; shared by CLI and UI |
| `src/revive.js` | raise a grave onto a new branch |
| `src/ward.js` | snapshot, destructive-command check, hooks, delete |
| `src/shim.js` | the `git` shim for any agent |
| `src/server.js` | local UI server and JSON API |
| `src/ui.html` | the three.js cemetery |
| `scripts/sandbox.sh` | builds `../graveyard-sandbox`, a repo full of git disasters |

## Rules

- No source file over 500 lines. Split by job before crossing it.
- Logic shared by CLI and UI lives in `src/*.js` and is served to the page from
  `/lib/<file>.js`; do not copy it into the page.
- New git behavior goes in `src/`, never in `bin/`.
