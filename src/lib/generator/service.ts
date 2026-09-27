import "server-only";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { findDishByName, ensureDish } from "@/lib/dishes";
import { getLlm, llmEnabled, llmStatus } from "@/lib/llm";
import { getMenuPayload } from "@/lib/menus";
import { getSettings } from "@/lib/settings";
import { serviceWeek } from "@/lib/rules/dates";
import { normalizeName } from "@/lib/rules/text";
import { formatWarnings, type Violation } from "@/lib/rules/validate";
import { weekdayOf, type Course, type MenuPayload, type Settings } from "@/lib/types";
import { categoriesFor } from "./classify";
import {
  createEngine, eligibleDishes, generateMenu, newKey, pickExtras, plannedFromDish, rankReplacements, sortForDisplay,
  type CatalogDish, type Engine, type HistoryMenu, type PlannedItem,
} from "./core";
import { loadDishes, loadHistory, loadMenuItems, loadRules } from "./data";
import { buildGeneratePrompt, buildSwapPrompt, generateSchema, MENU_SYSTEM, swapSchema, type GenerateOutput } from "./llm";

const { menus, menuItems, dishes } = schema;

/** Error with an HTTP status and a Spanish message for the UI. */
export class MenuError extends Error {
  constructor(message: string, public status = 400, public warnings?: string[]) {
    super(message);
  }
}

interface Ctx {
  settings: Settings;
  dishes: CatalogDish[];
  history: HistoryMenu[];
  rules: Awaited<ReturnType<typeof loadRules>>;
}

async function loadCtx(): Promise<Ctx> {
  const [settings, d, history, rules] = await Promise.all([getSettings(), loadDishes(), loadHistory(), loadRules()]);
  return { settings, dishes: d, history, rules };
}

const engineFor = (ctx: Ctx, date: string, extra: CatalogDish[] = []) =>
  createEngine({ date, dishes: extra.length ? [...ctx.dishes, ...extra] : ctx.dishes, history: ctx.history, rules: ctx.rules });

export async function findMenu(date: string) {
  const [m] = await db.select().from(menus).where(eq(menus.date, date));
  return m ?? null;
}

/** Existing menu for the date, or a new borrador at settings.menuPrice. */
export async function ensureMenu(date: string, source: "generado" | "manual" = "manual") {
  const existing = await findMenu(date);
  if (existing) return existing;
  const { menuPrice } = await getSettings();
  const [created] = await db.insert(menus).values({ date, status: "borrador", source, menuPrice }).onConflictDoNothing().returning();
  return created ?? (await findMenu(date))!;
}

async function requireMenu(date: string) {
  const m = await findMenu(date);
  if (!m) throw new MenuError("No hay menú para esa fecha.", 404);
  return m;
}

