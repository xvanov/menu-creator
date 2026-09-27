import "server-only";
import { runLater } from "@/lib/background";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSettings } from "@/lib/settings";
import { weekdayOf, type Course, type Weekday } from "@/lib/types";
import { draftingDishIds, draftRecipes, withoutRecipe } from "@/lib/recipes";
import { findOrCreateIngredient, updateIngredient } from "@/lib/recipes/ingredients";
import { correctionRatio, learnPortions, learnRecipeItem } from "@/lib/recipes/learn";
import { findByName } from "@/lib/recipes/text";
import { mergeLines, planShopping, type Contribution, type PlanItem, type ShoppingPlan } from "./compute";
import { OTHER_SECTION } from "./units";

const { menus, menuItems, dishes, ingredients, recipeItems, shoppingLines, corrections } = schema;

type Line = typeof shoppingLines.$inferSelect;

export interface ShoppingLineView extends Line {
  section: string;
  contributions: Contribution[];
  /** The edited quantity was already confirmed (learned from). */
  confirmed: boolean;
}

export interface ShoppingMenuItem {
  id: number;
  dishId: number | null;
  name: string;
  course: Course;
  portions: number; // effective
  portionsSet: boolean; // set on the menu item (vs. default)
  defaultPortions: number;
  hasRecipe: boolean;
  drafting: boolean;
}

export interface ShoppingView {
  date: string;
  weekday: Weekday;
  menu: { id: number; status: "borrador" | "publicado" } | null;
  items: ShoppingMenuItem[];
  lines: ShoppingLineView[];
  missingRecipes: { menuItemId: number; dishId: number; name: string; drafting: boolean }[];
  unlinked: { menuItemId: number; name: string }[];
  drafting: boolean;
}

type Global = { __shoppingLocks?: Map<number, Promise<unknown>> };
const g = globalThis as Global;
const locks = (g.__shoppingLocks ??= new Map());

/** Serializes work per menu so two recomputes can't insert the same line twice. */
function withLock<T>(menuId: number, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(menuId) ?? Promise.resolve();
  const p = prev.then(fn, fn);
  locks.set(menuId, p);
  const clean = () => {
    if (locks.get(menuId) === p) locks.delete(menuId);
  };
  p.then(clean, clean);
  return p;
}

async function loadPlan(menuId: number) {
  const settings = await getSettings();
  const rows = await db
    .select({ item: menuItems, dish: dishes })
    .from(menuItems)
    .leftJoin(dishes, eq(menuItems.dishId, dishes.id))
    .where(eq(menuItems.menuId, menuId))
    .orderBy(asc(menuItems.position), asc(menuItems.id));
  const items = rows.map(({ item, dish }) => {
    const def = dish?.defaultPortions ?? (item.course === "extra" ? settings.extraPortions : settings.defaultPortions);
    return { item, dish, defaultPortions: def, portions: item.portions ?? def };
  });
  const dishIds = [...new Set(items.map((i) => i.item.dishId).filter((x): x is number => x != null))];
  const recipes = dishIds.length ? await db.select().from(recipeItems).where(inArray(recipeItems.dishId, dishIds)) : [];
  const allIngredients = await db.select().from(ingredients);
  const planItems: PlanItem[] = items.map((i) => ({ menuItemId: i.item.id, dishId: i.item.dishId, name: i.item.name, course: i.item.course, portions: i.portions }));
  const plan = planShopping({ items: planItems, recipes, ingredients: allIngredients, sideRice: settings.sideRice });
  return { settings, items, recipes, allIngredients, plan };
}

/** Recomputes a menu's shopping lines, keeping edited and manual lines. */
export function recompute(menuId: number): Promise<ShoppingPlan> {
  return withLock(menuId, async () => {
    const { plan, allIngredients } = await loadPlan(menuId);
    const existing = await db.select().from(shoppingLines).where(eq(shoppingLines.menuId, menuId));
    const stock = new Map(allIngredients.map((i) => [i.id, i.stockQty]));
    const ops = mergeLines(existing, plan.lines, stock);
    const stmts = [
      ...ops.updates.map((u) => db.update(shoppingLines).set(u.patch).where(eq(shoppingLines.id, u.id))),
      ...(ops.deletes.length ? [db.delete(shoppingLines).where(inArray(shoppingLines.id, ops.deletes))] : []),
      ...(ops.inserts.length ? [db.insert(shoppingLines).values(ops.inserts.map((l) => ({ ...l, menuId })))] : []),
    ];
    if (stmts.length) await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
    return plan;
  });
}


