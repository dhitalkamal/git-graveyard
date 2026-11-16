import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { git, tryGit, lines, repoTop, hasHead, catBatch, existing } from './git.js';
import { DAY, parseDuration } from './time.js';

const STASH_RE = /^(WIP on|On) .*?: |^index on .*?: |^untracked files on .*?: /;

export function expiryConfig(top) {
  const get = (k) => (tryGit(top, ['config', '--get', k]) || '').trim();
  return {
    reflogMs: parseDuration(get('gc.reflogExpireUnreachable'), 30 * DAY),
    pruneMs: parseDuration(get('gc.pruneExpire'), 14 * DAY),
  };
}

function healthOf(deadline, span, now) {
  if (deadline === Infinity) return 'safe';
  const rem = deadline - now;
  if (rem <= 0) return 'overdue';
  const f = span > 0 ? rem / span : 0;
  return f > 0.5 ? 'fresh' : f > 0.2 ? 'weathered' : 'crumbling';
}

/** Commits no branch, tag or HEAD can reach, with the reflog entry that killed them when known. */
function findLostCommits(top, reachable) {
  const lost = new Map(); // sha -> { killer, killedAt }

  const raw = tryGit(top, ['log', '-g', '--all', '--format=%H%x09%gd%x09%ct%x09%gs']) || '';
  const byRef = new Map();
  for (const l of lines(raw)) {
    const [sha, gd, ct, ...subj] = l.split('\t');
    const m = gd.match(/^(.*)@\{(\d+)\}$/);
    if (!m) continue;
    if (!byRef.has(m[1])) byRef.set(m[1], []);
    byRef.get(m[1]).push({ sha, idx: Number(m[2]), at: Number(ct) * 1000, subject: subj.join('\t') });
  }
  for (const entries of byRef.values()) {
    entries.sort((a, b) => a.idx - b.idx);
    entries.forEach((e, i) => {
      if (reachable.has(e.sha) || lost.has(e.sha)) return;
      const killer = i > 0 ? entries[i - 1] : null; // the newer entry moved the ref away
      lost.set(e.sha, { killer: killer?.subject ?? null, killedAt: killer?.at ?? null, inReflog: true });
    });
  }

  const fsck = tryGit(top, ['fsck', '--unreachable', '--no-reflogs', '--no-progress']) || '';
  const blobs = [];
  for (const l of lines(fsck)) {
    const [, type, sha] = l.split(' ');
    if (type === 'commit' && !reachable.has(sha) && !lost.has(sha)) {
      lost.set(sha, { killer: null, killedAt: null, inReflog: false });
    } else if (type === 'blob') blobs.push(sha);
  }
  return { lost, blobs };
}

function describeCommits(top, shas) {
  const info = new Map();
  if (!shas.length) return info;
  const out = git(top, ['log', '--no-walk=unsorted', '--stdin', '--format=%H%x1f%P%x1f%ct%x1f%an%x1f%s'], {
    input: shas.join('\n') + '\n',
  });
  for (const l of lines(out)) {
    const [sha, parents, ct, author, subject] = l.split('\x1f');
    info.set(sha, { sha, parents: parents ? parents.split(' ') : [], at: Number(ct) * 1000, author, subject });
  }
  return info;
}

function commitTombstones(top, lost, cfg, now) {
  const alive = existing(top, [...lost.keys()]);
  const info = describeCommits(top, alive);
  const lostSet = new Set(info.keys());

  const isParent = new Set();
  for (const c of info.values()) for (const p of c.parents) if (lostSet.has(p)) isParent.add(p);
  const tips = [...info.values()].filter((c) => !isParent.has(c.sha));

  return tips.map((tip) => {
    // count the lost chain behind this tip and find where it forked from live history
    const seen = new Set();
    const stack = [tip.sha];
    while (stack.length) {
      const s = stack.pop();
      if (seen.has(s)) continue;
      seen.add(s);
      for (const p of info.get(s).parents) if (lostSet.has(p)) stack.push(p);
    }
    let base = null;
    for (let c = tip; c; ) {
      const p = c.parents[0];
      if (!p) break;
      if (!lostSet.has(p)) {
        base = p;
        break;
      }
      c = info.get(p);
    }
    const files = lines(
      tryGit(top, base ? ['diff', '--name-only', base, tip.sha] : ['show', '--name-only', '--format=', tip.sha]),
    );
    const meta = lost.get(tip.sha);
    // `branch -D` leaves no reflog line. The HEAD line after the last commit says "checkout: moving from X",
    // so when X no longer exists, X was deleted.
    const moved = meta.killer?.match(/^checkout: moving from (\S+) to /);
    if (moved && tryGit(top, ['rev-parse', '--verify', '-q', `refs/heads/${moved[1]}`]) === null) {
      meta.killer = `branch ${moved[1]} deleted`;
    }
    const isStash = STASH_RE.test(tip.subject) && tip.parents.length >= 2;
    const died = meta.killedAt ?? tip.at;
    const span = meta.inReflog ? cfg.reflogMs : cfg.pruneMs;
    const deadline = died + span;
    return {
      id: `${isStash ? 's' : 'c'}:${tip.sha.slice(0, 7)}`,
      kind: isStash ? 'stash' : 'commit',
      sha: tip.sha,
      title: tip.subject,
      author: tip.author,
      commits: isStash ? 1 : seen.size,
      files,
      died,
      killer: meta.killer ?? (isStash ? 'stash dropped or cleared' : null),
      deadline,
      health: healthOf(deadline, span, now),
    };
  });
}

