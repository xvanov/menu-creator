/** Pure date helpers on `YYYY-MM-DD` service dates (UTC math, no time zones involved). */
const DAY = 86_400_000;
const toUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));

export function addDays(date: string, n: number): string {
  return new Date(toUtc(date) + n * DAY).toISOString().slice(0, 10);
}

/** Whole days from `b` to `a` (positive when `a` is later). */
export function dayDiff(a: string, b: string): number {
  return Math.round((toUtc(a) - toUtc(b)) / DAY);
}

/** Monday..Saturday service week containing `date` (a Sunday belongs to the week before it). */
export function serviceWeek(date: string): { start: string; end: string } {
  const offset = (new Date(toUtc(date)).getUTCDay() + 6) % 7;
  const start = addDays(date, -offset);
  return { start, end: addDays(start, 5) };
}

const SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** "mié 23/09" */
export function shortDate(date: string): string {
  return `${SHORT[new Date(toUtc(date)).getUTCDay()]} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}
