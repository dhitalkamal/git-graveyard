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
    const args = ['commit-tree', tree, '-m', `ward: ${reason}`];
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

/** Claude Code PreToolUse hook: JSON on stdin. Never blocks the command; only snapshots first. */
export function handleHook(stdin) {
  let payload;
  try {
    payload = JSON.parse(stdin);
  } catch {
    return null;
  }
  const command = payload?.tool_input?.command;
  if (!isDestructive(command)) return null;
  try {
    return snapshot(payload.cwd || process.cwd(), command.slice(0, 120));
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
