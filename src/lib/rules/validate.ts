/**
 * Pure rule validator. Evaluates the rows of the `rules` table against a candidate menu.
 *
 * Items match a filter through their dish (category, tags, name) and the course they are served
 * in on this menu. Extras are outside the menú del día: a filter only matches an extra when it
 * asks for `course: "extra"` explicitly, and `no_repeat` ignores extras (they repeat by design).
 */
import { weekdayOf, type Course, type DishFilter, type RuleParams } from "@/lib/types";
import { dayDiff, serviceWeek, shortDate } from "./dates";
import { normalizeName } from "./text";

export type ItemKey = number | string;

export interface RuleItem {
  id: ItemKey;
  course: Course;
  name: string;
  dishId: number | null;
  dishName?: string | null;
  category: string | null;
  tags: string[];
}

export interface RuleDef {
  id: number;
  name: string;
  params: RuleParams;
  hard: boolean;
  enabled: boolean;
}

/** Another day's saved menu (for weekly counts and repeats). */
export interface DayMenu {
  date: string;
  items: RuleItem[];
}

/** min = too few (can still be fixed by adding), the rest = something on the menu breaks the rule. */
export type ViolationKind = "min" | "max" | "pair" | "repeat" | "week";

export interface Violation {
  ruleId: number;
  ruleName: string;
  hard: boolean;
  kind: ViolationKind;
  message: string;
  itemIds: ItemKey[];
}

export interface ValidateInput {
  date: string;
  items: RuleItem[];
  rules: RuleDef[];
  /** Other dates' menus. Only those inside the week / repeat window matter; extra ones are ignored. */
  others?: DayMenu[];
}

export function matchesFilter(item: RuleItem, f: DishFilter): boolean {
  if (f.course ? item.course !== f.course : item.course === "extra") return false;
  if (f.categories?.length && !(item.category && f.categories.includes(item.category))) return false;
  if (f.tagsAny?.length && !item.tags.some((t) => f.tagsAny!.includes(t))) return false;
  if (f.names?.length) {
    const names = new Set(f.names.map(normalizeName));
    if (!names.has(normalizeName(item.name)) && !(item.dishName && names.has(normalizeName(item.dishName)))) return false;
  }
  return true;
}

const list = (items: RuleItem[]) => items.map((i) => i.name).join(", ");
const itemKey = (i: RuleItem) => (i.dishId != null ? `d${i.dishId}` : `n${normalizeName(i.dishName ?? i.name)}`);

export function effectiveLimits(p: Extract<RuleParams, { type: "count_per_day" }>, date: string) {
  const o = p.weekdayOverrides?.[weekdayOf(date)];
  return {
    min: o && "min" in o ? o.min : p.min,
    max: o && "max" in o ? o.max : p.max,
    overridden: !!o,
  };
}

export function validateMenu({ date, items, rules, others = [] }: ValidateInput): Violation[] {
  const out: Violation[] = [];
  const otherDays = others.filter((m) => m.date !== date);

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const p = rule.params;
    const v = (kind: ViolationKind, message: string, itemIds: ItemKey[] = []) =>
      out.push({ ruleId: rule.id, ruleName: rule.name, hard: rule.hard, kind, message: `${rule.name}: ${message}`, itemIds });

    switch (p.type) {
      case "count_per_day": {
        const hits = items.filter((i) => matchesFilter(i, p.filter));
        const { min, max, overridden } = effectiveLimits(p, date);
        const day = overridden ? ` el ${weekdayOf(date)}` : "";
        if (min != null && hits.length < min)
          v("min", hits.length ? `hay ${hits.length} (${list(hits)}), se necesita${min > 1 ? "n" : ""} al menos ${min}${day}.` : `falta${min > 1 ? "n" : ""} ${min}${day}.`);
        if (max != null && hits.length > max)
          v("max", `hay ${hits.length} (${list(hits)}), máximo ${max}${day}.`, hits.map((i) => i.id));
        break;
      }
      case "count_per_week": {
        const hits = items.filter((i) => matchesFilter(i, p.filter));
        if (!hits.length) break;
        const { start, end } = serviceWeek(date);
        const elsewhere = otherDays
          .filter((m) => m.date >= start && m.date <= end)
          .sort((a, b) => a.date.localeCompare(b.date))
          .flatMap((m) => m.items.filter((i) => matchesFilter(i, p.filter)).map((i) => `${i.name} (${shortDate(m.date)})`));
        const total = hits.length + elsewhere.length;
        if (total > p.max)
          v("week", `${total} en la semana, máximo ${p.max}. Hoy: ${list(hits)}${elsewhere.length ? `; otros días: ${elsewhere.join(", ")}` : ""}.`, hits.map((i) => i.id));
        break;
      }
      case "forbid_pair": {
        const as = items.filter((i) => matchesFilter(i, p.a));
        const bs = items.filter((i) => matchesFilter(i, p.b));
        const pairA = as.filter((a) => bs.some((b) => b.id !== a.id));
        const pairB = bs.filter((b) => as.some((a) => a.id !== b.id));
        if (pairA.length && pairB.length)
          v("pair", `${list(pairA)} no puede ir con ${list(pairB)}.`, [...new Set([...pairA, ...pairB].map((i) => i.id))]);
        break;
      }
      case "no_repeat": {
        const except = new Set((p.exceptNames ?? []).map(normalizeName));
        const isExcept = (i: RuleItem) => except.has(normalizeName(i.name)) || (!!i.dishName && except.has(normalizeName(i.dishName)));
        const seen = new Map<string, RuleItem>();
        for (const item of items) {
          if (item.course === "extra" || isExcept(item)) continue;
          const key = itemKey(item);
          if (seen.has(key)) {
            v("repeat", `${item.name} está dos veces en el menú.`, [item.id]);
            continue;
          }
          seen.set(key, item);
          let nearest: { date: string; diff: number } | null = null;
          for (const m of otherDays) {
            const diff = dayDiff(date, m.date);
            if (Math.abs(diff) >= p.days) continue;
            if (!m.items.some((o) => o.course !== "extra" && itemKey(o) === key)) continue;
            if (!nearest || Math.abs(diff) < Math.abs(nearest.diff)) nearest = { date: m.date, diff };
          }
          if (nearest) {
            const when =
              nearest.diff > 0
                ? `se sirvió el ${shortDate(nearest.date)} (hace ${nearest.diff} día${nearest.diff > 1 ? "s" : ""})`
                : `está en el menú del ${shortDate(nearest.date)}`;
            v("repeat", `${item.name} ${when}; no se repite en ${p.days} días.`, [item.id]);
          }
        }
        break;
      }
      case "text":
        break; // enforced by the LLM when generating
    }
  }
  return out;
}

export const hardViolations = (vs: Violation[]) => vs.filter((v) => v.hard);

/** Strings for `menus.warnings`: hard violations as-is, soft ones marked as suggestions. */
export function formatWarnings(vs: Violation[]): string[] {
  return [...vs.filter((v) => v.hard).map((v) => v.message), ...vs.filter((v) => !v.hard).map((v) => `Sugerencia: ${v.message}`)];
}