/**
 * CONTRACT (the menu engine calls it after any change to a menu's items).
 * Recomputes the list right away with the recipes that exist, then drafts missing recipes for the
 * menu's dishes in the background (LLM) and recomputes again. Never throws.
 */
export async function onMenuItemsChanged(menuId: number): Promise<void> {
  try {
    await recompute(menuId);
  } catch (e) {
    console.error("[shopping] recompute failed", e);
  }
  await runLater(async () => {
    const rows = await db.select({ dishId: menuItems.dishId }).from(menuItems).where(eq(menuItems.menuId, menuId));
    const missing = await withoutRecipe(rows.map((r) => r.dishId).filter((x): x is number => x != null));
    if (!missing.length) return;
    const outcome = await draftRecipes(missing);
    if (outcome.status !== "ok") console.warn("[shopping] recipe drafting:", outcome.status, outcome.message ?? "", outcome.failed.map((f) => f.name));
    await recompute(menuId);
  });
}

/** Drafts the recipes missing for a menu's dishes, then recomputes (awaits the LLM). */
export async function draftMissingForMenu(menuId: number) {
  const rows = await db.select({ dishId: menuItems.dishId }).from(menuItems).where(eq(menuItems.menuId, menuId));
  const missing = await withoutRecipe(rows.map((r) => r.dishId).filter((x): x is number => x != null));
  const outcome = missing.length ? await draftRecipes(missing) : null;
  await recompute(menuId);
  return outcome;
}

export async function getMenuByDate(date: string) {
  const [menu] = await db.select().from(menus).where(eq(menus.date, date));
  return menu ?? null;
}

export async function getShoppingView(date: string): Promise<ShoppingView> {
  const menu = await getMenuByDate(date);
  const base = { date, weekday: weekdayOf(date) };
  if (!menu) return { ...base, menu: null, items: [], lines: [], missingRecipes: [], unlinked: [], drafting: false };

  const { items, recipes, allIngredients, plan } = await loadPlan(menu.id);
  const lines = await db.select().from(shoppingLines).where(eq(shoppingLines.menuId, menu.id)).orderBy(asc(shoppingLines.position), asc(shoppingLines.id));
  const ingById = new Map(allIngredients.map((i) => [i.id, i]));
  const planById = new Map(plan.lines.map((p) => [p.ingredientId, p]));
  const confirmedRows = await db
    .select({ ingredientId: corrections.ingredientId, after: corrections.after })
    .from(corrections)
    .where(and(eq(corrections.menuId, menu.id), eq(corrections.kind, "shopping"), eq(corrections.note, "confirmado")));
  const confirmed = new Set(confirmedRows.map((c) => `${c.ingredientId}:${c.after}`));
  const drafting = new Set(draftingDishIds());
  const withRecipe = new Set(recipes.map((r) => r.dishId));

  return {
    ...base,
    menu: { id: menu.id, status: menu.status },
    items: items.map((i) => ({
      id: i.item.id,
      dishId: i.item.dishId,
      name: i.item.name,
      course: i.item.course,
      portions: i.portions,
      portionsSet: i.item.portions != null,
      defaultPortions: i.defaultPortions,
      hasRecipe: i.item.dishId != null && withRecipe.has(i.item.dishId),
      drafting: i.item.dishId != null && drafting.has(i.item.dishId),
    })),
    lines: lines.map((l) => ({
      ...l,
      section: (l.ingredientId != null && ingById.get(l.ingredientId)?.storeSection) || OTHER_SECTION,
      contributions: (l.ingredientId != null && planById.get(l.ingredientId)?.contributions) || [],
      confirmed: l.edited && confirmed.has(`${l.ingredientId}:${l.quantity}`),
    })),
    missingRecipes: plan.missingRecipes.map((m) => ({ menuItemId: m.menuItemId, dishId: m.dishId!, name: m.name, drafting: drafting.has(m.dishId!) })),
    unlinked: plan.unlinked.map((u) => ({ menuItemId: u.menuItemId, name: u.name })),
    drafting: plan.missingRecipes.some((m) => drafting.has(m.dishId!)),
  };
}

