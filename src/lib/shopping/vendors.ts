import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSettings, saveSettings } from "@/lib/settings";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { UNASSIGNED_VENDOR } from "./units";

const { ingredients } = schema;

export interface VendorsView {
  vendors: string[];
  /** storeSection → number of ingredients, including old sections not in the list. */
  usage: Record<string, number>;
}

export async function getVendors(): Promise<string[]> {
  return (await getSettings()).vendors ?? DEFAULT_SETTINGS.vendors ?? [];
}

export async function getVendorsView(): Promise<VendorsView> {
  const [vendors, rows] = await Promise.all([
    getVendors(),
    db.select({ section: ingredients.storeSection, n: sql<number>`count(*)` }).from(ingredients).groupBy(ingredients.storeSection),
  ]);
  return { vendors, usage: Object.fromEntries(rows.map((r) => [r.section, Number(r.n)])) };
}

/**
 * Saves the vendor list (trimmed, deduplicated, in the given order) and moves ingredients between vendors:
 * each `{ from, to }` reassigns every ingredient bought from `from` (renaming a vendor, removing one, or
 * moving an old section like "pollería" to a vendor).
 */
export async function saveVendors(list: string[], moves: { from: string; to: string }[] = []): Promise<VendorsView> {
  const seen = new Set<string>();
  const vendors: string[] = [];
  for (const raw of list) {
    const v = raw.trim();
    const key = v.toLocaleLowerCase("es");
    if (!v || key === UNASSIGNED_VENDOR || seen.has(key)) continue;
    seen.add(key);
    vendors.push(v);
  }
  // two phases so chained renames (A→B while B→C) don't merge vendors
  const pending = moves.map((m) => ({ from: m.from, to: m.to.trim() || UNASSIGNED_VENDOR })).filter((m) => m.from !== m.to);
  for (const [i, m] of pending.entries()) await db.update(ingredients).set({ storeSection: `\u0000${i}` }).where(eq(ingredients.storeSection, m.from));
  for (const [i, m] of pending.entries()) await db.update(ingredients).set({ storeSection: m.to }).where(eq(ingredients.storeSection, `\u0000${i}`));
  await saveSettings({ vendors });
  return getVendorsView();
}
