#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/scan.js';
import { revive } from '../src/revive.js';
import { snapshot, isDestructive, handleHook, installClaudeHook, deleteWard } from '../src/ward.js';
import { renderTomb, bold, dim } from '../src/format.js';
import { startServer } from '../src/server.js';
import { installShim, uninstallShim, wardCheck, defaultShimDir } from '../src/shim.js';
import { repoTop } from '../src/git.js';
import { detailOf } from '../src/changes.js';

const HELP = `graveyard: raise the work git lost

  graveyard [scan] [--json] [--no-ghosts]   list lost commits, stashes, ghosts and ward snapshots
  graveyard ui [--port N]                   open the cemetery in your browser (127.0.0.1 only)
  graveyard show <id>                       print what a tombstone holds: commits and the full diff
  graveyard revive <id>                     bring one back on a new branch (touches nothing you have)
  graveyard ward snapshot [reason]          save all work now (staged, unstaged, untracked)
  graveyard ward run -- <command...>        snapshot first if the command is destructive, then run it
  graveyard ward hook                       Claude Code PreToolUse hook (reads JSON on stdin)
  graveyard ward install                    add the hook to .claude/settings.json in this repo
  graveyard ward list                       list ward snapshots
  graveyard ward delete <id>                delete one ward snapshot for good
  graveyard ward shim [--dir D]             install a git shim that guards every agent and shell
  graveyard ward unshim [--dir D]           remove the git shim
`;