export class ShoppingError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

async function requireMenu(date: string) {
  const menu = await getMenuByDate(date);
  if (!menu) throw new ShoppingError("No hay menú para esta fecha", 404);
  return menu;
}

export async function recomputeDate(date: string) {
  const menu = await requireMenu(date);
  await recompute(menu.id);
  return getShoppingView(date);
}

export interface AddLineInput {
  ingredientId?: number | null;
  name: string;
  unit?: string;
  quantity: number;
  note?: string | null;
  storeSection?: string;
  saveIngredient?: boolean; // create an ingredient for unknown names (default true)
}

export async function addLine(date: string, input: AddLineInput) {
  const menu = await requireMenu(date);
  const known = await db.select().from(ingredients);
  let ing = input.ingredientId ? known.find((k) => k.id === input.ingredientId) : findByName(known, input.name);
  if (!ing && input.saveIngredient !== false) ing = await findOrCreateIngredient(input.name, input.unit ?? "kg", input.storeSection, known);
  const quantity = Math.max(0, input.quantity);

  const existing = await db.select().from(shoppingLines).where(eq(shoppingLines.menuId, menu.id));
  const same = ing ? existing.find((l) => l.ingredientId === ing.id) : undefined;
  if (same) {
    await patchLine(date, same.id, { quantity, ...(input.note ? { note: input.note } : {}) });
    return getShoppingView(date);
  }
  await db.insert(shoppingLines).values({
    menuId: menu.id,
    ingredientId: ing?.id ?? null,
    name: ing?.name ?? input.name.trim(),
    unit: ing?.unit ?? input.unit ?? "kg",
    needed: 0,
    inStock: ing?.stockQty ?? 0,
    quantity,
    suggested: 0,
    edited: false,
    source: "manual",
    note: input.note ?? null,
    position: existing.length,
  });
  await db.insert(corrections).values({ kind: "shopping", menuId: menu.id, ingredientId: ing?.id ?? null, before: 0, after: quantity, note: "línea agregada" });
  await recompute(menu.id);
  return getShoppingView(date);
}

export interface LinePatchInput {
  quantity?: number;
  note?: string | null;
  checked?: boolean;
  inStock?: number; // updates the ingredient's storage
  name?: string;
  unit?: string;
}

export async function patchLine(date: string, id: number, patch: LinePatchInput) {
  const menu = await requireMenu(date);
  const [line] = await db.select().from(shoppingLines).where(and(eq(shoppingLines.id, id), eq(shoppingLines.menuId, menu.id)));
  if (!line) throw new ShoppingError("Línea no encontrada", 404);
  const set: Partial<Line> = {};
  if (patch.quantity !== undefined) {
    const q = Math.max(0, patch.quantity);
    set.quantity = q;
    set.edited = line.source !== "manual" && Math.abs(q - line.suggested) > 1e-9;
    if (q !== line.quantity)
      await db.insert(corrections).values({ kind: "shopping", menuId: menu.id, ingredientId: line.ingredientId, before: line.quantity, after: q, note: "editado" });
  }
  if (patch.note !== undefined) set.note = patch.note;
  if (patch.checked !== undefined) set.checked = patch.checked;
  if (line.ingredientId == null) {
    if (patch.name) set.name = patch.name.trim();
    if (patch.unit) set.unit = patch.unit;
  }
  if (Object.keys(set).length) await db.update(shoppingLines).set(set).where(eq(shoppingLines.id, id));
  if (patch.inStock !== undefined) {
    if (line.ingredientId != null) {
      await updateIngredient(line.ingredientId, { stockQty: patch.inStock });
      await recompute(menu.id);
    } else await db.update(shoppingLines).set({ inStock: Math.max(0, patch.inStock) }).where(eq(shoppingLines.id, id));
  }
  return getShoppingView(date);
}