const touch = (menuId: number) => db.update(menus).set({ updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))` }).where(eq(menus.id, menuId));

/** Validates the saved menu and stores its warnings. Returns the violations. */
export async function refreshWarnings(date: string, ctx?: Ctx): Promise<Violation[]> {
  const menu = await findMenu(date);
  if (!menu) return [];
  const [items, c] = await Promise.all([loadMenuItems(menu.id), ctx ?? loadCtx()]);
  const vs = engineFor(c, date).validate(items);
  const warnings = formatWarnings(vs);
  if (JSON.stringify(warnings) !== JSON.stringify(menu.warnings)) await db.update(menus).set({ warnings }).where(eq(menus.id, menu.id));
  return vs;
}

/** MenuPayload with freshly computed warnings. */
export async function menuPayload(date: string): Promise<MenuPayload> {
  await refreshWarnings(date);
  return getMenuPayload(date);
}

// ---------------------------------------------------------------------------------------------
// Generate

export interface GenerateOutcome {
  menuId: number;
  usedLlm: boolean;
  newDishIds: number[];
  note?: string;
}

export async function generateMenuForDate(date: string, { useLlm = false }: { useLlm?: boolean } = {}): Promise<GenerateOutcome> {
  const ctx = await loadCtx();
  const menu = await ensureMenu(date, "generado");
  const current = await loadMenuItems(menu.id);
  const pinned = current.filter((i) => i.pinned);
  const structure = ctx.settings.structure[weekdayOf(date)] ?? { entradas: 3, segundos: 4 };
  const extras = { names: ctx.settings.defaultExtras, perDay: ctx.settings.extrasPerDay };

  let result: { items: PlannedItem[]; reasoning: string; newDishIds: number[] } | null = null;
  let note: string | undefined;
  if (useLlm) {
    if (!llmEnabled()) note = `${llmStatus().warning ?? "La IA no está disponible."} Se armó con las reglas.`;
    else
      try {
        result = await generateWithLlm(ctx, date, structure, pinned, extras);
      } catch (e) {
        console.warn("[generator] IA falló, uso el generador por reglas:", (e as Error).message);
        note = `La IA no pudo armar el menú (${shortError(e)}); se armó con las reglas.`;
      }
  }
  if (!result) {
    const r = generateMenu({ date, dishes: ctx.dishes, history: ctx.history, rules: ctx.rules, structure, pinned, extras }, engineFor(ctx, date));
    result = { items: r.items, reasoning: note ? `${note} ${r.reasoning}` : r.reasoning, newDishIds: [] };
  }
  const final = result;

  // One atomic batch (not an interactive transaction: libSQL runs those on a separate connection,
  // which makes concurrent background writers fail with SQLITE_BUSY).
  const keep = final.items.map((i) => i.existingId).filter((x): x is number => x != null);
  await db.batch([
    db.delete(menuItems).where(keep.length ? and(eq(menuItems.menuId, menu.id), notInArray(menuItems.id, keep)) : eq(menuItems.menuId, menu.id)),
    ...final.items.map((it, position) =>
      it.existingId != null
        ? db.update(menuItems).set({ position }).where(eq(menuItems.id, it.existingId))
        : db.insert(menuItems).values({ menuId: menu.id, dishId: it.dishId, name: it.name, course: it.course, price: it.price, position, pinned: false, reason: it.reason }),
    ),
    db
      .update(menus)
      .set({ status: "borrador", source: "generado", menuPrice: ctx.settings.menuPrice, reasoning: final.reasoning, updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))` })
      .where(eq(menus.id, menu.id)),
  ]);
  await refreshWarnings(date, await loadCtx());
  return { menuId: menu.id, usedLlm: !note && useLlm, newDishIds: final.newDishIds, note };
}

const shortError = (e: unknown) => ((e as Error)?.message ?? String(e)).replace(/\s+/g, " ").slice(0, 160);

/** New dishes ("nuevo") created or served in the Mon–Sat week of the date. */
function newDishesThisWeek(ctx: Ctx, date: string): number {
  const { start, end } = serviceWeek(date);
  const served = new Set(ctx.history.filter((m) => m.date >= start && m.date <= end && m.date !== date).flatMap((m) => m.items.map((i) => i.dishId)));
  return ctx.dishes.filter((d) => {
    if (d.status !== "nuevo") return false;
    const created = d.createdAt?.slice(0, 10);
    return served.has(d.id) || (!!created && created >= start && created <= end);
  }).length;
}

const VIRTUAL_ID = -1;

