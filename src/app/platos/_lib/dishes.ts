import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Course } from "@/lib/types";

const { dishes, menuItems, menus, recipeItems, ingredients } = schema;

export type Dish = typeof dishes.$inferSelect;
export type DishStatus = Dish["status"];
export type DishWithStats = Dish & { timesServed: number; lastServed: string | null };

/** Lowercase, no accents, collapsed spaces — for accent/case-insensitive search. */
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

async function servedStats() {
  const rows = await db
    .select({ dishId: menuItems.dishId, n: sql<number>`count(*)`, last: sql<string | null>`max(${menus.date})` })
    .from(menuItems)
    .innerJoin(menus, eq(menuItems.menuId, menus.id))
    .groupBy(menuItems.dishId);
  return new Map(rows.filter((r) => r.dishId != null).map((r) => [r.dishId as number, { timesServed: Number(r.n), lastServed: r.last }]));
}

export interface DishQuery {
  q?: string;
  course?: Course;
  status?: DishStatus | "all";
  limit?: number;
}

/**
 * Catalog search. Without `status`, archived dishes are left out. With `q`, prefix/word matches rank
 * first, then by times served.
 */
export async function listDishes({ q, course, status, limit }: DishQuery = {}): Promise<DishWithStats[]> {
  const [rows, stats] = await Promise.all([db.select().from(dishes), servedStats()]);
  const nq = q ? normalize(q) : "";
  const scored = rows
    .filter((d) => (course ? d.course === course : true))
    .filter((d) => (status === "all" ? true : status ? d.status === status : d.status !== "archivado"))
    .map((d) => {
      const s = stats.get(d.id);
      const name = normalize(d.name);
      const rank = !nq ? 0 : name.startsWith(nq) ? 0 : name.includes(` ${nq}`) ? 1 : name.includes(nq) ? 2 : -1;
      return { dish: { ...d, timesServed: s?.timesServed ?? 0, lastServed: s?.lastServed ?? null }, rank };
    })
    .filter((d) => d.rank >= 0)
    .sort((a, b) => (nq ? a.rank - b.rank || b.dish.timesServed - a.dish.timesServed : 0) || a.dish.name.localeCompare(b.dish.name, "es"))
    .map((d) => d.dish);
  return limit ? scored.slice(0, limit) : scored;
}

export async function getDish(id: number) {
  const [d] = await db.select().from(dishes).where(eq(dishes.id, id));
  return d ?? null;
}

/** Cost per portion from the recipe: Σ qtyPerPortion × pricePerUnit. `missingPrices` = ingredients without a price. */
export async function recipeCost(dishId: number) {
  const rows = await db
    .select({ qty: recipeItems.qtyPerPortion, price: ingredients.pricePerUnit })
    .from(recipeItems)
    .innerJoin(ingredients, eq(recipeItems.ingredientId, ingredients.id))
    .where(eq(recipeItems.dishId, dishId));
  let cost = 0;
  let missingPrices = 0;
  for (const r of rows) {
    if (r.price == null) missingPrices++;
    else cost += r.qty * r.price;
  }
  return { cost: rows.length ? cost : null, ingredients: rows.length, missingPrices };
}

export async function servedDates(dishId: number, limit = 12) {
  const rows = await db
    .select({ date: menus.date })
    .from(menuItems)
    .innerJoin(menus, eq(menuItems.menuId, menus.id))
    .where(eq(menuItems.dishId, dishId))
    .orderBy(desc(menus.date));
  return { times: rows.length, dates: rows.slice(0, limit).map((r) => r.date) };
}

/** Deletes the dish, or archives it when menus already use it (keeps history intact). */
export async function removeDish(id: number): Promise<"archivado" | "eliminado"> {
  const [used] = await db.select({ id: menuItems.id }).from(menuItems).where(eq(menuItems.dishId, id)).limit(1);
  if (used) {
    await db.update(dishes).set({ status: "archivado" }).where(eq(dishes.id, id));
    return "archivado";
  }
  await db.delete(recipeItems).where(eq(recipeItems.dishId, id));
  await db.delete(dishes).where(eq(dishes.id, id));
  return "eliminado";
}

export async function distinctCategories(): Promise<string[]> {
  const rows = await db.selectDistinct({ c: dishes.category }).from(dishes);
  return rows.map((r) => r.c).sort((a, b) => a.localeCompare(b, "es"));
}