export async function deleteLine(date: string, id: number) {
  const menu = await requireMenu(date);
  const [line] = await db.select().from(shoppingLines).where(and(eq(shoppingLines.id, id), eq(shoppingLines.menuId, menu.id)));
  if (!line) throw new ShoppingError("Línea no encontrada", 404);
  await db.delete(shoppingLines).where(eq(shoppingLines.id, id));
  await db.insert(corrections).values({ kind: "shopping", menuId: menu.id, ingredientId: line.ingredientId, before: line.quantity, after: 0, note: "línea quitada" });
  return getShoppingView(date);
}

export interface ConfirmSummary {
  learned: { ingredient: string; ratio: number; dishes: string[] }[];
  portions: { dish: string; before: number; after: number }[];
}

/**
 * "Confirmar cantidades": each edited line teaches the recipes of this menu's dishes (EMA), and
 * portions set on the menu move each dish's default portions. Confirming twice doesn't learn twice.
 */
export async function confirm(date: string): Promise<{ view: ShoppingView; summary: ConfirmSummary }> {
  const menu = await requireMenu(date);
  const summary: ConfirmSummary = { learned: [], portions: [] };
  const { settings, items, plan } = await loadPlan(menu.id);
  const alpha = settings.learningAlpha ?? 0.3;
  const lines = await db.select().from(shoppingLines).where(eq(shoppingLines.menuId, menu.id));
  const done = await db
    .select({ ingredientId: corrections.ingredientId, dishId: corrections.dishId, kind: corrections.kind, after: corrections.after })
    .from(corrections)
    .where(and(eq(corrections.menuId, menu.id), eq(corrections.note, "confirmado")));
  const planById = new Map(plan.lines.map((p) => [p.ingredientId, p]));

  for (const line of lines) {
    if (!line.edited || line.ingredientId == null) continue;
    if (done.some((d) => d.kind === "shopping" && d.ingredientId === line.ingredientId && d.after === line.quantity)) continue;
    const p = planById.get(line.ingredientId);
    if (!p) continue;
    const ratio = correctionRatio({ quantity: line.quantity, inStock: p.inStock, needed: p.needed, ruleNeeded: p.ruleNeeded });
    const learnedDishes: string[] = [];
    if (ratio != null) {
      for (const c of p.contributions) {
        if (c.kind !== "receta" || c.dishId == null) continue;
        const [ri] = await db.select().from(recipeItems).where(and(eq(recipeItems.dishId, c.dishId), eq(recipeItems.ingredientId, line.ingredientId)));
        if (!ri) continue;
        const next = learnRecipeItem(ri, ratio, alpha);
        await db.update(recipeItems).set(next).where(eq(recipeItems.id, ri.id));
        await db.insert(corrections).values({ kind: "recipe", dishId: c.dishId, ingredientId: line.ingredientId, menuId: menu.id, before: ri.qtyPerPortion, after: next.qtyPerPortion, note: `aprendido de la lista (×${ratio.toFixed(2)})` });
        learnedDishes.push(c.label);
      }
      summary.learned.push({ ingredient: line.name, ratio, dishes: learnedDishes });
    }
    await db.insert(corrections).values({ kind: "shopping", menuId: menu.id, ingredientId: line.ingredientId, before: line.suggested, after: line.quantity, note: "confirmado" });
  }

  for (const i of items) {
    if (i.item.portions == null || !i.dish || i.item.portions === i.defaultPortions) continue;
    if (done.some((d) => d.kind === "portions" && d.dishId === i.dish!.id && d.after === i.item.portions)) continue;
    const next = learnPortions(i.defaultPortions, i.item.portions, alpha);
    await db.update(dishes).set({ defaultPortions: next }).where(eq(dishes.id, i.dish.id));
    await db.insert(corrections).values({ kind: "portions", dishId: i.dish.id, menuId: menu.id, before: i.defaultPortions, after: i.item.portions, note: "confirmado" });
    summary.portions.push({ dish: i.dish.name, before: i.defaultPortions, after: next });
  }

  await recompute(menu.id);
  return { view: await getShoppingView(date), summary };
}
