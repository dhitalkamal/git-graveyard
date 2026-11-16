import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { scan } from '../src/scan.js';
import { revive } from '../src/revive.js';
import { snapshot, isDestructive, handleHook } from '../src/ward.js';
import { parseDuration, DAY } from '../src/time.js';

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'gy-test-'));
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  return dir;
}
function commit(dir, file, text, msg) {
  writeFileSync(join(dir, file), text);
  sh(dir, 'add', file);
  sh(dir, 'commit', '-qm', msg);
}
const BIG = Array.from({ length: 30 }, (_, i) => `line number ${i} of the file`).join('\n') + '\n';

test('reset --hard: lost commits come back as one tombstone with the killer', () => {
  const d = repo();
  commit(d, 'a.txt', '1\n', 'base');
  commit(d, 'a.txt', '2\n', 'work two');
  commit(d, 'a.txt', '3\n', 'work three');
  const lostTip = sh(d, 'rev-parse', 'HEAD');
  sh(d, 'reset', '-q', '--hard', 'HEAD~2');

  const { tombstones } = scan(d);
  const t = tombstones.find((x) => x.sha === lostTip);
  assert.ok(t, 'tip is a tombstone');
  assert.equal(t.kind, 'commit');
  assert.equal(t.title, 'work three');
  assert.equal(t.commits, 2);
  assert.match(t.killer, /reset: moving to HEAD~2/);
  assert.deepEqual(t.files, ['a.txt']);
  assert.equal(t.health, 'fresh');

  const headBefore = sh(d, 'rev-parse', 'HEAD');
  const r = revive(d, t.id);
  assert.equal(sh(d, 'rev-parse', r.branch), lostTip);
  assert.equal(sh(d, 'rev-parse', 'HEAD'), headBefore, 'HEAD did not move');
  assert.equal(readFileSync(join(d, 'a.txt'), 'utf8'), '1\n', 'work tree untouched');
  rmSync(d, { recursive: true, force: true });
});

test('dropped stash is found as a stash', () => {
  const d = repo();
  commit(d, 'a.txt', '1\n', 'base');
  writeFileSync(join(d, 'a.txt'), 'dirty\n');
  sh(d, 'stash');
  sh(d, 'stash', 'drop');
  const { tombstones } = scan(d);
  const s = tombstones.find((x) => x.kind === 'stash');
  assert.ok(s);
  assert.deepEqual(s.files, ['a.txt']);
  const r = revive(d, s.id);
  assert.equal(sh(d, 'show', `${r.branch}:a.txt`), 'dirty');
  rmSync(d, { recursive: true, force: true });
});

test('deleted branch is found', () => {
  const d = repo();
  commit(d, 'a.txt', '1\n', 'base');
  sh(d, 'switch', '-qc', 'feature');
  commit(d, 'b.txt', 'b\n', 'feature work');
  sh(d, 'switch', '-q', 'main');
  sh(d, 'branch', '-D', 'feature');
  const { tombstones } = scan(d);
  assert.ok(tombstones.some((t) => t.title === 'feature work'));
  rmSync(d, { recursive: true, force: true });
});

test('staged-then-discarded file becomes a ghost; séance guesses its name; revive does not overwrite', () => {
  const d = repo();
  commit(d, 'notes.md', BIG, 'base');
  writeFileSync(join(d, 'notes.md'), BIG + 'a precious new line that was only staged\n');
  sh(d, 'add', 'notes.md');
  sh(d, 'checkout', 'HEAD', '--', 'notes.md'); // index and work tree reset; blob is now unreferenced

  const { tombstones } = scan(d);
  const g = tombstones.find((t) => t.kind === 'ghost');
  assert.ok(g, 'ghost found');
  assert.equal(g.guess?.path, 'notes.md');

  const r = revive(d, g.id);
  assert.equal(readFileSync(join(d, 'notes.md'), 'utf8'), BIG, 'current file unchanged');
  const rec = sh(d, 'show', `${r.branch}:${r.file}`);
  assert.match(rec, /precious new line/);
  rmSync(d, { recursive: true, force: true });
});

