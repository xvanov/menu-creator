import "server-only";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getLlm } from "@/lib/llm";
import { STORE_SECTIONS } from "@/lib/shopping/units";
import { buildStockPrompt, STOCK_SYSTEM, stockParseSchema } from "./prompt";
import { capitalize, findByName, norm } from "./text";

const { ingredients, recipeItems, shoppingLines, corrections } = schema;

export type Ingredient = typeof ingredients.$inferSelect;
export interface IngredientView extends Ingredient {
  recipes: number; // number of dishes using it
}

const nowIso = () => new Date().toISOString();

export async function listIngredients(): Promise<IngredientView[]> {
  const rows = await db.select().from(ingredients).orderBy(asc(ingredients.name));
  const uses = await db
    .select({ ingredientId: recipeItems.ingredientId, n: sql<number>`count(*)` })
    .from(recipeItems)
    .groupBy(recipeItems.ingredientId);
  const byId = new Map(uses.map((u) => [u.ingredientId, Number(u.n)]));
  return rows.map((r) => ({ ...r, recipes: byId.get(r.id) ?? 0 }));
}

export function guessSection(name: string): string {
  const n = norm(name);
  if (/pollo|presa|molleja|gallina|huevo/.test(n)) return "pollería";
  if (/\bres\b|carne|churrasco|chuleta|bistec|lomo|chancho|cerdo|higado|mondongo|pata|asado|panceta|costilla/.test(n)) return "carnicería";
  if (/pescado|trucha|bonito|choro|atun|merluza|jurel|langostino|calamar|pota/.test(n)) return "pescadería";
  if (/arroz|aceite|azucar|\bsal\b|fideo|tallar|harina|leche|galleta|sillao|vinagre|pomarola|ajinomoto|lenteja|frijol|pallar|garbanzo|partida|quinua|trigo|mani|mostaza|pimienta|comino|oregano|laurel|pasas|chuño|mayonesa|lata|conserva|cubito|caldo|pasta|avena|cafe|te\b/.test(n))
    return "abarrotes";
  return "mercado";
}

/** Finds an ingredient by (normalized) name or creates it. */
export async function findOrCreateIngredient(name: string, unit = "kg", storeSection?: string, known?: Ingredient[]): Promise<Ingredient> {
  const list = known ?? (await db.select().from(ingredients));
  const hit = findByName(list, name);
  if (hit) return hit;
  const clean = capitalize(name);
  const section = storeSection && (STORE_SECTIONS as readonly string[]).includes(storeSection) ? storeSection : guessSection(clean);
  await db.insert(ingredients).values({ name: clean, unit, storeSection: section }).onConflictDoNothing();
  const [row] = await db.select().from(ingredients).where(eq(ingredients.name, clean));
  known?.push(row);
  return row;
}

export interface IngredientPatch {
  name?: string;
  unit?: string;
  storeSection?: string;
  pricePerUnit?: number | null;
  stockQty?: number;
  alwaysCheckStock?: boolean;
}

export async function updateIngredient(id: number, patch: IngredientPatch): Promise<Ingredient | null> {
  const [before] = await db.select().from(ingredients).where(eq(ingredients.id, id));
  if (!before) return null;
  const set: Partial<Ingredient> = { ...patch };
  if (patch.name) set.name = capitalize(patch.name);
  if (patch.stockQty !== undefined) {
    set.stockQty = Math.max(0, patch.stockQty);
    set.stockUpdatedAt = nowIso();
    if (set.stockQty !== before.stockQty)
      await db.insert(corrections).values({ kind: "stock", ingredientId: id, before: before.stockQty, after: set.stockQty });
  }
  if (patch.pricePerUnit !== undefined && patch.pricePerUnit !== before.pricePerUnit)
    await db.insert(corrections).values({ kind: "cost", ingredientId: id, before: before.pricePerUnit, after: patch.pricePerUnit });
  const [row] = await db.update(ingredients).set(set).where(eq(ingredients.id, id)).returning();
  if (patch.name || patch.unit) {
    // keep open shopping lines in sync with the ingredient's display name/unit
    await db.update(shoppingLines).set({ name: row.name, unit: row.unit }).where(eq(shoppingLines.ingredientId, id));
  }
  return row;
}

