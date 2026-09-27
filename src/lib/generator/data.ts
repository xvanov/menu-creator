/**
 * DB loaders for the menu engine. Deliberately free of "server-only" so tsx scripts can reuse
 * them; only server code (API routes, service.ts) should import this in the app.
 */
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { RuleDef } from "@/lib/rules/validate";
import type { CatalogDish, HistoryMenu, PlannedItem } from "./core";

const { dishes, menus, menuItems, rules } = schema;

export async function loadDishes(): Promise<CatalogDish[]> {
  const rows = await db.select().from(dishes);
  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    course: d.course,
    category: d.category,
    tags: d.tags ?? [],
    protein: d.protein,
    base: d.base,
    status: d.status,
    price: d.price,
    defaultPortions: d.defaultPortions,
    createdAt: d.createdAt,
  }));
}

export async function loadRules(): Promise<RuleDef[]> {
  const rows = await db.select().from(rules).orderBy(asc(rules.id));
  return rows.map((r) => ({ id: r.id, name: r.name, params: r.params, hard: r.hard, enabled: r.enabled }));
}

/** Every saved menu (history, drafts, published) with its items, oldest first. */
export async function loadHistory(): Promise<HistoryMenu[]> {
  const rows = await db
    .select({ date: menus.date, dishId: menuItems.dishId, name: menuItems.name, course: menuItems.course })
    .from(menuItems)
    .innerJoin(menus, eq(menuItems.menuId, menus.id))
    .orderBy(asc(menus.date), asc(menuItems.position), asc(menuItems.id));
  const byDate = new Map<string, HistoryMenu>();
  for (const r of rows) {
    const m = byDate.get(r.date) ?? { date: r.date, items: [] };
    m.items.push({ dishId: r.dishId, name: r.name, course: r.course });
    byDate.set(r.date, m);
  }
  return [...byDate.values()];
}

export async function loadMenuItems(menuId: number): Promise<(PlannedItem & { position: number; portions: number | null })[]> {
  const rows = await db.select().from(menuItems).where(eq(menuItems.menuId, menuId)).orderBy(asc(menuItems.position), asc(menuItems.id));
  return rows.map((r) => ({
    key: `i${r.id}`,
    existingId: r.id,
    dishId: r.dishId,
    name: r.name,
    course: r.course,
    price: r.price,
    pinned: r.pinned,
    reason: r.reason,
    position: r.position,
    portions: r.portions,
  }));
}