test('ward snapshot saves unstaged and untracked work, and leaves the repo alone', () => {
  const d = repo();
  commit(d, 'a.txt', '1\n', 'base');
  writeFileSync(join(d, 'a.txt'), 'edited, never staged\n');
  writeFileSync(join(d, 'new.txt'), 'untracked\n');
  const before = sh(d, 'status', '--porcelain');

  const snap = snapshot(d, 'git reset --hard');
  assert.ok(snap);
  assert.equal(sh(d, 'status', '--porcelain'), before, 'status identical');
  assert.equal(sh(d, 'show', `${snap.ref}:a.txt`), 'edited, never staged');
  assert.equal(sh(d, 'show', `${snap.ref}:new.txt`), 'untracked');

  sh(d, 'reset', '-q', '--hard');
  sh(d, 'clean', '-fdq');
  assert.equal(existsSync(join(d, 'new.txt')), false, 'work really is gone from disk');

  const w = scan(d).tombstones.find((t) => t.kind === 'ward');
  assert.ok(w);
  const r = revive(d, w.id);
  assert.equal(sh(d, 'show', `${r.branch}:new.txt`), 'untracked');
  rmSync(d, { recursive: true, force: true });
});

test('ward snapshot returns null when nothing changed', () => {
  const d = repo();
  commit(d, 'a.txt', '1\n', 'base');
  assert.equal(snapshot(d), null);
  rmSync(d, { recursive: true, force: true });
});

test('isDestructive', () => {
  for (const c of [
    'git reset --hard HEAD~3',
    'git clean -fd',
    'git checkout -- .',
    'git checkout .',
    'git restore src/',
    'git stash drop',
    'git stash clear',
    'git branch -D old',
    'cd x && git reset --hard',
    'git -C repo reset --hard',
  ]) assert.equal(isDestructive(c), true, c);
  for (const c of [
    'git status',
    'git reset --soft HEAD~1',
    'git reset HEAD file',
    'git restore --staged file',
    'git branch -d merged',
    'git checkout main',
    'git commit -m "reset --hard"',
    'ls',
  ]) assert.equal(isDestructive(c), false, c);
});

test('hook snapshots on destructive Bash command and ignores the rest', () => {
  const d = repo();
  commit(d, 'a.txt', '1\n', 'base');
  writeFileSync(join(d, 'a.txt'), 'wip\n');
  assert.equal(handleHook(JSON.stringify({ cwd: d, tool_input: { command: 'git status' } })), null);
  assert.equal(handleHook('not json'), null);
  const r = handleHook(JSON.stringify({ cwd: d, tool_input: { command: 'git reset --hard' } }));
  assert.ok(r?.ref);
  assert.equal(sh(d, 'show', `${r.ref}:a.txt`), 'wip');
  rmSync(d, { recursive: true, force: true });
});

test('parseDuration reads git expiry values', () => {
  assert.equal(parseDuration('2.weeks.ago'), 14 * DAY);
  assert.equal(parseDuration('90 days'), 90 * DAY);
  assert.equal(parseDuration('never'), Infinity);
  assert.equal(parseDuration('now'), 0);
  assert.equal(parseDuration(undefined, 5), 5);
});

test('deleted branch names the branch as the killer', () => {
  const d = repo();
  commit(d, 'a.txt', '1\n', 'base');
  sh(d, 'switch', '-qc', 'feature');
  commit(d, 'b.txt', 'b\n', 'feature work');
  sh(d, 'switch', '-q', 'main');
  sh(d, 'branch', '-D', 'feature');
  const t = scan(d).tombstones.find((x) => x.title === 'feature work');
  assert.equal(t.killer, 'branch feature deleted');
  rmSync(d, { recursive: true, force: true });
});

