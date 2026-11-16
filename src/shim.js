import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, delimiter, resolve } from 'node:path';
import { isDestructive, snapshot } from './ward.js';

const MARK = '# graveyard-git-shim';
export const defaultShimDir = () => join(homedir(), '.graveyard', 'bin');

const isExec = (f) => {
  try {
    return statSync(f).isFile() && (statSync(f).mode & 0o111) !== 0;
  } catch {
    return false;
  }
};
const isShim = (f) => {
  try {
    return readFileSync(f, 'utf8').includes(MARK);
  } catch {
    return false;
  }
};

/** First git on PATH that is not a graveyard shim. */
export function findRealGit(pathEnv = process.env.PATH || '', skipDir) {
  const skip = skipDir ? resolve(skipDir) : null;
  for (const d of pathEnv.split(delimiter)) {
    if (!d || (skip && resolve(d) === skip)) continue;
    const f = join(d, 'git');
    if (isExec(f) && !isShim(f)) return realpathSync(f);
  }
  return null;
}

const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export function shimScript({ realGit, node, bin }) {
  return `#!/bin/sh
${MARK}
# Snapshots your work before destructive git commands, then runs the real git.
# Remove this file (or its folder from PATH) to turn it off.
REAL_GIT=${sq(realGit)}
if [ -z "$GRAVEYARD_IN_WARD" ]; then
  sub=""; skip=0
  for a in "$@"; do
    if [ "$skip" = 1 ]; then skip=0; continue; fi
    case "$a" in
      -C|-c|--git-dir|--work-tree|--namespace|--exec-path) skip=1 ;;
      -*) ;;
      *) sub="$a"; break ;;
    esac
  done
  case "$sub" in
    reset|clean|checkout|switch|restore|stash|branch|reflog|gc|filter-branch|filter-repo|worktree)
      GRAVEYARD_IN_WARD=1 GRAVEYARD_REAL_GIT="$REAL_GIT" ${sq(node)} ${sq(bin)} ward check "$@" </dev/null >/dev/null || true ;;
  esac
fi
exec "$REAL_GIT" "$@"
`;
}

/** Write <dir>/git. Returns paths and whether <dir> is already first on PATH. */
export function installShim({ dir = defaultShimDir(), bin, node = process.execPath, pathEnv = process.env.PATH || '' } = {}) {
  const realGit = findRealGit(pathEnv, dir);
  if (!realGit) throw new Error('could not find git on PATH');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'git');
  if (existsSync(file) && !isShim(file)) throw new Error(`${file} exists and is not a graveyard shim; not touching it`);
  writeFileSync(file, shimScript({ realGit, node, bin }), { mode: 0o755 });
  const first = pathEnv.split(delimiter).find(Boolean);
  return { file, dir, realGit, onPath: !!first && resolve(first) === resolve(dir) };
}

export function uninstallShim(dir = defaultShimDir()) {
  const file = join(dir, 'git');
  if (!existsSync(file)) return { file, removed: false };
  if (!isShim(file)) throw new Error(`${file} is not a graveyard shim; not touching it`);
  rmSync(file);
  return { file, removed: true };
}

/** Called by the shim with git's own argv. Snapshots if the command is destructive. */
export function wardCheck(gitArgs, cwd = process.cwd()) {
  const command = 'git ' + gitArgs.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');
  if (!isDestructive(command)) return null;
  let dir = cwd;
  for (let i = 0; i < gitArgs.length; i++) {
    if (gitArgs[i] === '-C' && gitArgs[i + 1]) dir = resolve(dir, gitArgs[++i]);
    else if (!gitArgs[i].startsWith('-')) break;
  }
  try {
    return snapshot(dir, command.slice(0, 120));
  } catch {
    return null; // never block git
  }
}