const lineSet = (buf) =>
  new Set(
    buf
      .toString('utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 2),
  );

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Blobs nothing points at. The séance guesses a name by comparing them to files in HEAD. */
function ghostTombstones(top, blobs, tombs, cfg, now) {
  if (!blobs.length) return [];
  // drop blobs that belong to a lost commit; those are already inside a tombstone
  const tips = tombs.filter((t) => t.kind !== 'ward').map((t) => t.sha);
  const inTombs = new Set();
  if (tips.length) {
    for (const l of lines(tryGit(top, ['rev-list', '--objects', ...tips, '--not', '--all']))) inTombs.add(l.split(' ')[0]);
  }
  const free = blobs.filter((b) => !inTombs.has(b));
  if (!free.length) return [];

  const sizes = new Map();
  for (const l of lines(git(top, ['cat-file', '--batch-check=%(objectname) %(objectsize)'], { input: free.join('\n') + '\n' }))) {
    const [sha, size] = l.split(' ');
    sizes.set(sha, Number(size));
  }

  const objDir = resolve(top, tryGit(top, ['rev-parse', '--git-path', 'objects']).trim());
  const withTime = free
    .filter((s) => sizes.get(s) > 0)
    .map((sha) => {
      let mtime = null;
      try {
        mtime = statSync(join(objDir, sha.slice(0, 2), sha.slice(2))).mtimeMs;
      } catch {} // packed objects have no file of their own
      return { sha, size: sizes.get(sha), mtime };
    })
    .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
    .slice(0, 200);

  // séance material: text files in HEAD
  const tracked = [];
  if (hasHead(top)) {
    for (const l of lines(git(top, ['ls-tree', '-r', '-l', 'HEAD']))) {
      const m = l.match(/^\d+ blob (\w+)\s+(\d+)\t(.*)$/);
      if (m && Number(m[2]) > 0 && Number(m[2]) <= 512 * 1024) tracked.push({ sha: m[1], path: m[3] });
    }
  }
  const small = withTime.filter((g) => g.size <= 512 * 1024);
  const content = catBatch(top, [...new Set([...tracked.map((t) => t.sha), ...small.map((g) => g.sha)])]);
  const trackedSets = tracked.map((t) => ({ path: t.path, set: lineSet(content.get(t.sha) ?? Buffer.alloc(0)) }));

  return withTime.map((g) => {
    const buf = content.get(g.sha);
    const binary = buf ? buf.includes(0) : false;
    let guess = null;
    if (buf && !binary) {
      const gs = lineSet(buf);
      let best = { score: 0, path: null };
      for (const t of trackedSets) {
        const score = jaccard(gs, t.set);
        if (score > best.score) best = { score, path: t.path };
      }
      if (best.score >= 0.4) guess = { path: best.path, score: Math.round(best.score * 100) };
    }
    const first = buf && !binary ? (buf.toString('utf8').split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 80) : '(binary)';
    const died = g.mtime ?? now;
    const deadline = died + cfg.pruneMs;
    return {
      id: `g:${g.sha.slice(0, 7)}`,
      kind: 'ghost',
      sha: g.sha,
      title: first || '(blank)',
      size: g.size,
      guess,
      died,
      killer: null,
      deadline,
      health: healthOf(deadline, cfg.pruneMs, now),
    };
  });
}

function wardTombstones(top) {
  const out = tryGit(top, ['for-each-ref', 'refs/graveyard/ward', '--format=%(objectname)%09%(refname)%09%(creatordate:unix)%09%(contents:subject)']);
  return lines(out).map((l) => {
    const [sha, ref, ct, subject] = l.split('\t');
    return {
      id: `w:${ref.split('/').pop()}`,
      kind: 'ward',
      sha,
      ref,
      title: subject,
      died: Number(ct) * 1000,
      killer: null,
      deadline: Infinity,
      health: 'safe',
    };
  });
}

export function scan(cwd, { now = Date.now(), ghosts = true } = {}) {
  const top = repoTop(cwd);
  const cfg = expiryConfig(top);
  const reachable = new Set(lines(tryGit(top, ['rev-list', '--exclude=refs/graveyard/*', '--all'])));
  const { lost, blobs } = findLostCommits(top, reachable);
  const commits = commitTombstones(top, lost, cfg, now);
  const wards = wardTombstones(top);
  const ghostList = ghosts ? ghostTombstones(top, blobs, commits, cfg, now) : [];
  const all = [...commits, ...ghostList, ...wards].sort((a, b) => b.died - a.died);
  return { top, cfg, tombstones: all };
}
