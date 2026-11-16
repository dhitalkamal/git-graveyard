#!/usr/bin/env bash
# Build (or rebuild) a throwaway repo full of git disasters. Safe to rerun: it deletes only the sandbox folder.
set -euo pipefail
DEST="${1:-$(cd "$(dirname "$0")/../.." && pwd)/graveyard-sandbox}"
case "$DEST" in *graveyard-sandbox*) ;; *) echo "refusing: path must contain graveyard-sandbox"; exit 1;; esac
# empty the folder but keep it, so a terminal already cd'd into it keeps working
mkdir -p "$DEST"; cd "$DEST"
find . -mindepth 1 -maxdepth 1 -exec rm -rf {} +
git init -q -b main
git config user.email sandbox@example.com; git config user.name Sandbox

lines() { for i in $(seq 1 25); do echo "$1 line $i"; done; }
c() { git add -A; git commit -qm "$1"; }

lines "readme" > README.md;          lines "app" > app.js;  c "initial commit"
lines "util" > util.js;                                      c "add util"

# 1. reset --hard: three commits lost
echo "login form" > login.js;  c "add login form"
echo "login validation" >> login.js; c "validate login"
echo "login tests" > login.test.js; c "test login"
git reset -q --hard HEAD~3

# 2. dropped stash
echo "half done refactor" >> app.js
git stash -q
git stash drop -q

# 3. deleted branch
git switch -qc feature/payments
lines "payments" > payments.js; c "add payments"
echo "refund flow" >> payments.js; c "add refunds"
git switch -q main
git branch -D feature/payments >/dev/null

# 3b. big: a 12-file refactor lost to reset
mkdir -p src
for n in $(seq 1 12); do lines "module $n" > "src/mod$n.js"; done
c "big refactor: split app into modules"
git reset -q --hard HEAD~1

# 3c. dying: an experiment lost 29 days ago (reflog expiry is 30 days), so about 1 day left
OLD="$(( $(date +%s) - 29 * 86400 )) +0000"
echo "old experiment" > experiment.js
git add -A
GIT_AUTHOR_DATE="$OLD" GIT_COMMITTER_DATE="$OLD" git commit -qm "try a risky experiment"
GIT_COMMITTER_DATE="$OLD" git reset -q --hard HEAD~1

# 4. ghost: staged edit that was then discarded
{ cat util.js; echo "a precious helper nobody committed"; } > util.js.new && mv util.js.new util.js
git add util.js
git checkout -q HEAD -- util.js

# 5. live work for trying the ward (uncommitted, unstaged, untracked)
echo "my unsaved edit" >> README.md
echo "scratch notes, never added to git" > notes.txt

cat > TRY.txt <<'T'
Try these from this folder (G = path to graveyard/bin/graveyard.js):

  node G                          list the dead (5 graves + 1 ghost)
  node G revive <id>              bring one back on a new branch
  node G ward run -- git reset --hard
  git clean -fd                   notes.txt is gone now
  node G                          a [ward] snapshot holds it
  node G revive w:<name>          get README edit and notes.txt back
T
echo "Sandbox ready: $DEST"
