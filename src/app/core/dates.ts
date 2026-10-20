// Dates are stored as local YYYY-MM-DD strings, so comparisons are plain string
// comparisons and never shift across timezones.

const pad = (n: number) => String(n).padStart(2, '0');

export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => ymd(new Date());
export const thisMonth = () => today().slice(0, 7);

export function monthRange(ym: string): [string, string] {
  const [y, m] = ym.split('-').map(Number);
  return [`${ym}-01`, `${ym}-${pad(new Date(y, m, 0).getDate())}`];
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

const utc = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

export function addDays(date: string, n: number): string {
  const d = new Date(utc(date) + n * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const daysInclusive = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 86_400_000) + 1;

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

export function dateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** The period of equal length immediately before [from, to]; whole months map to the previous month. */
export function previousPeriod(from: string, to: string): [string, string] {
  const ym = from.slice(0, 7);
  const [mf, mt] = monthRange(ym);
  if (from === mf && to === mt) return monthRange(addMonths(ym, -1));
  const len = daysInclusive(from, to);
  return [addDays(from, -len), addDays(from, -1)];
}

export const isDate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(utc(s)) && addDays(s, 0) === s;
