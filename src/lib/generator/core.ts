/**
 * Deterministic menu generator (no LLM, no DB). Pure so it can be unit-tested and reused by the
 * LLM path for candidate pre-filtering, validation and fallbacks.
 *
 * Plan: fill slots from settings.structure (entradas = 1 sopa/crema + varied others; segundos =
 * menestra when required + guisos + one of arroz/pasta/fritura/saltado/verduras/frío), keeping
 * pinned items. Candidates are scored by days since last served, weekday habit (derived from the
 * history), popularity and a bit of randomness, then a small depth-first search picks a
 * combination with no hard rule violations.
 */
import { weekdayOf, type Course, type Weekday } from "@/lib/types";
import { dayDiff } from "@/lib/rules/dates";
import { normalizeName } from "@/lib/rules/text";
import { effectiveLimits, matchesFilter, validateMenu, type DayMenu, type RuleDef, type RuleItem, type Violation } from "@/lib/rules/validate";

export interface CatalogDish {
  id: number;
  name: string;
  course: Course;
  category: string;
  tags: string[];
  protein: string | null;
  base: string | null;
  status: "activo" | "nuevo" | "archivado";
  price: number | null;
  defaultPortions?: number | null;
  createdAt?: string;
}

export interface HistoryItem {
  dishId: number | null;
  name: string;
  course: Course;
}

export interface HistoryMenu {
  date: string;
  items: HistoryItem[];
}

/** An item of the menu being built. `key` identifies it in violations. */
export interface PlannedItem {
  key: string;
  existingId?: number;
  dishId: number | null;
  name: string;
  course: Course;
  price: number | null;
  pinned: boolean;
  reason: string | null;
}

export const ENTRADA_OTHERS = ["ensalada", "fritura", "fria", "criolla"] as const;
export const SEGUNDO_OTHERS = ["arroz", "pasta", "fritura", "saltado", "verduras", "frio"] as const;

// ---------------------------------------------------------------------------------------------
// Context: history stats, scores and rule inputs shared by generate / swap / LLM validation

export interface Stats {
  date: string;
  weekday: Weekday;
  last: Map<number, string>;
  count: Map<number, number>;
  weekdayCount: Map<number, number>;
  weekdayMenus: number;
  maxCount: number;
  extraCount: Map<number, number>;
  menestraRate: number;
  /** Menus on this weekday that had a dish with this base ("lentejas" → 37 of 37 Mondays). */
  baseWeekdayCount: Map<string, number>;
}

export function buildStats(history: HistoryMenu[], date: string, dishesById: Map<number, CatalogDish>): Stats {
  const weekday = weekdayOf(date);
  const s: Stats = {
    date, weekday, last: new Map(), count: new Map(), weekdayCount: new Map(), weekdayMenus: 0, maxCount: 1, extraCount: new Map(), menestraRate: 0, baseWeekdayCount: new Map(),
  };
  let menestraDays = 0;
  for (const m of history) {
    if (m.date >= date) continue;
    const sameDay = weekdayOf(m.date) === weekday;
    if (sameDay) s.weekdayMenus++;
    let hasMenestra = false;
    const bases = new Set<string>();
    for (const i of m.items) {
      if (i.dishId == null) continue;
      if (i.course === "extra") {
        s.extraCount.set(i.dishId, (s.extraCount.get(i.dishId) ?? 0) + 1);
        continue;
      }
      const c = (s.count.get(i.dishId) ?? 0) + 1;
      s.count.set(i.dishId, c);
      s.maxCount = Math.max(s.maxCount, c);
      const prev = s.last.get(i.dishId);
      if (!prev || prev < m.date) s.last.set(i.dishId, m.date);
      if (sameDay) s.weekdayCount.set(i.dishId, (s.weekdayCount.get(i.dishId) ?? 0) + 1);
      const d = dishesById.get(i.dishId);
      if (i.course === "segundo" && d?.category === "menestra") hasMenestra = true;
      if (sameDay && d?.base) bases.add(normalizeName(d.base));
    }
    if (sameDay && hasMenestra) menestraDays++;
    for (const b of bases) s.baseWeekdayCount.set(b, (s.baseWeekdayCount.get(b) ?? 0) + 1);
  }
  s.menestraRate = s.weekdayMenus ? menestraDays / s.weekdayMenus : 0;
  return s;
}

