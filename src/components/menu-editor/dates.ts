/** Service-date helpers (YYYY-MM-DD). Pure. */

const parse = (date: string) => new Date(`${date}T12:00:00`);
const fmt = (d: Date) => d.toLocaleDateString("en-CA");

/** Next/previous service day (the restaurant is closed on Sunday). */
export function shiftServiceDay(date: string, dir: 1 | -1): string {
  const d = parse(date);
  do d.setDate(d.getDate() + dir);
  while (d.getDay() === 0);
  return fmt(d);
}

export const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parse(s).getTime());

/** "Martes 29 de septiembre de 2026". */
export function longDate(date: string) {
  const s = new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(parse(date)).replace(",", "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
