import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, tryGit, hasHead } from './git.js';
import { scan } from './scan.js';

const IDENT = {
  GIT_AUTHOR_NAME: 'Graveyard',
  GIT_AUTHOR_EMAIL: 'graveyard@localhost',
  GIT_COMMITTER_NAME: 'Graveyard',
  GIT_COMMITTER_EMAIL: 'graveyard@localhost',
};

function freeBranch(top, base) {
  let name = base;
  for (let i = 2; tryGit(top, ['rev-parse', '--verify', '-q', `refs/heads/${name}`]) !== null; i++) name = `${base}-${i}`;
  return name;
}

/** Put a ghost blob on a new branch, in a new commit built off HEAD. The work tree and index stay untouched. */
function branchFromBlob(top, tomb) {
  const dir = mkdtempSync(join(tmpdir(), 'graveyard-'));
  const env = { GIT_INDEX_FILE: join(dir, 'index'), ...IDENT };
  try {
    const head = hasHead(top);
    if (head) git(top, ['read-tree', 'HEAD'], { env });
    const rel = tomb.guess ? tomb.guess.path : `${tomb.sha.slice(0, 7)}.txt`;
    const path = `recovered/${tomb.sha.slice(0, 7)}/${rel}`;
    git(top, ['update-index', '--add', '--cacheinfo', `100644,${tomb.sha},${path}`], { env });
    const tree = git(top, ['write-tree'], { env }).trim();
    const args = ['commit-tree', tree, '-m', `graveyard: recovered ghost ${tomb.sha.slice(0, 7)}${tomb.guess ? ` (looks like ${tomb.guess.path})` : ''}`];
    if (head) args.push('-p', 'HEAD');
    return { sha: git(top, args, { env }).trim(), path };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Bring one tombstone back on a new branch. Never moves HEAD, never touches the work tree. */
export function revive(cwd, idOrSha) {
  const { top, tombstones } = scan(cwd);
  const q = idOrSha.replace(/^[a-z]:/, '');
  const matches = tombstones.filter((t) => t.id === idOrSha || t.sha.startsWith(q));
  if (!matches.length) throw new Error(`no tombstone matches "${idOrSha}"`);
  if (matches.length > 1) throw new Error(`"${idOrSha}" matches ${matches.length} tombstones: ${matches.map((m) => m.id).join(', ')}`);
  const tomb = matches[0];

  let target = tomb.sha;
  let extra = null;
  if (tomb.kind === 'ghost') ({ sha: target, path: extra } = branchFromBlob(top, tomb));
  const label = tomb.kind === 'stash' ? 'stash' : tomb.kind === 'ghost' ? 'ghost' : tomb.kind === 'ward' ? 'ward' : 'commit';
  const branch = freeBranch(top, `graveyard/${label}-${tomb.sha.slice(0, 7)}`);
  git(top, ['branch', branch, target]);
  return { branch, tomb, file: extra };
}
