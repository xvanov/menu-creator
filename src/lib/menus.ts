import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { weekdayOf, type MenuPayload } from "./types";

const { menus, menuItems, dishes } = schema;

/** Menu for a date with items joined to their dish, or `menu: null` if none exists yet. */
export async function getMenuPayload(date: string): Promise<MenuPayload> {
  const [menu] = await db.select().from(menus).where(eq(menus.date, date));
  if (!menu) return { date, weekday: weekdayOf(date), menu: null, items: [] };
  const rows = await db
    .select({ item: menuItems, dish: dishes })
    .from(menuItems)
    .leftJoin(dishes, eq(menuItems.dishId, dishes.id))
    .where(eq(menuItems.menuId, menu.id))
    .orderBy(asc(menuItems.position), asc(menuItems.id));
  return {
    date,
    weekday: weekdayOf(date),
    menu,
    items: rows.map(({ item, dish }) => ({
      ...item,
      dish: dish && { id: dish.id, name: dish.name, category: dish.category, tags: dish.tags, status: dish.status, course: dish.course },
    })),
  };
}

export async function getOrCreateMenu(date: string) {
  const [existing] = await db.select().from(menus).where(eq(menus.date, date));
  if (existing) return existing;
  const [created] = await db.insert(menus).values({ date, status: "borrador", source: "manual" }).returning();
  return created;
}

/** YYYY-MM-DD `days` days ago (UTC), for "recent menus" lists. */
export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Tomorrow in Lima time (the restaurant plans the evening before). */
export function tomorrow(): string {
  const lima = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Lima" }));
  lima.setDate(lima.getDate() + 1);
  if (lima.getDay() === 0) lima.setDate(lima.getDate() + 1); // closed on Sunday
  return lima.toLocaleDateString("en-CA");
}