export function daysSince(stats: Stats, dishId: number): number | null {
  const last = stats.last.get(dishId);
  return last ? dayDiff(stats.date, last) : null;
}

/** Base desirability of a dish for this date, independent of the rest of the menu. */
export function baseScore(d: CatalogDish, stats: Stats): number {
  const days = daysSince(stats, d.id);
  const recency = days == null ? 1.2 : (Math.min(days, 28) / 28) * 3;
  const share = stats.weekdayMenus ? (stats.weekdayCount.get(d.id) ?? 0) / stats.weekdayMenus : 0;
  const pop = Math.log1p(stats.count.get(d.id) ?? 0) / Math.log1p(stats.maxCount);
  return recency + share * 6 + baseShare(d, stats) * 4 + pop * 1.5;
}

function baseShare(d: CatalogDish, stats: Stats): number {
  if (!d.base || !stats.weekdayMenus) return 0;
  return (stats.baseWeekdayCount.get(normalizeName(d.base)) ?? 0) / stats.weekdayMenus;
}

/** Short Spanish reason: weekday habit, last served, popularity. */
export function reasonFor(d: CatalogDish, stats: Stats): string {
  const parts: string[] = [];
  const wc = stats.weekdayCount.get(d.id) ?? 0;
  const bc = d.base ? stats.baseWeekdayCount.get(normalizeName(d.base)) ?? 0 : 0;
  if (stats.weekdayMenus && bc >= 3 && bc / stats.weekdayMenus >= 0.4 && bc > wc)
    parts.push(`${d.base!.toLowerCase()} los ${stats.weekday === "sábado" ? "sábados" : stats.weekday} (${bc} de ${stats.weekdayMenus})`);
  else if (stats.weekdayMenus && wc >= 3 && wc / stats.weekdayMenus >= 0.25) parts.push(`costumbre del ${stats.weekday} (${wc} de ${stats.weekdayMenus})`);
  const days = daysSince(stats, d.id);
  if (days == null) parts.push("no aparece en el historial");
  else parts.push(`última vez hace ${days} día${days === 1 ? "" : "s"}`);
  const count = stats.count.get(d.id) ?? 0;
  if (parts.length < 2 && count >= 20) parts.push(`favorito (${count} veces)`);
  const s = parts.join(" · ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface EngineInput {
  date: string;
  dishes: CatalogDish[];
  history: HistoryMenu[];
  rules: RuleDef[];
  rng?: () => number;
}

export interface Engine {
  date: string;
  rules: RuleDef[];
  dishes: CatalogDish[];
  byId: Map<number, CatalogDish>;
  byName: Map<string, CatalogDish>;
  stats: Stats;
  others: DayMenu[];
  score: (d: CatalogDish) => number;
  rng: () => number;
  toRule: (p: Pick<PlannedItem, "key" | "dishId" | "name" | "course">) => RuleItem;
  validate: (items: PlannedItem[]) => Violation[];
}

export function createEngine({ date, dishes, history, rules, rng = Math.random }: EngineInput): Engine {
  const byId = new Map(dishes.map((d) => [d.id, d]));
  const byName = new Map(dishes.map((d) => [normalizeName(d.name), d]));
  const stats = buildStats(history, date, byId);
  const jitter = new Map(dishes.map((d) => [d.id, rng() * 2]));
  const base = new Map(dishes.map((d) => [d.id, baseScore(d, stats) + jitter.get(d.id)!]));

  const toRule = (p: Pick<PlannedItem, "key" | "dishId" | "name" | "course">): RuleItem => {
    const d = p.dishId != null ? byId.get(p.dishId) : undefined;
    return { id: p.key, course: p.course, name: p.name, dishId: p.dishId, dishName: d?.name ?? null, category: d?.category ?? null, tags: d?.tags ?? [] };
  };

  // Only menus near the date matter (repeat window and the Mon–Sat week).
  const window = Math.max(7, ...rules.map((r) => (r.params.type === "no_repeat" ? r.params.days : 0))) + 7;
  const others: DayMenu[] = history
    .filter((m) => m.date !== date && Math.abs(dayDiff(date, m.date)) <= window)
    .map((m) => ({ date: m.date, items: m.items.map((i, idx) => toRule({ key: `h${m.date}-${idx}`, dishId: i.dishId, name: i.name, course: i.course })) }));

  return {
    date,
    rules,
    dishes,
    byId,
    byName,
    stats,
    others,
    score: (d) => base.get(d.id) ?? baseScore(d, stats),
    rng,
    toRule,
    validate: (items) => validateMenu({ date, items: items.map(toRule), rules, others }),
  };
}

// ---------------------------------------------------------------------------------------------
// Slots and composition

export interface Slot {
  course: "entrada" | "segundo";
  categories: readonly string[] | null;
  kind: "sopa" | "menestra" | "guiso" | "otro";
}

export function menestraNeeded(engine: Engine): boolean {
  for (const r of engine.rules) {
    if (!r.enabled || !r.hard || r.params.type !== "count_per_day" || !r.params.filter.categories?.includes("menestra")) continue;
    const { min, max } = effectiveLimits(r.params, engine.date);
    if (min != null && min >= 1) return true;
    if (max === 0) return false;
  }
  return engine.stats.menestraRate >= 0.5;
}

export function planSlots(entradas: number, segundos: number, withMenestra: boolean): Slot[] {
  const slots: Slot[] = [];
  if (entradas > 0) slots.push({ course: "entrada", categories: ["sopa", "crema"], kind: "sopa" });
  let rest = segundos;
  if (withMenestra && rest > 0) {
    slots.push({ course: "segundo", categories: ["menestra"], kind: "menestra" });
    rest--;
  }
  const guisos = rest >= 3 ? 2 : Math.min(rest, 1);
  for (let i = 0; i < guisos; i++) slots.push({ course: "segundo", categories: ["guiso"], kind: "guiso" });
  for (let i = guisos; i < rest; i++) slots.push({ course: "segundo", categories: SEGUNDO_OTHERS, kind: "otro" });
  for (let i = 1; i < entradas; i++) slots.push({ course: "entrada", categories: ENTRADA_OTHERS, kind: "otro" });
  return slots;
}

/** Removes the slots that pinned items already fill (best-matching slot, else the most flexible one). */
export function removePinnedSlots(slots: Slot[], pinned: PlannedItem[], byId: Map<number, CatalogDish>): Slot[] {
  const left = [...slots];
  for (const p of pinned) {
    if (p.course === "extra") continue;
    const cat = p.dishId != null ? byId.get(p.dishId)?.category : undefined;
    let idx = left.findIndex((s) => s.course === p.course && cat != null && s.categories?.includes(cat));
    if (idx < 0) {
      for (let i = left.length - 1; i >= 0; i--)
        if (left[i].course === p.course && (idx < 0 || left[i].kind === "otro")) {
          idx = i;
          if (left[i].kind === "otro") break;
        }
    }
    if (idx >= 0) left.splice(idx, 1);
  }
  return left;
}

/** Penalties for making the menu monotonous: repeated categories/proteins, too heavy, too fried. */
export function compositionPenalty(d: CatalogDish, course: Course, chosen: PlannedItem[], byId: Map<number, CatalogDish>, sameCategoryPenalty = 3): number {
  const all = chosen.map((c) => (c.dishId != null ? byId.get(c.dishId) : undefined)).filter((x): x is CatalogDish => !!x);
  const sameCourse = chosen
    .filter((c) => c.course === course)
    .map((c) => (c.dishId != null ? byId.get(c.dishId) : undefined))
    .filter((x): x is CatalogDish => !!x);
  let pen = 0;
  if (sameCourse.some((c) => c.category === d.category)) pen -= sameCategoryPenalty;
  if (course === "segundo" && d.protein) {
    const same = sameCourse.filter((c) => c.protein === d.protein);
    pen -= 1.5 * same.length;
    if (d.category === "guiso" && d.protein === "Pollo" && same.filter((c) => c.category === "guiso").length >= 2) pen -= 5;
  }
  if (d.tags.includes("pesado") && all.filter((c) => c.tags.includes("pesado")).length >= 2) pen -= 3;
  if (d.tags.includes("frito") && sameCourse.some((c) => c.tags.includes("frito"))) pen -= 1;
  if (d.base && sameCourse.some((c) => c.base === d.base)) pen -= 2;
  return pen;
}

let seq = 0;
export const newKey = () => `n${++seq}`;

export function plannedFromDish(d: CatalogDish, course: Course, reason: string | null): PlannedItem {
  return { key: newKey(), dishId: d.id, name: d.name, course, price: course === "extra" ? d.price : null, pinned: false, reason };
}

const breaks = (vs: Violation[], key?: string) => vs.some((v) => v.hard && v.kind !== "min" && (!key || v.itemIds.includes(key)));

interface Candidate {
  dish: CatalogDish;
  item: PlannedItem;
  score: number;
}

function candidatesFor(engine: Engine, slot: Slot, chosen: PlannedItem[], pool: CatalogDish[], strict: boolean): Candidate[] {
  const used = new Set(chosen.map((c) => c.dishId));
  const inSlot = (cats: readonly string[] | null) => pool.filter((d) => d.course === slot.course && !used.has(d.id) && (!cats || cats.includes(d.category)));
  let dishes = inSlot(slot.categories);
  if (!dishes.length) dishes = inSlot(null);
  const out: Candidate[] = [];
  for (const d of dishes) {
    const item = plannedFromDish(d, slot.course, null);
    const vs = engine.validate([...chosen, item]);
    if (strict && breaks(vs, item.key)) continue;
    const soft = vs.filter((v) => !v.hard && v.kind !== "min" && v.itemIds.includes(item.key)).length;
    const hard = vs.filter((v) => v.hard && v.kind !== "min" && v.itemIds.includes(item.key)).length;
    const sameCat = slot.kind === "otro" ? 3 : 0;
    out.push({ dish: d, item, score: engine.score(d) + compositionPenalty(d, slot.course, chosen, engine.byId, sameCat) - 3 * soft - 20 * hard });
  }
  return out.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------------------------
// Generate

export interface GenerateInput extends EngineInput {
  structure: { entradas: number; segundos: number };
  pinned: PlannedItem[];
  extras: { names: string[]; perDay: number };
  /** Dish ids that must not be picked (e.g. the LLM's rejected choices). */
  exclude?: Set<number>;
}

export interface GenerateResult {
  items: PlannedItem[];
  violations: Violation[];
  reasoning: string;
}

/** Dishes the generator may pick for the menú: active and not excluded. */
export function eligibleDishes(engine: Engine, exclude?: Set<number>) {
  return engine.dishes.filter((d) => d.status === "activo" && d.course !== "extra" && !exclude?.has(d.id));
}

export function generateMenu(input: GenerateInput, engine = createEngine(input)): GenerateResult {
  const { structure, pinned, extras } = input;
  const pool = eligibleDishes(engine, input.exclude);
  const withMenestra = menestraNeeded(engine);
  const slots = removePinnedSlots(planSlots(structure.entradas, structure.segundos, withMenestra), pinned, engine.byId);

  const chosen: PlannedItem[] = pinned.filter((p) => p.course !== "extra");
  const base = chosen.length;
  let steps = 0;
  const K = 5;
  const dfs = (i: number): boolean => {
    if (i === slots.length) return true;
    for (const c of candidatesFor(engine, slots[i], chosen, pool, true).slice(0, K)) {
      if (++steps > 400) return false;
      chosen.push(c.item);
      if (dfs(i + 1)) return true;
      chosen.pop();
    }
    return false;
  };
  if (!dfs(0)) {
    chosen.length = base;
    for (const slot of slots) {
      const [best] = candidatesFor(engine, slot, chosen, pool, true);
      const pick = best ?? candidatesFor(engine, slot, chosen, pool, false)[0];
      if (pick) chosen.push(pick.item);
    }
  }
  repairMinimums(engine, chosen, pool);
  for (const c of chosen) if (!c.pinned && c.dishId != null && !c.reason) c.reason = reasonFor(engine.byId.get(c.dishId)!, engine.stats);

  const items = [...sortForDisplay(chosen, engine.byId), ...pickExtras(engine, extras, [...chosen, ...pinned.filter((p) => p.course === "extra")])];
  const violations = engine.validate(items);
  return { items, violations, reasoning: summarize(engine, items, violations, withMenestra) };
}

/** Replaces non-pinned items to satisfy `min` counts the slot plan didn't cover (custom rules). */
function repairMinimums(engine: Engine, chosen: PlannedItem[], pool: CatalogDish[]) {
  const hardCount = (items: PlannedItem[]) => engine.validate(items).filter((v) => v.hard).length;
  for (let round = 0; round < 4; round++) {
    const vs = engine.validate(chosen);
    const mins = vs.filter((v) => v.hard && v.kind === "min");
    if (!mins.length) return;
    let current = vs.filter((v) => v.hard).length;
    let improved = false;
    for (const v of mins) {
      const rule = engine.rules.find((r) => r.id === v.ruleId);
      if (rule?.params.type !== "count_per_day") continue;
      const f = rule.params.filter;
      const used = new Set(chosen.map((c) => c.dishId));
      const options = pool
        .filter((d) => !used.has(d.id) && (!f.course || d.course === f.course) && matchesFilter(engine.toRule(plannedFromDish(d, f.course ?? d.course, null)), f))
        .sort((a, b) => engine.score(b) - engine.score(a))
        .slice(0, 15);
      let best: { idx: number; item: PlannedItem; count: number } | null = null;
      for (const d of options) {
        const course = f.course ?? d.course;
        chosen.forEach((c, idx) => {
          if (c.pinned || c.course !== course || matchesFilter(engine.toRule(c), f)) return;
          const item = plannedFromDish(d, course, null);
          const next = chosen.map((x, j) => (j === idx ? item : x));
          const count = hardCount(next);
          if (count < (best?.count ?? current)) best = { idx, item, count };
        });
      }
      if (best) {
        const b = best as { idx: number; item: PlannedItem; count: number };
        chosen[b.idx] = b.item;
        current = b.count;
        improved = true;
      }
    }
    if (!improved) return;
  }
}

const COURSE_ORDER: Record<Course, number> = { entrada: 0, segundo: 1, extra: 2 };
const SLOT_ORDER: Record<string, number> = { sopa: 0, crema: 0, menestra: 1, guiso: 2 };

/** Entradas: soup first; segundos: menestra, guisos, then the rest (like the posted menus). */
export function sortForDisplay(items: PlannedItem[], byId: Map<number, CatalogDish>): PlannedItem[] {
  const rank = (p: PlannedItem) => SLOT_ORDER[(p.dishId != null && byId.get(p.dishId)?.category) || ""] ?? 3;
  return items
    .map((p, i) => ({ p, i }))
    .sort((a, b) => COURSE_ORDER[a.p.course] - COURSE_ORDER[b.p.course] || rank(a.p) - rank(b.p) || a.i - b.i)
    .map((x) => x.p);
}

export function pickExtras(engine: Engine, extras: { names: string[]; perDay: number }, current: PlannedItem[]): PlannedItem[] {
  const pinnedExtras = current.filter((p) => p.course === "extra");
  const want = extras.perDay - pinnedExtras.length;
  if (want <= 0) return pinnedExtras;
  const onMenu = new Set(current.map((c) => c.dishId).filter((x) => x != null));
  const onMenuNames = new Set(current.map((c) => normalizeName(c.name)));
  const maxExtra = Math.max(1, ...engine.stats.extraCount.values());
  const options = extras.names
    .filter((n) => !onMenuNames.has(normalizeName(n)))
    .map((name) => {
      const d = engine.byName.get(normalizeName(name));
      if (d && onMenu.has(d.id)) return null;
      const count = d ? engine.stats.extraCount.get(d.id) ?? 0 : 0;
      return { name, d, count, score: (count / maxExtra) * 3 + engine.rng() * 1.5 };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.score - a.score)
    .slice(0, want);
  return [
    ...pinnedExtras,
    ...options.map(({ name, d, count }) => ({
      key: newKey(),
      dishId: d?.id ?? null,
      name: d?.name ?? name,
      course: "extra" as const,
      price: d?.price ?? null,
      pinned: false,
      reason: count ? `Extra de la lista (servido ${count} ${count === 1 ? "vez" : "veces"})` : "Extra de la lista",
    })),
  ];
}

function summarize(engine: Engine, items: PlannedItem[], violations: Violation[], withMenestra: boolean): string {
  const menestra = items.find((i) => i.course === "segundo" && i.dishId != null && engine.byId.get(i.dishId)?.category === "menestra");
  const parts = [`Menú del ${engine.stats.weekday} armado con las reglas y el historial (sin IA).`];
  if (menestra) parts.push(`Menestra: ${menestra.name}.`);
  else if (!withMenestra) parts.push(`Sin menestra (el ${engine.stats.weekday} es opcional).`);
  parts.push("Se priorizan platos que no salen hace tiempo y las costumbres de cada día.");
  const hard = violations.filter((v) => v.hard).length;
  if (hard) parts.push(`Quedan ${hard} regla${hard > 1 ? "s" : ""} sin cumplir: revisa los avisos.`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------------------------
// Swap

export interface Replacement {
  dish: CatalogDish;
  score: number;
  reason: string;
  /** Hard violations the replacement would introduce (empty = valid). */
  newViolations: Violation[];
}

const vKey = (v: Violation) => `${v.ruleId}|${v.kind}|${[...v.itemIds].sort().join(",")}`;

/** Ranked replacements for one item: same course, same category preferred, valid ones first. */
export function rankReplacements(engine: Engine, items: PlannedItem[], targetKey: string, extrasNames: string[] = []): Replacement[] {
  const target = items.find((i) => i.key === targetKey);
  if (!target) return [];
  const rest = items.filter((i) => i.key !== targetKey);
  const used = new Set(items.map((i) => i.dishId));
  const targetDish = target.dishId != null ? engine.byId.get(target.dishId) : undefined;
  const baseline = new Set(engine.validate(items).map(vKey));

  let pool: CatalogDish[];
  if (target.course === "extra") {
    const names = new Set(extrasNames.map(normalizeName));
    pool = engine.dishes.filter((d) => d.status !== "archivado" && (names.has(normalizeName(d.name)) || (d.course === "extra" && d.price != null)));
  } else pool = eligibleDishes(engine).filter((d) => d.course === target.course);

  const out: Replacement[] = [];
  for (const d of pool) {
    if (used.has(d.id)) continue;
    const item = { ...plannedFromDish(d, target.course, null), key: target.key };
    const next = items.map((i) => (i.key === targetKey ? item : i));
    const newViolations = target.course === "extra" ? [] : engine.validate(next).filter((v) => v.hard && !baseline.has(vKey(v)));
    let score = engine.score(d) + compositionPenalty(d, target.course, rest, engine.byId, 1);
    if (targetDish && d.category === targetDish.category) score += 4;
    if (target.course === "extra") score = (engine.stats.extraCount.get(d.id) ?? 0) / 10 + engine.score(d) / 5;
    const reason = target.course === "extra" ? "Extra de la lista" : reasonFor(d, engine.stats);
    out.push({ dish: d, score, reason, newViolations });
  }
  return out.sort((a, b) => a.newViolations.length - b.newViolations.length || b.score - a.score);
}
