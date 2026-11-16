import { git, tryGit, lines, hasHead, catBatch } from './git.js';

const MAX_PATCH = 400 * 1024; // bytes of diff text sent to the UI per tombstone
const MAX_COMMITS = 50;

let emptyTreeCache = new Map();
/** The empty tree id for this repo's hash format (sha1 or sha256). */
export function emptyTree(top) {
  if (!emptyTreeCache.has(top)) emptyTreeCache.set(top, git(top, ['hash-object', '-t', 'tree', '/dev/null']).trim());
  return emptyTreeCache.get(top);
}

export const parentsOf = (top, sha) => lines(tryGit(top, ['rev-list', '--parents', '-n', '1', sha])).join(' ').split(' ').slice(1);

/**
 * What a tombstone holds, as [from, to, label] diff ranges.
 *  commit: everything the lost chain added on top of where it forked
 *  stash:  the work-tree changes, plus any untracked files it stashed
 *  ward:   everything that differed from HEAD when the snapshot was taken
 */
export function rangesOf(top, t) {
  const empty = emptyTree(top);
  if (t.kind === 'commit') return [[t.base || empty, t.sha, null]];
  const parents = t.parents ?? parentsOf(top, t.sha);
  if (t.kind === 'stash') {
    const r = [[parents[0] || empty, t.sha, null]];
    if (parents[2]) r.push([empty, parents[2], 'untracked']);
    return r;
  }
  if (t.kind === 'ward') return [[parents[0] || empty, t.sha, null]];
  return [];
}

function parseNumstat(out) {
  return lines(out).map((l) => {
    const [a, d, ...p] = l.split('\t');
    const binary = a === '-';
    return { path: p.join('\t'), added: binary ? 0 : Number(a), removed: binary ? 0 : Number(d), binary };
  });
}

/** Per-file +/- counts for a tombstone. Cheap enough to run during a scan. */
export function statOf(top, t) {
  let files = [];
  if (t.kind === 'ghost') {
    if (t.guess && hasHead(top)) {
      const f = parseNumstat(tryGit(top, ['diff', '--numstat', `HEAD:${t.guess.path}`, t.sha]))[0];
      files = [{ path: t.guess.path, added: f?.added ?? 0, removed: f?.removed ?? 0, binary: !!f?.binary, guessed: true }];
    } else {
      const n = t.lineCount ?? 0;
      files = [{ path: '(nameless)', added: n, removed: 0, binary: !!t.binary }];
    }
  } else {
    for (const [from, to, label] of rangesOf(top, t)) {
      for (const f of parseNumstat(tryGit(top, ['diff', '--numstat', '-M', from, to]))) {
        files.push(label ? { ...f, note: label } : f);
      }
    }
  }
  return {
    files,
    added: files.reduce((s, f) => s + f.added, 0),
    removed: files.reduce((s, f) => s + f.removed, 0),
  };
}

/** Full detail for the UI: commit list and the unified diff. */
export function detailOf(top, t) {
  const out = { id: t.id, commits: [], patch: '', truncated: false };
  if (t.kind === 'commit') {
    const range = t.base ? [`${t.base}..${t.sha}`] : [t.sha];
    out.commits = lines(tryGit(top, ['log', `-${MAX_COMMITS}`, '--format=%h%x1f%s%x1f%an%x1f%ct', ...range])).map((l) => {
      const [sha, subject, author, ct] = l.split('\x1f');
      return { sha, subject, author, at: Number(ct) * 1000 };
    });
  }

  let patch = '';
  if (t.kind === 'ghost') {
    if (t.guess && hasHead(top)) {
      patch = tryGit(top, ['diff', '--no-color', '--no-ext-diff', `HEAD:${t.guess.path}`, t.sha]) || '';
      // blob-to-blob diffs name the files by id; show the guessed path instead
      const p = t.guess.path;
      patch = patch
        .replace(/^diff --git .*$/m, `diff --git a/${p} b/${p}`)
        .replace(/^--- .*$/m, `--- a/${p}`)
        .replace(/^\+\+\+ .*$/m, `+++ b/${p}`);
      if (!patch) patch = `(identical to HEAD:${t.guess.path})\n`;
    } else {
      const buf = catBatch(top, [t.sha]).get(t.sha);
      if (buf && !buf.includes(0)) {
        const body = buf.toString('utf8').replace(/\n$/, '').split('\n');
        patch = `diff --git a/(nameless) b/(nameless)\nnew file\n--- /dev/null\n+++ b/(nameless)\n@@ -0,0 +1,${body.length} @@\n` + body.map((l) => '+' + l).join('\n') + '\n';
      } else patch = 'Binary file, no preview.\n';
    }
  } else {
    for (const [from, to, label] of rangesOf(top, t)) {
      const p = tryGit(top, ['diff', '--no-color', '--no-ext-diff', '-M', from, to]) || '';
      if (label && p) patch += `# ${label} files\n`;
      patch += p;
      if (patch.length > MAX_PATCH) break;
    }
  }
  if (patch.length > MAX_PATCH) {
    patch = patch.slice(0, MAX_PATCH);
    patch = patch.slice(0, patch.lastIndexOf('\n') + 1);
    out.truncated = true;
  }
  out.patch = patch;
  return out;
}