test('ui server: serves page, lists tombs, revive needs token, rejects bad host', async () => {
  const { startServer } = await import('../src/server.js');
  const d = repo();
  commit(d, 'a.txt', '1\n', 'base');
  commit(d, 'a.txt', '2\n', 'lost one');
  sh(d, 'reset', '-q', '--hard', 'HEAD~1');
  const { server, url, token } = await startServer(d, { port: 0 });
  try {
    const page = await (await fetch(url)).text();
    assert.ok(page.includes(token));
    assert.match(page, /<script type="importmap">/);
    assert.match(page, /<script type="module">/);

    const tombs = await (await fetch(url + 'api/tombs')).json();
    const t = tombs.tombstones.find((x) => x.title === 'lost one');
    assert.ok(t);

    const post = (headers) => fetch(url + 'api/revive', { method: 'POST', headers, body: JSON.stringify({ id: t.id }) });
    assert.equal((await post({})).status, 403);
    const ok = await post({ 'x-graveyard-token': token });
    assert.equal(ok.status, 200);
    assert.match((await ok.json()).branch, /^graveyard\//);

    const bad = await new Promise((resolve) => {
      import('node:http').then(({ request }) => {
        const u = new URL(url);
        request({ host: '127.0.0.1', port: u.port, path: '/api/tombs', headers: { host: 'evil.example' } }, (r) => resolve(r.statusCode)).end();
      });
    });
    assert.equal(bad, 403);
  } finally {
    server.close();
    rmSync(d, { recursive: true, force: true });
  }
});

test('git shim snapshots before destructive commands and passes everything through', async () => {
  const { installShim } = await import('../src/shim.js');
  const d = repo();
  commit(d, 'a.txt', '1\n', 'base');
  const shimDir = mkdtempSync(join(tmpdir(), 'gy-shim-'));
  const bin = new URL('../bin/graveyard.js', import.meta.url).pathname;
  const r = installShim({ dir: shimDir, bin });
  assert.ok(r.realGit && !r.realGit.startsWith(shimDir));
  const env = { ...process.env, PATH: `${shimDir}:${process.env.PATH}` };
  const g = (...a) => execFileSync('git', a, { cwd: d, env, encoding: 'utf8' });

  assert.match(g('status', '--short'), /^$/);
  writeFileSync(join(d, 'a.txt'), 'unsaved\n');
  writeFileSync(join(d, 'n.txt'), 'untracked\n');
  g('diff', '--stat'); // safe: no snapshot
  assert.equal(sh(d, 'for-each-ref', 'refs/graveyard'), '');
  g('reset', '-q', '--hard');
  g('clean', '-fdq');
  const refs = sh(d, 'for-each-ref', '--format=%(refname)', 'refs/graveyard').split('\n').filter(Boolean);
  assert.equal(refs.length, 2, 'reset and clean each saved a snapshot');
  assert.equal(sh(d, 'show', `${refs[0]}:a.txt`), 'unsaved');
  assert.equal(sh(d, 'show', `${refs[0]}:n.txt`), 'untracked');
  assert.equal(existsSync(join(d, 'n.txt')), false);

  // -C works from another directory
  writeFileSync(join(d, 'a.txt'), 'again\n');
  execFileSync('git', ['-C', d, 'checkout', '--', '.'], { cwd: tmpdir(), env });
  assert.equal(sh(d, 'for-each-ref', '--format=%(refname)', 'refs/graveyard').split('\n').length, 3);
  rmSync(d, { recursive: true, force: true });
  rmSync(shimDir, { recursive: true, force: true });
});

test('vendor route serves three.js and blocks traversal', async () => {
  const { startServer } = await import('../src/server.js');
  const d = repo();
  const { server, url } = await startServer(d, { port: 0 });
  try {
    assert.equal((await fetch(url + 'vendor/three/build/three.module.js')).status, 200);
    assert.equal((await fetch(url + 'vendor/three/examples/jsm/controls/OrbitControls.js')).status, 200);
    assert.equal((await fetch(url + 'vendor/three/package.json')).status, 404);
    assert.equal((await fetch(url + 'vendor/three/%2e%2e/%2e%2e/package.json')).status, 404);
  } finally {
    server.close();
    rmSync(d, { recursive: true, force: true });
  }
});

test('tombstones carry headline, origin, stats and a diff', async () => {
  const { detailOf } = await import('../src/changes.js');
  const d = repo();
  commit(d, 'a.txt', '1\n', 'base');
  sh(d, 'switch', '-qc', 'feature');
  commit(d, 'b.txt', 'one\ntwo\n', 'add b');
  commit(d, 'a.txt', '1\nmore\n', 'grow a');
  sh(d, 'switch', '-q', 'main');
  sh(d, 'branch', '-D', 'feature');
  writeFileSync(join(d, 'a.txt'), 'dirty\n');
  sh(d, 'stash', 'push', '-q', '-m', 'my experiment');
  sh(d, 'stash', 'drop', '-q');
  writeFileSync(join(d, 'u.txt'), 'untracked\n');
  const snap = snapshot(d, 'git clean -fd');

  const { top, tombstones } = scan(d);
  const c = tombstones.find((t) => t.kind === 'commit');
  assert.equal(c.origin, 'feature');
  assert.deepEqual(c.stat, {
    added: 3, removed: 0,
    files: [{ path: 'a.txt', added: 1, removed: 0, binary: false }, { path: 'b.txt', added: 2, removed: 0, binary: false }],
  });
  assert.match(c.summary, /2 commits, on feature, 2 files, \+3 -0/);
  const cd = detailOf(top, c);
  assert.deepEqual(cd.commits.map((x) => x.subject), ['grow a', 'add b']);
  assert.match(cd.patch, /\+more/);

  const s = tombstones.find((t) => t.kind === 'stash');
  assert.equal(s.headline, 'my experiment');
  assert.equal(s.origin, 'main');
  assert.match(detailOf(top, s).patch, /-1\n\+dirty/);

  const w = tombstones.find((t) => t.kind === 'ward');
  assert.equal(w.headline, 'Snapshot before git clean -fd');
  assert.equal(w.origin, 'main');
  assert.deepEqual(w.files, ['u.txt']);
  assert.match(detailOf(top, w).patch, /\+untracked/);
  assert.ok(snap);
  rmSync(d, { recursive: true, force: true });
});

test('ghost detail diffs against the guessed file', async () => {
  const { detailOf } = await import('../src/changes.js');
  const d = repo();
  commit(d, 'notes.md', BIG, 'base');
  writeFileSync(join(d, 'notes.md'), BIG + 'only staged once\n');
  sh(d, 'add', 'notes.md');
  sh(d, 'checkout', 'HEAD', '--', 'notes.md');
  const { top, tombstones } = scan(d);
  const g = tombstones.find((t) => t.kind === 'ghost');
  assert.equal(g.headline, 'Lost version of notes.md');
  assert.equal(g.stat.added, 1);
  const p = detailOf(top, g).patch;
  assert.match(p, /^diff --git a\/notes.md b\/notes.md/m);
  assert.match(p, /\+only staged once/);
  rmSync(d, { recursive: true, force: true });
});

test('detail endpoint answers for known ids only', async () => {
  const { startServer } = await import('../src/server.js');
  const d = repo();
  commit(d, 'a.txt', '1\n', 'base');
  commit(d, 'a.txt', '2\n', 'lost');
  sh(d, 'reset', '-q', '--hard', 'HEAD~1');
  const { server, url } = await startServer(d, { port: 0 });
  try {
    assert.equal((await fetch(url + 'api/detail?id=c:0000000')).status, 404);
    const { tombstones } = await (await fetch(url + 'api/tombs')).json();
    const r = await fetch(url + 'api/detail?id=' + encodeURIComponent(tombstones[0].id));
    assert.equal(r.status, 200);
    assert.match((await r.json()).patch, /\+2/);
  } finally {
    server.close();
    rmSync(d, { recursive: true, force: true });
  }
});

test('delete ward: API needs token, only deletes wards, CLI and scan agree', async () => {
  const { startServer } = await import('../src/server.js');
  const { deleteWard } = await import('../src/ward.js');
  const d = repo();
  commit(d, 'a.txt', '1\n', 'base');
  commit(d, 'a.txt', '2\n', 'lost');
  sh(d, 'reset', '-q', '--hard', 'HEAD~1');
  writeFileSync(join(d, 'a.txt'), 'wip\n');
  const snap = snapshot(d, 'git reset --hard');
  assert.throws(() => deleteWard(d, 'refs/heads/main'), /not a ward ref/);

  const { server, url, token } = await startServer(d, { port: 0 });
  try {
    const { tombstones } = await (await fetch(url + 'api/tombs')).json();
    const w = tombstones.find((t) => t.kind === 'ward');
    const c = tombstones.find((t) => t.kind === 'commit');
    const post = (id, headers = { 'x-graveyard-token': token }) => fetch(url + 'api/ward/delete', { method: 'POST', headers, body: JSON.stringify({ id }) });
    assert.equal((await post(w.id, {})).status, 403);
    assert.equal((await post(c.id)).status, 400, 'a lost commit cannot be deleted');
    assert.equal((await post(w.id)).status, 200);
    assert.equal(sh(d, 'for-each-ref', 'refs/graveyard'), '');
    const after = scan(d).tombstones;
    assert.ok(!after.some((t) => t.kind === 'ward'));
    const ghost = after.find((t) => t.sha === snap.sha);
    assert.match(ghost.headline, /^Deleted ward: snapshot before git reset --hard/);
  } finally {
    server.close();
    rmSync(d, { recursive: true, force: true });
  }
});

test('death time is when the reflog moved, not the commit date; filters pick big and dying', async () => {
  const { applyFilters } = await import('../src/filter.js');
  const d = repo();
  commit(d, 'a.txt', '1\n', 'base');
  const old = `${Math.floor(Date.now() / 1000) - 29 * 86400} +0000`;
  writeFileSync(join(d, 'x.txt'), 'x\n');
  sh(d, 'add', 'x.txt');
  execFileSync('git', ['commit', '-qm', 'old one'], { cwd: d, env: { ...process.env, GIT_COMMITTER_DATE: old, GIT_AUTHOR_DATE: old } });
  execFileSync('git', ['reset', '-q', '--hard', 'HEAD~1'], { cwd: d, env: { ...process.env, GIT_COMMITTER_DATE: old } });
  writeFileSync(join(d, 'big.txt'), Array.from({ length: 150 }, (_, i) => `l${i}`).join('\n') + '\n');
  sh(d, 'add', 'big.txt');
  sh(d, 'commit', '-qm', 'big one');
  sh(d, 'reset', '-q', '--hard', 'HEAD~1');

  const { tombstones } = scan(d);
  const oldT = tombstones.find((t) => t.title === 'old one');
  const bigT = tombstones.find((t) => t.title === 'big one');
  assert.ok(Date.now() - oldT.died > 28 * 86400e3, 'old reset dated 29 days ago');
  assert.ok(Date.now() - bigT.died < 60e3, 'new reset dated now');
  assert.deepEqual(applyFilters(tombstones, { dying: true }).map((t) => t.title), ['old one']);
  assert.deepEqual(applyFilters(tombstones, { big: true }).map((t) => t.title), ['big one']);
  assert.equal(applyFilters(tombstones, { sort: 'dying' })[0].title, 'old one');
  assert.equal(applyFilters(tombstones, { sort: 'biggest' })[0].title, 'big one');
  rmSync(d, { recursive: true, force: true });
});

test('ward hook reads Claude Code and Kiro payloads, always exits 0, and installs for Kiro', async () => {
  const { commandOf, installKiroHook } = await import('../src/ward.js');
  assert.equal(commandOf({ tool_input: { command: 'git reset --hard' } }), 'git reset --hard');
  assert.equal(commandOf({ toolInput: { command: 'git clean -fd' } }), 'git clean -fd');
  assert.equal(commandOf({ input: { cmd: 'git stash drop' } }), 'git stash drop');
  assert.equal(commandOf({ arguments: 'git checkout .' }), 'git checkout .');
  assert.equal(commandOf({}), null);

  const d = repo();
  commit(d, 'a.txt', '1\n', 'base');
  writeFileSync(join(d, 'a.txt'), 'wip\n');
  const bin = new URL('../bin/graveyard.js', import.meta.url).pathname;
  const run = (input, cwd = d) => execFileSync(process.execPath, [bin, 'ward', 'hook'], { cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  run(JSON.stringify({ toolInput: { command: 'git reset --hard' } })); // throws if exit code is not 0
  assert.equal(sh(d, 'for-each-ref', '--count=1', '--format=%(refname)', 'refs/graveyard').startsWith('refs/graveyard/ward/'), true);
  run('not json at all');
  run(JSON.stringify({ toolInput: { command: 'git reset --hard' } }), tmpdir()); // not a repo: still exit 0

  const r = installKiroHook(d, 'node x ward hook');
  const doc = JSON.parse(readFileSync(r.file, 'utf8'));
  assert.equal(doc.version, 'v1');
  assert.equal(doc.hooks[0].trigger, 'PreToolUse');
  assert.equal(doc.hooks[0].action.command, 'node x ward hook');
  assert.ok(new RegExp(doc.hooks[0].matcher).test('shell'));
  rmSync(d, { recursive: true, force: true });
});
