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