const [cmd = 'scan', ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const args = rest.filter((a) => !a.startsWith('--'));

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

try {
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    process.stdout.write(HELP);
  } else if (cmd === 'scan' || cmd === '--json' || cmd === '--no-ghosts') {
    const f = new Set([...flags, ...(cmd.startsWith('--') ? [cmd] : [])]);
    const { top, tombstones } = scan(process.cwd(), { ghosts: !f.has('--no-ghosts') });
    if (f.has('--json')) {
      console.log(JSON.stringify(tombstones, (k, v) => (v === Infinity ? null : v), 2));
    } else if (!tombstones.length) {
      console.log(`${bold('The graveyard is empty.')} ${dim(top)}`);
    } else {
      console.log(`${bold('Graveyard')} ${dim(top)}\n`);
      for (const t of tombstones) console.log(renderTomb(t) + '\n');
      console.log(dim('Bring one back: graveyard revive <id>'));
    }
  } else if (cmd === 'ui') {
    const pi = rest.indexOf('--port');
    const port = pi >= 0 ? Number(rest[pi + 1]) : 4747;
    const { url } = await startServer(repoTop(process.cwd()), { port });
    console.log(`The cemetery is open at ${url}  (Ctrl+C to close)`);
    if (!flags.has('--no-open') && process.platform === 'darwin') spawnSync('open', [url]);
  } else if (cmd === 'show') {
    if (!args[0]) throw new Error('usage: graveyard show <id>');
    const { top, tombstones } = scan(process.cwd());
    const q = args[0].replace(/^[a-z]:/, '');
    const hits = tombstones.filter((t) => t.id === args[0] || t.sha.startsWith(q));
    if (hits.length !== 1) throw new Error(hits.length ? `"${args[0]}" matches ${hits.length} tombstones` : `no tombstone matches "${args[0]}"`);
    const t = hits[0];
    const d = detailOf(top, t);
    const out = [renderTomb(t), ''];
    for (const c of d.commits) out.push(`  ${c.sha}  ${c.subject}`);
    if (d.commits.length) out.push('');
    const tty = process.stdout.isTTY && !process.env.NO_COLOR;
    for (const l of d.patch.split('\n')) {
      if (!tty) out.push(l);
      else if (l.startsWith('+') && !l.startsWith('+++')) out.push(`\x1b[32m${l}\x1b[0m`);
      else if (l.startsWith('-') && !l.startsWith('---')) out.push(`\x1b[31m${l}\x1b[0m`);
      else if (l.startsWith('@@')) out.push(`\x1b[36m${l}\x1b[0m`);
      else if (l.startsWith('diff --git') || l.startsWith('# ')) out.push(bold(l));
      else out.push(l);
    }
    if (d.truncated) out.push(dim('(diff cut short; raise it and use git for the rest)'));
    console.log(out.join('\n'));
  } else if (cmd === 'revive') {
    if (!args[0]) throw new Error('usage: graveyard revive <id>');
    const r = revive(process.cwd(), args[0]);
    console.log(`Raised ${r.tomb.id} on branch ${bold(r.branch)}${r.file ? ` (file at ${r.file})` : ''}.`);
    console.log(dim(`Look: git switch ${r.branch}   Your current branch and files are unchanged.`));
  } else if (cmd === 'ward') {
    const [sub, ...wargs] = rest;
    if (sub === 'snapshot') {
      const r = snapshot(process.cwd(), wargs.join(' ') || 'manual snapshot');
      console.log(r ? `Saved ${r.ref} (${r.sha.slice(0, 7)})` : 'Nothing to save: work tree matches HEAD.');
    } else if (sub === 'hook') {
      handleHook(await readStdin());
    } else if (sub === 'run') {
      const command = wargs[0] === '--' ? wargs.slice(1) : wargs;
      if (!command.length) throw new Error('usage: graveyard ward run -- <command...>');
      if (isDestructive(command.join(' '))) {
        const r = snapshot(process.cwd(), command.join(' ').slice(0, 120));
        if (r) console.error(dim(`ward: saved ${r.ref}`));
      }
      process.exit(spawnSync(command[0], command.slice(1), { stdio: 'inherit' }).status ?? 1);
    } else if (sub === 'install') {
      const bin = realpathSync(fileURLToPath(import.meta.url));
      const r = installClaudeHook(process.cwd(), `node ${JSON.stringify(bin)} ward hook`);
      console.log(r.added ? `Ward installed in ${r.file}` : `Ward already installed in ${r.file}`);
    } else if (sub === 'check') {
      const r = wardCheck(wargs);
      if (r) console.error(`graveyard ward: saved ${r.ref} before "git ${wargs.join(' ')}"`);
    } else if (sub === 'shim' || sub === 'unshim') {
      const di = wargs.indexOf('--dir');
      const dir = di >= 0 ? wargs[di + 1] : defaultShimDir();
      if (sub === 'unshim') {
        const r = uninstallShim(dir);
        console.log(r.removed ? `Removed ${r.file}` : `No shim at ${r.file}`);
      } else {
        const r = installShim({ dir, bin: realpathSync(fileURLToPath(import.meta.url)) });
        console.log(`Shim written: ${r.file}\nReal git: ${r.realGit}`);
        if (!r.onPath) {
          console.log(`\nTurn it on by putting this first on PATH (add to ~/.zshrc for every shell):\n  export PATH="${r.dir}:$PATH"`);
          console.log(`Or only for one agent:  PATH="${r.dir}:$PATH" claude`);
        } else console.log('It is first on PATH and active.');
      }
    } else if (sub === 'delete') {
      const id = wargs[0];
      if (!id) throw new Error('usage: graveyard ward delete <id>');
      const { tombstones } = scan(process.cwd(), { ghosts: false });
      const t = tombstones.find((x) => x.kind === 'ward' && (x.id === id || x.id === `w:${id}`));
      if (!t) throw new Error(`no ward snapshot matches "${id}"`);
      deleteWard(process.cwd(), t.ref, t.sha);
      console.log(`Deleted ${t.ref} (${t.sha.slice(0, 7)})`);
      console.log(dim(`Changed your mind? Within git's prune window: git update-ref ${t.ref} ${t.sha}`));
    } else if (sub === 'list') {
      const { tombstones } = scan(process.cwd(), { ghosts: false });
      for (const t of tombstones.filter((x) => x.kind === 'ward')) console.log(renderTomb(t) + '\n');
    } else {
      process.stdout.write(HELP);
      process.exitCode = 1;
    }
  } else {
    process.stdout.write(HELP);
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`graveyard: ${e.message}`);
  process.exit(1);
}