async function generateWithLlm(
  ctx: Ctx,
  date: string,
  structure: { entradas: number; segundos: number },
  pinned: PlannedItem[],
  extras: { names: string[]; perDay: number },
): Promise<{ items: PlannedItem[]; reasoning: string; newDishIds: number[] }> {
  const engine = engineFor(ctx, date);
  const pinnedMenu = pinned.filter((p) => p.course !== "extra");
  const need = {
    entradas: Math.max(0, structure.entradas - pinnedMenu.filter((p) => p.course === "entrada").length),
    segundos: Math.max(0, structure.segundos - pinnedMenu.filter((p) => p.course === "segundo").length),
  };
  const pinnedIds = new Set(pinnedMenu.map((p) => p.dishId));
  const candidates = eligibleDishes(engine).filter((d) => {
    if (pinnedIds.has(d.id)) return false;
    const it = plannedFromDish(d, d.course, null);
    return !engine.validate([...pinnedMenu, it]).some((v) => v.hard && v.kind !== "min" && v.itemIds.includes(it.key));
  });
  const allowNewDish = ctx.settings.newDishesPerWeek - newDishesThisWeek(ctx, date) > 0;

  let feedback: string[] | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await getLlm().complete({
      system: MENU_SYSTEM,
      prompt: buildGeneratePrompt({ engine, weekday: weekdayOf(date), need, pinned, history: ctx.history, candidates, allowNewDish, feedback }),
      schema: generateSchema,
      tier: "smart",
    });
    const { items, problems, newDish } = resolveLlmItems(out, engine, candidates, need, pinnedIds, allowNewDish);
    const eng = newDish ? engineFor(ctx, date, [newDish]) : engine;
    const all = [...pinnedMenu, ...items];
    const hard = eng.validate(all).filter((v) => v.hard);
    if (!problems.length && !hard.length) {
      const newDishIds: number[] = [];
      if (newDish) {
        const existing = await findDishByName(newDish.name);
        const [row] = existing
          ? [existing]
          : await db
              .insert(dishes)
              .values({ name: newDish.name, course: newDish.course, category: newDish.category, tags: newDish.tags, protein: newDish.protein, base: newDish.base, status: "nuevo", notes: "Propuesto por la IA; revisar y aprobar." })
              .returning();
        for (const it of all) if (it.dishId === VIRTUAL_ID) it.dishId = row.id;
        newDishIds.push(row.id);
      }
      const final = [...sortForDisplay(all, eng.byId), ...pickExtras(eng, extras, [...all, ...pinned.filter((p) => p.course === "extra")])];
      return { items: final, reasoning: `IA: ${out.reasoning}`, newDishIds };
    }
    feedback = [...problems, ...hard.map((v) => v.message)];
  }
  throw new Error(`la propuesta no cumplía las reglas: ${feedback!.join(" / ")}`);
}

function resolveLlmItems(out: GenerateOutput, engine: Engine, candidates: CatalogDish[], need: { entradas: number; segundos: number }, pinnedIds: Set<number | null>, allowNew: boolean) {
  const cand = new Map(candidates.map((d) => [d.id, d]));
  const problems: string[] = [];
  const items: PlannedItem[] = [];
  const used = new Set(pinnedIds);
  let newDish: CatalogDish | null = null;
  const counts = { entrada: 0, segundo: 0 };

  for (const it of out.items) {
    if (counts[it.course] >= need[it.course === "entrada" ? "entradas" : "segundos"]) continue; // trim extras beyond the structure
    let d: CatalogDish | undefined;
    if (it.dishId != null) {
      d = cand.get(it.dishId);
      if (!d) {
        const known = engine.byId.get(it.dishId);
        problems.push(known ? `${known.name} no está entre los candidatos válidos.` : `El id #${it.dishId} no existe.`);
        continue;
      }
    } else if (it.newDish) {
      const byName = engine.byName.get(normalizeName(it.newDish.name));
      if (byName) {
        d = cand.get(byName.id);
        if (!d) {
          problems.push(`${byName.name} ya existe y no es un candidato válido.`);
          continue;
        }
      } else if (!allowNew) {
        problems.push("Esta semana no se pueden inventar platos nuevos; elige de la lista.");
        continue;
      } else if (newDish) {
        problems.push("Solo se puede inventar un plato nuevo.");
        continue;
      } else if (!categoriesFor(it.course).includes(it.newDish.category)) {
        problems.push(`La categoría "${it.newDish.category}" no vale para ${it.course}.`);
        continue;
      } else {
        newDish = { id: VIRTUAL_ID, name: it.newDish.name.trim(), course: it.course, category: it.newDish.category, tags: it.newDish.tags, protein: it.newDish.protein, base: it.newDish.base, status: "nuevo", price: null };
        items.push({ key: newKey(), dishId: VIRTUAL_ID, name: newDish.name, course: it.course, price: null, pinned: false, reason: `Plato nuevo: ${it.reason}` });
        counts[it.course]++;
        continue;
      }
    } else {
      problems.push("Un ítem no tenía dishId ni newDish.");
      continue;
    }
    if (used.has(d.id)) {
      problems.push(`${d.name} está repetido.`);
      continue;
    }
    if (d.course !== it.course) {
      problems.push(`${d.name} es ${d.course}, no ${it.course}.`);
      continue;
    }
    used.add(d.id);
    items.push({ key: newKey(), dishId: d.id, name: d.name, course: it.course, price: null, pinned: false, reason: it.reason });
    counts[it.course]++;
  }
  if (counts.entrada < need.entradas) problems.push(`Faltan entradas: se pedían ${need.entradas} y llegaron ${counts.entrada}.`);
  if (counts.segundo < need.segundos) problems.push(`Faltan segundos: se pedían ${need.segundos} y llegaron ${counts.segundo}.`);
  return { items, problems, newDish };
}

