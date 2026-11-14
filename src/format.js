import { ago, left } from './time.js';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
export const dim = paint(2);
export const bold = paint(1);
const HEALTH = { safe: paint(32), fresh: paint(32), weathered: paint(33), crumbling: paint(31), overdue: paint(35) };
const ICON = { commit: '[grave]', stash: '[stash]', ghost: '[ghost]', ward: '[ward] ' };

export function renderTomb(t, now = Date.now()) {
  const h = (HEALTH[t.health] ?? String)(t.health === "safe" ? "safe" : `${t.health}, ${left(t.deadline - now)}`);
  const head = `${ICON[t.kind]} ${bold(t.id.padEnd(10))} ${t.title}`;
  const bits = [];
  if (t.kind === 'commit' && t.commits > 1) bits.push(`${t.commits} commits`);
  if (t.files?.length) bits.push(`${t.files.length} file${t.files.length > 1 ? 's' : ''}`);
  if (t.kind === 'ghost') {
    bits.push(`${t.size} bytes`);
    bits.push(t.guess ? `séance: looks like ${t.guess.path} (${t.guess.score}%)` : 'nameless');
  }
  bits.push(`${t.kind === 'ward' ? 'saved' : 'died'} ${ago(t.died, now)}`);
  if (t.killer) bits.push(`killed by "${t.killer}"`);
  return `${head}\n    ${dim(bits.join(' | '))}  [${h}]`;
}