export async function createIngredient(input: IngredientPatch & { name: string }): Promise<Ingredient> {
  const existing = findByName(await db.select().from(ingredients), input.name);
  if (existing) throw new Error(`Ya existe "${existing.name}"`);
  const [row] = await db
    .insert(ingredients)
    .values({
      name: capitalize(input.name),
      unit: input.unit ?? "kg",
      storeSection: input.storeSection ?? guessSection(input.name),
      pricePerUnit: input.pricePerUnit ?? null,
      stockQty: Math.max(0, input.stockQty ?? 0),
      stockUpdatedAt: input.stockQty ? nowIso() : null,
      alwaysCheckStock: input.alwaysCheckStock ?? false,
    })
    .returning();
  return row;
}

/** Deletes an ingredient. If recipes use it, refuses unless `force` (then removes it from those recipes). */
export async function deleteIngredient(id: number, force = false): Promise<{ ok: boolean; recipes: number }> {
  const used = await db.select({ id: recipeItems.id }).from(recipeItems).where(eq(recipeItems.ingredientId, id));
  if (used.length && !force) return { ok: false, recipes: used.length };
  if (used.length) await db.delete(recipeItems).where(eq(recipeItems.ingredientId, id));
  await db.update(shoppingLines).set({ ingredientId: null }).where(eq(shoppingLines.ingredientId, id));
  await db.delete(ingredients).where(eq(ingredients.id, id));
  return { ok: true, recipes: used.length };
}

export interface StockItem {
  ingredientId?: number | null;
  name: string;
  unit?: string;
  storeSection?: string;
  qty: number;
}

/** Sets storage quantities (creating unknown ingredients). */
export async function applyStock(items: StockItem[]): Promise<{ updated: number; created: string[] }> {
  const known = await db.select().from(ingredients);
  const created: string[] = [];
  let updated = 0;
  for (const it of items) {
    let ing = it.ingredientId ? known.find((k) => k.id === it.ingredientId) : findByName(known, it.name);
    if (!ing) {
      ing = await findOrCreateIngredient(it.name, it.unit ?? "kg", it.storeSection, known);
      created.push(ing.name);
    }
    await updateIngredient(ing.id, { stockQty: it.qty });
    updated++;
  }
  return { updated, created };
}

/** "Poner todo en 0". */
export async function resetAllStock(): Promise<number> {
  const withStock = await db.select({ id: ingredients.id, stockQty: ingredients.stockQty }).from(ingredients).where(sql`${ingredients.stockQty} > 0`);
  if (withStock.length) {
    await db.insert(corrections).values(withStock.map((r) => ({ kind: "stock" as const, ingredientId: r.id, before: r.stockQty, after: 0, note: "todo en 0" })));
    await db.update(ingredients).set({ stockQty: 0, stockUpdatedAt: nowIso() }).where(inArray(ingredients.id, withStock.map((r) => r.id)));
  }
  return withStock.length;
}

export interface ParsedStockItem {
  name: string;
  qty: number | null;
  unit: string;
  storeSection: string;
  note: string | null;
  ingredientId: number | null; // matched existing ingredient (null = would be created)
  currentStock: number | null;
}

/** Free text "Hay 7 kilos de arroz…" → items (LLM, fast tier). Never throws. */
export async function parseStockText(text: string): Promise<{ ok: true; items: ParsedStockItem[] } | { ok: false; error: string }> {
  const known = await db.select().from(ingredients);
  try {
    const res = await getLlm().complete({ system: STOCK_SYSTEM, prompt: buildStockPrompt(text, known), schema: stockParseSchema, tier: "fast" });
    return {
      ok: true,
      items: res.items.map((i) => {
        const hit = findByName(known, i.name);
        return {
          name: hit?.name ?? capitalize(i.name),
          qty: i.qty,
          unit: hit?.unit ?? i.unit,
          storeSection: hit?.storeSection ?? i.storeSection,
          note: i.note,
          ingredientId: hit?.id ?? null,
          currentStock: hit?.stockQty ?? null,
        };
      }),
    };
  } catch (e) {
    return { ok: false, error: `No se pudo leer el mensaje con IA: ${(e as Error).message}`.slice(0, 300) };
  }
}
