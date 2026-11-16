import { ago, left } from './time.js';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
export const dim = paint(2);
export const bold = paint(1);
const green = paint(32);
const red = paint(31);
const HEALTH = { safe: paint(32), fresh: paint(32), weathered: paint(33), crumbling: paint(31), overdue: paint(35) };
const ICON = { commit: '[grave]', stash: '[stash]', ghost: '[ghost]', ward: '[ward] ' };

export function renderTomb(t, now = Date.now()) {
  const h = (HEALTH[t.health] ?? String)(t.health === 'safe' ? 'safe' : `${t.health}, ${left(t.deadline - now)}`);
  const head = `${ICON[t.kind]} ${bold(t.id.padEnd(10))} ${t.headline || t.title}  [${h}]`;
  const bits = [t.summary];
  bits.push(`${t.kind === 'ward' ? 'saved' : 'died'} ${ago(t.died, now)}`);
  if (t.killer) bits.push(`killed by "${t.killer}"`);
  if (t.kind === 'ghost' && !t.guess) bits.push(`starts with "${t.title}"`);
  const out = [head, `    ${dim(bits.filter(Boolean).join(' | '))}`];
  const files = t.stat?.files ?? [];
  for (const f of files.slice(0, 4)) {
    out.push(`      ${f.binary ? dim('bin') : `${green('+' + f.added)} ${red('-' + f.removed)}`}  ${f.path}${f.note ? dim(` (${f.note})`) : ''}`);
  }
  if (files.length > 4) out.push(dim(`      + ${files.length - 4} more files`));
  return out.join('\n');
}
