import { execFileSync } from 'node:child_process';

export class GitError extends Error {}

export function git(cwd, args, { env, input, buffer = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      input,
      env: { ...process.env, ...env },
      encoding: buffer ? null : 'utf8',
      maxBuffer: 1 << 30,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    const msg = (e.stderr ? e.stderr.toString() : e.message).trim();
    const err = new GitError(`git ${args.join(' ')}: ${msg}`);
    err.status = e.status;
    throw err;
  }
}

export function tryGit(cwd, args, opts) {
  try {
    return git(cwd, args, opts);
  } catch {
    return null;
  }
}

export const lines = (s) => (s || '').split('\n').filter(Boolean);

export function repoTop(cwd) {
  const out = tryGit(cwd, ['rev-parse', '--show-toplevel']);
  if (!out) throw new GitError(`not a git repository: ${cwd}`);
  return out.trim();
}

export const hasHead = (cwd) => tryGit(cwd, ['rev-parse', '--verify', '-q', 'HEAD']) !== null;

/** Read many objects with one `git cat-file --batch` call. Returns Map(sha -> Buffer). */
export function catBatch(cwd, shas) {
  const out = new Map();
  if (!shas.length) return out;
  const buf = git(cwd, ['cat-file', '--batch'], { input: shas.join('\n') + '\n', buffer: true });
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) break;
    const [sha, type, size] = buf.toString('utf8', pos, nl).split(' ');
    if (type === 'missing') {
      pos = nl + 1;
      continue;
    }
    const n = Number(size);
    out.set(sha, buf.subarray(nl + 1, nl + 1 + n));
    pos = nl + 1 + n + 1;
  }
  return out;
}

/** Keep only the shas that still exist in the object store. */
export function existing(cwd, shas) {
  if (!shas.length) return [];
  const out = git(cwd, ['cat-file', '--batch-check'], { input: shas.join('\n') + '\n' });
  return lines(out)
    .filter((l) => !l.endsWith(' missing'))
    .map((l) => l.split(' ')[0]);
}
