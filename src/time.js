export const DAY = 86_400_000;
const UNIT = { second: 1e3, minute: 6e4, hour: 36e5, day: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY };

/** Parse git's expiry values such as "90 days", "2.weeks.ago", "never", "now". */
export function parseDuration(value, fallbackMs) {
  if (value == null || value === '') return fallbackMs;
  const s = String(value).trim().toLowerCase().replace(/[._]/g, ' ').replace(/ ago$/, '');
  if (s === 'never') return Infinity;
  if (s === 'now' || s === 'all') return 0;
  const m = s.match(/^(\d+)\s*(second|minute|hour|day|week|month|year)s?$/);
  return m ? Number(m[1]) * UNIT[m[2]] : fallbackMs;
}

export function ago(ms, now = Date.now()) {
  const d = Math.max(0, now - ms);
  if (d < 6e4) return 'just now';
  if (d < 36e5) return `${Math.floor(d / 6e4)}m ago`;
  if (d < DAY) return `${Math.floor(d / 36e5)}h ago`;
  return `${Math.floor(d / DAY)}d ago`;
}

export function left(ms) {
  if (ms === Infinity) return 'safe';
  if (ms <= 0) return 'overdue';
  if (ms < DAY) return `${Math.max(1, Math.floor(ms / 36e5))}h left`;
  return `${Math.floor(ms / DAY)}d left`;
}
