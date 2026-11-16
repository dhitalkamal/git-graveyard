import { DAY } from './time.js';

// A grave is "big" if it holds a lot of changed lines or touches many files.
export const BIG_LINES = 100;
export const BIG_FILES = 10;
// A grave is "dying" if git may prune it within this many days.
export const DYING_MS = 3 * DAY;

export const lineCount = (t) => (t.stat ? t.stat.added + t.stat.removed : 0);
export const isBig = (t) => lineCount(t) >= BIG_LINES || (t.stat?.files.length ?? 0) >= BIG_FILES;
export const isDying = (t, now = Date.now()) => t.deadline !== Infinity && t.deadline != null && t.deadline - now < DYING_MS;

export const SORTS = {
  newest: (a, b) => b.died - a.died,
  dying: (a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity) || b.died - a.died,
  biggest: (a, b) => lineCount(b) - lineCount(a) || b.died - a.died,
};

export function applyFilters(tombs, { big = false, dying = false, sort = 'newest', now = Date.now() } = {}) {
  const cmp = SORTS[sort];
  if (!cmp) throw new Error(`unknown sort "${sort}"; use ${Object.keys(SORTS).join(', ')}`);
  return tombs.filter((t) => (!big || isBig(t)) && (!dying || isDying(t, now))).sort(cmp);
}