// ---------------------------------------------------------------------------------------------
// Swap

export async function swapMenuItem(date: string, itemId: number, { useLlm = false }: { useLlm?: boolean } = {}) {
  const menu = await requireMenu(date);
  const items = await loadMenuItems(menu.id);
  const target = items.find((i) => i.existingId === itemId);
  if (!target) throw new MenuError("Ese plato no está en el menú.", 404);
  const ctx = await loadCtx();
  const engine = engineFor(ctx, date);
  const ranked = rankReplacements(engine, items, target.key, ctx.settings.defaultExtras);
  if (!ranked.length) throw new MenuError("No hay otro plato para reemplazarlo.", 409);
  const valid = ranked.filter((r) => !r.newViolations.length);

  let pick: (typeof ranked)[number] | undefined;
  let reason: string | undefined;
  if (useLlm && llmEnabled() && target.course !== "extra" && valid.length > 1) {
    try {
      const options = valid.slice(0, 15);
      const out = await getLlm().complete({ system: MENU_SYSTEM, prompt: buildSwapPrompt(engine, items, target, options, ctx.rules), schema: swapSchema, tier: "smart" });
      pick = options.find((o) => o.dish.id === out.dishId);
      reason = pick && out.reason;
    } catch (e) {
      console.warn("[generator] cambio con IA falló:", (e as Error).message);
    }
  }
  if (!pick) {
    // a little randomness among the best so pressing "cambiar" twice doesn't bounce between two dishes
    const top = (valid.length ? valid : ranked).slice(0, 3);
    pick = top[Math.floor(Math.random() * top.length)];
    reason = pick.reason;
  }
  const d = pick.dish;
  await db
    .update(menuItems)
    .set({ dishId: d.id, name: d.name, price: target.course === "extra" ? d.price : null, portions: null, reason })
    .where(eq(menuItems.id, itemId));
  await touch(menu.id);
  return { menuId: menu.id };
}

// ---------------------------------------------------------------------------------------------
// Manual edits

async function resolveDish(name: string, course: Course) {
  const existing = await findDishByName(name);
  if (existing) return { dish: existing, created: false };
  return { dish: await ensureDish(name, course, { classify: "heuristic" }), created: true };
}

async function dishById(id: number) {
  const [d] = await db.select().from(dishes).where(eq(dishes.id, id));
  if (!d) throw new MenuError("Ese plato no existe.", 404);
  return d;
}

export interface ItemMutation {
  menuId: number;
  /** Dishes created on the fly (heuristic class) that should be re-classified with the LLM. */
  newDishIds: number[];
}

export async function addMenuItem(
  date: string,
  body: { course: Course; name?: string; dishId?: number | null; price?: number | null; portions?: number | null },
): Promise<ItemMutation> {
  const menu = await ensureMenu(date);
  let dish: typeof dishes.$inferSelect;
  let created = false;
  if (body.dishId != null) dish = await dishById(body.dishId);
  else {
    if (!body.name?.trim()) throw new MenuError("Escribe el nombre del plato.");
    ({ dish, created } = await resolveDish(body.name, body.course));
    if (!created) body = { ...body, name: dish.name }; // same name modulo case/accents: use the catalog spelling
  }
  const [{ max }] = await db.select({ max: sql<number | null>`max(${menuItems.position})` }).from(menuItems).where(eq(menuItems.menuId, menu.id));
  await db.insert(menuItems).values({
    menuId: menu.id,
    dishId: dish.id,
    name: body.name?.trim() || dish.name,
    course: body.course,
    price: body.price !== undefined ? body.price : body.course === "extra" ? dish.price : null,
    portions: body.portions ?? null,
    position: (max ?? -1) + 1,
    pinned: true, // chosen by a person: keep it when regenerating
    reason: "Agregado a mano",
  });
  await touch(menu.id);
  return { menuId: menu.id, newDishIds: created ? [dish.id] : [] };
}

