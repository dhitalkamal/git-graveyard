import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { git, tryGit, repoTop, hasHead } from './git.js';

const IDENT = {
  GIT_AUTHOR_NAME: 'Graveyard ward',
  GIT_AUTHOR_EMAIL: 'ward@graveyard.localhost',
  GIT_COMMITTER_NAME: 'Graveyard ward',
  GIT_COMMITTER_EMAIL: 'ward@graveyard.localhost',
};

// each pattern is matched against one simple command ("git reset --hard HEAD~3")
const DESTRUCTIVE = [
  /\bgit\b(?:\s+-\S+(?:\s+\S+)?)*\s+reset\b.*--(?:hard|merge|keep)\b/,
  /\bgit\b.*\sclean\b(?=.*\s-\S*[fx])/,
  /\bgit\b.*\scheckout\b.*(?:\s--\s|\s-f\b|\s--force\b|\s\.(?:\s|$))/,
  /\bgit\b.*\sswitch\b.*(?:\s-f\b|\s--force\b|\s--discard-changes\b)/,
  /\bgit\b.*\srestore\b/,
  /\bgit\b.*\sstash\s+(?:drop|clear)\b/,
  /\bgit\b.*\sbranch\b.*\s(?:-[a-zA-Z]*D[a-zA-Z]*|--delete\s+--force|--force\s+--delete|-d\s+--force)(?:\s|$)/,
  /\bgit\b.*\sworktree\s+remove\b.*(?:-f|--force)/,
  /\bgit\b.*\sreflog\s+(?:expire|delete)\b/,
  /\bgit\b.*\sgc\b.*--prune/,
  /\bgit\b.*\sfilter-(?:branch|repo)\b/,
];

export function isDestructive(command) {
  if (typeof command !== 'string') return false;
  return command
    .split(/&&|\|\||;|\||\n/)
    .map((c) => c.trim())
    .some((c) => {
      if (!DESTRUCTIVE.some((re) => re.test(c))) return false;
      // `git restore --staged` only touches the index, so it loses nothing
      const indexOnly = /\srestore\b/.test(c) && /\s(?:--staged|-S)\b/.test(c) && !/\s(?:--worktree|-W)\b/.test(c);
      return !indexOnly;
    });
}

/**
 * Save everything in the work tree (staged, unstaged and untracked, minus ignored files)
 * as a commit under refs/graveyard/ward/. Returns null when nothing differs from HEAD.
 * Uses a throwaway index, so the real index and work tree are never touched.
 */
export function snapshot(cwd, reason = 'manual snapshot') {
  const top = repoTop(cwd);
  const dir = mkdtempSync(join(tmpdir(), 'graveyard-'));
  const env = { GIT_INDEX_FILE: join(dir, 'index'), ...IDENT };
  try {
    const head = hasHead(top);
    if (head) git(top, ['read-tree', 'HEAD'], { env });
    git(top, ['add', '-A'], { env });
    const tree = git(top, ['write-tree'], { env }).trim();
    const headTree = head ? git(top, ['rev-parse', 'HEAD^{tree}']).trim() : null;
    if (tree === headTree) return null;
    const branch = (tryGit(top, ['symbolic-ref', '-q', '--short', 'HEAD']) || '').trim();
    const args = ['commit-tree', tree, '-m', `ward: ${reason}`];
    if (branch) args.push('-m', `on branch ${branch}`);
    if (head) args.push('-p', 'HEAD');
    const sha = git(top, args, { env }).trim();
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
    let ref = `refs/graveyard/ward/${stamp}`;
    for (let i = 2; tryGit(top, ['rev-parse', '--verify', '-q', ref]) !== null; i++) ref = `refs/graveyard/ward/${stamp}-${i}`;
    git(top, ['update-ref', ref, sha]);
    return { sha, ref };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The shell command inside a PreToolUse payload. Claude Code, Kiro IDE and Kiro CLI name it differently. */
export function commandOf(payload) {
  const inputs = [payload?.tool_input, payload?.toolInput, payload?.input, payload?.arguments, payload?.args];
  for (const i of inputs) {
    if (typeof i === 'string') return i;
    for (const k of ['command', 'cmd', 'script']) if (typeof i?.[k] === 'string') return i[k];
  }
  return null;
}

/** PreToolUse hook for Claude Code and Kiro: JSON on stdin. Never blocks the command; only snapshots first. */
export function handleHook(stdin) {
  let payload;
  try {
    payload = JSON.parse(stdin);
  } catch {
    return null;
  }
  const command = commandOf(payload);
  if (!isDestructive(command)) return null;
  try {
    return snapshot(payload.cwd || payload.workspace || process.cwd(), command.slice(0, 120));
  } catch {
    return null; // a ward must never break the agent
  }
}

/** Add the ward hook to <repo>/.claude/settings.json. Idempotent. */
export function installClaudeHook(cwd, hookCommand) {
  const top = repoTop(cwd);
  const file = join(top, '.claude', 'settings.json');
  const settings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  settings.hooks ??= {};
  settings.hooks.PreToolUse ??= [];
  const present = settings.hooks.PreToolUse.some((g) => g.hooks?.some((h) => h.command === hookCommand));
  if (!present) settings.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: hookCommand }] });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { file, added: !present };
}

/** Delete one ward snapshot. Only refs under refs/graveyard/ward/, and only if it still points at `sha`. */
export function deleteWard(cwd, ref, sha) {
  if (typeof ref !== 'string' || !/^refs\/graveyard\/ward\/[\w.-]+$/.test(ref)) throw new Error(`not a ward ref: ${ref}`);
  const top = repoTop(cwd);
  const args = ['update-ref', '-d', ref];
  if (sha) args.push(sha); // refuse if the ref moved since we looked
  git(top, args);
  return { ref };
}

/**
 * Add the ward to <repo>/.kiro/hooks/graveyard-ward.json (Kiro IDE 1.0+ and Kiro CLI V3).
 * Kiro blocks the tool when a PreToolUse command exits non-zero, and `ward hook` always exits 0.
 */
export function installKiroHook(cwd, hookCommand) {
  const top = repoTop(cwd);
  const file = join(top, '.kiro', 'hooks', 'graveyard-ward.json');
  const doc = {
    version: 'v1',
    hooks: [
      {
        name: 'Graveyard ward',
        description: 'Snapshot all work (even unstaged and untracked files) before a destructive git command. Never blocks the command.',
        trigger: 'PreToolUse',
        matcher: KIRO_SHELL_TOOLS,
        action: { type: 'command', command: hookCommand },
        timeout: 30,
      },
    ],
  };
  const existed = existsSync(file);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  return { file, added: !existed };
}

// Regex against the tool id: Kiro CLI calls its shell tool "shell", the IDE "executeBash".
export const KIRO_SHELL_TOOLS = ['shell', 'executeBash', 'execute_bash'].join('|');