export async function updateMenuItem(
  date: string,
  itemId: number,
  patch: { name?: string; dishId?: number | null; price?: number | null; portions?: number | null; pinned?: boolean },
): Promise<ItemMutation> {
  const menu = await requireMenu(date);
  const [item] = await db.select().from(menuItems).where(and(eq(menuItems.id, itemId), eq(menuItems.menuId, menu.id)));
  if (!item) throw new MenuError("Ese plato no está en el menú.", 404);
  const set: Partial<typeof menuItems.$inferInsert> = {};
  const newDishIds: number[] = [];

  let dish: typeof dishes.$inferSelect | null | undefined;
  if (patch.dishId !== undefined) {
    dish = patch.dishId == null ? null : await dishById(patch.dishId);
    set.dishId = dish?.id ?? null;
    set.name = patch.name?.trim() || dish?.name || item.name;
  } else if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new MenuError("El nombre no puede quedar vacío.");
    set.name = name;
    if (normalizeName(name) !== normalizeName(item.name)) {
      const r = await resolveDish(name, item.course);
      dish = r.dish;
      set.dishId = r.dish.id;
      if (r.created) newDishIds.push(r.dish.id);
      else set.name = r.dish.name;
    }
  }
  if (dish !== undefined && set.dishId !== item.dishId) {
    set.reason = "Cambiado a mano";
    set.portions = null;
    if (item.course === "extra" && patch.price === undefined) set.price = dish?.price ?? item.price;
  }
  if (patch.price !== undefined) set.price = patch.price;
  if (patch.portions !== undefined) set.portions = patch.portions;
  if (patch.pinned !== undefined) set.pinned = patch.pinned;
  if (Object.keys(set).length) await db.update(menuItems).set(set).where(eq(menuItems.id, itemId));
  await touch(menu.id);
  return { menuId: menu.id, newDishIds };
}

export async function deleteMenuItem(date: string, itemId: number): Promise<ItemMutation> {
  const menu = await requireMenu(date);
  const res = await db.delete(menuItems).where(and(eq(menuItems.id, itemId), eq(menuItems.menuId, menu.id))).returning({ id: menuItems.id });
  if (!res.length) throw new MenuError("Ese plato no está en el menú.", 404);
  await touch(menu.id);
  return { menuId: menu.id, newDishIds: [] };
}

/** Publish / unpublish / price. Publishing needs every dish approved and (unless forced) no hard violations. */
export async function updateMenu(date: string, patch: { status?: "borrador" | "publicado"; menuPrice?: number; force?: boolean }) {
  const menu = await requireMenu(date);
  if (patch.status === "publicado" && menu.status !== "publicado") {
    const pending = await db
      .select({ name: dishes.name })
      .from(menuItems)
      .innerJoin(dishes, eq(menuItems.dishId, dishes.id))
      .where(and(eq(menuItems.menuId, menu.id), eq(dishes.status, "nuevo")));
    if (pending.length)
      throw new MenuError(`No se puede publicar: hay platos nuevos sin aprobar (${[...new Set(pending.map((p) => p.name))].join(", ")}). Apruébalos en Platos.`, 409);
    const hard = (await refreshWarnings(date)).filter((v) => v.hard);
    if (hard.length && !patch.force)
      throw new MenuError(`No se puede publicar: ${hard.length === 1 ? "hay 1 regla" : `hay ${hard.length} reglas`} sin cumplir. Corrige el menú o publícalo igual.`, 409, formatWarnings(hard));
  }
  const set: Partial<typeof menus.$inferInsert> = {};
  if (patch.status) set.status = patch.status;
  if (patch.menuPrice != null) set.menuPrice = patch.menuPrice;
  if (Object.keys(set).length) await db.update(menus).set(set).where(eq(menus.id, menu.id));
  await touch(menu.id);
  return { menuId: menu.id };
}
