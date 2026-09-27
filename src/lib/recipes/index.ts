import "server-only";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { inlineBackground } from "@/lib/background";
import { getLlm, LlmUnavailableError } from "@/lib/llm";
import { getSettings } from "@/lib/settings";
import { convert } from "@/lib/shopping/units";
import { findOrCreateIngredient, type Ingredient } from "./ingredients";
import { buildDraftPrompt, DRAFT_SYSTEM, draftSchema, type DraftDish, type ExampleRecipe } from "./prompt";
import { capitalize, findByName, norm } from "./text";

const { dishes, ingredients, recipeItems, corrections, shoppingNotes, menuItems } = schema;

export const BATCH_SIZE = 6;
export const CONCURRENCY = 2;

export interface RecipeItemView {
  id: number;
  ingredientId: number;
  name: string;
  unit: string;
  storeSection: string;
  pricePerUnit: number | null;
  qtyPerPortion: number;
  fixedQty: number;
  source: "ai" | "manual" | "learned";
  corrections: number;
}

export interface RecipeView {
  dish: { id: number; name: string; course: string; category: string; defaultPortions: number | null; costPerPortion: number | null };
  portions: number; // effective default portions for this dish
  items: RecipeItemView[];
  drafting: boolean;
}

// ---------------------------------------------------------------- read / write

export async function getRecipeItems(dishIds: number[]) {
  if (!dishIds.length) return [];
  return db
    .select({
      id: recipeItems.id,
      dishId: recipeItems.dishId,
      ingredientId: recipeItems.ingredientId,
      name: ingredients.name,
      unit: ingredients.unit,
      storeSection: ingredients.storeSection,
      pricePerUnit: ingredients.pricePerUnit,
      qtyPerPortion: recipeItems.qtyPerPortion,
      fixedQty: recipeItems.fixedQty,
      source: recipeItems.source,
      corrections: recipeItems.corrections,
    })
    .from(recipeItems)
    .innerJoin(ingredients, eq(recipeItems.ingredientId, ingredients.id))
    .where(inArray(recipeItems.dishId, dishIds))
    .orderBy(ingredients.storeSection, ingredients.name);
}

export async function getRecipe(dishId: number): Promise<RecipeView | null> {
  const [dish] = await db.select().from(dishes).where(eq(dishes.id, dishId));
  if (!dish) return null;
  const settings = await getSettings();
  const items = await getRecipeItems([dishId]);
  return {
    dish: { id: dish.id, name: dish.name, course: dish.course, category: dish.category, defaultPortions: dish.defaultPortions, costPerPortion: dish.costPerPortion },
    portions: dish.defaultPortions ?? (dish.course === "extra" ? settings.extraPortions : settings.defaultPortions),
    items: items.map(({ dishId: _d, ...i }) => (void _d, i)),
    drafting: draftingDishIds().includes(dishId),
  };
}

export interface RecipeInputItem {
  ingredientId?: number | null;
  name: string;
  unit?: string;
  storeSection?: string;
  qtyPerPortion: number;
  fixedQty: number;
}

/**
 * Replaces a dish's recipe with what the editor sent. Items whose quantities changed (or are new)
 * become `manual`; unchanged ones keep their source. Every change is logged in `corrections`.
 */
export async function saveRecipe(dishId: number, input: RecipeInputItem[]): Promise<RecipeView | null> {
  const [dish] = await db.select({ id: dishes.id }).from(dishes).where(eq(dishes.id, dishId));
  if (!dish) return null;
  const known = await db.select().from(ingredients);
  const current = await db.select().from(recipeItems).where(eq(recipeItems.dishId, dishId));
  const byIng = new Map(current.map((c) => [c.ingredientId, c]));

  const next = new Map<number, { qtyPerPortion: number; fixedQty: number }>();
  for (const it of input) {
    if (!it.name.trim() && !it.ingredientId) continue;
    let ing: Ingredient | undefined = it.ingredientId ? known.find((k) => k.id === it.ingredientId) : undefined;
    ing ??= await findOrCreateIngredient(it.name, it.unit ?? "kg", it.storeSection, known);
    const prev = next.get(ing.id);
    next.set(ing.id, {
      qtyPerPortion: Math.max(0, it.qtyPerPortion) + (prev?.qtyPerPortion ?? 0),
      fixedQty: Math.max(0, it.fixedQty) + (prev?.fixedQty ?? 0),
    });
  }

  const log: (typeof corrections.$inferInsert)[] = [];
  for (const [ingredientId, q] of next) {
    const old = byIng.get(ingredientId);
    if (!old) {
      await db.insert(recipeItems).values({ dishId, ingredientId, ...q, source: "manual" });
      log.push({ kind: "recipe", dishId, ingredientId, before: null, after: q.qtyPerPortion, note: "ingrediente agregado" });
    } else if (old.qtyPerPortion !== q.qtyPerPortion || old.fixedQty !== q.fixedQty) {
      await db.update(recipeItems).set({ ...q, source: "manual" }).where(eq(recipeItems.id, old.id));
      log.push({
        kind: "recipe",
        dishId,
        ingredientId,
        before: old.qtyPerPortion,
        after: q.qtyPerPortion,
        note: old.fixedQty !== q.fixedQty ? `fijo ${old.fixedQty} → ${q.fixedQty}` : null,
      });
    }
  }
  const removed = current.filter((c) => !next.has(c.ingredientId));
  if (removed.length) {
    await db.delete(recipeItems).where(inArray(recipeItems.id, removed.map((r) => r.id)));
    for (const r of removed) log.push({ kind: "recipe", dishId, ingredientId: r.ingredientId, before: r.qtyPerPortion, after: 0, note: "ingrediente quitado" });
  }
  if (log.length) await db.insert(corrections).values(log);
  return getRecipe(dishId);
}

// ---------------------------------------------------------------- LLM drafting

export type DraftStatus = "ok" | "partial" | "unavailable" | "error";
export interface DraftOutcome {
  status: DraftStatus;
  drafted: { dishId: number; name: string; items: number }[];
  failed: { dishId: number; name: string; error: string }[];
  message?: string;
}

type Global = { __recipeDrafting?: Map<number, Promise<void>>; __draftJob?: DraftJob };
const g = globalThis as Global;
const inFlight = (g.__recipeDrafting ??= new Map());

/** Dish ids whose recipe is being drafted right now (for "generando recetas…" in the UI). */
export function draftingDishIds(): number[] {
  return [...inFlight.keys()];
}

async function gatherKnowledge(requested: DraftDish[], categories: string[]) {
  const notes = await db.select().from(shoppingNotes);
  const kitchenRules = notes
    .filter((n) => n.type === "regla" && n.rule && !/cena/i.test(`${n.dish ?? ""} ${n.rule}`))
    .map((n) => n.rule as string);

  const noBuy = new Map<string, number>();
  for (const n of notes.filter((n) => n.type === "no_comprar"))
    for (const it of (n.items as { ingredient?: string }[]) ?? []) if (it.ingredient) noBuy.set(it.ingredient, (noBuy.get(it.ingredient) ?? 0) + 1);
  const overstocked = [...noBuy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, c]) => `${n} (${c} veces "no traer")`);

  const dishNotes = new Map<string, string[]>();
  for (const d of requested) {
    const key = norm(d.name);
    const hits = notes
      .filter((n) => n.dish && (norm(n.dish) === key || key.startsWith(norm(n.dish))) && n.type !== "inventario")
      .slice(-4)
      .map((n) => (n.rule ?? n.raw).replace(/\s+/g, " ").slice(0, 160));
    if (hits.length) dishNotes.set(d.name, hits);
  }

  // corrected recipes as examples: same category first, then most recently corrected
  const correctedDishIds = await db
    .selectDistinct({ dishId: recipeItems.dishId })
    .from(recipeItems)
    .where(ne(recipeItems.source, "ai"));
  const ids = correctedDishIds.map((d) => d.dishId);
  let examples: ExampleRecipe[] = [];
  if (ids.length) {
    const exDishes = await db.select({ id: dishes.id, name: dishes.name, category: dishes.category }).from(dishes).where(inArray(dishes.id, ids));
    const lastCorr = await db
      .select({ dishId: corrections.dishId, last: sql<number>`max(${corrections.id})` })
      .from(corrections)
      .where(inArray(corrections.dishId, ids))
      .groupBy(corrections.dishId);
    const recency = new Map(lastCorr.map((c) => [c.dishId, Number(c.last)]));
    const requestedNames = new Set(requested.map((d) => norm(d.name)));
    const picked = exDishes
      .filter((d) => !requestedNames.has(norm(d.name)))
      .sort((a, b) => Number(categories.includes(b.category)) - Number(categories.includes(a.category)) || (recency.get(b.id) ?? 0) - (recency.get(a.id) ?? 0))
      .slice(0, 5);
    const items = await getRecipeItems(picked.map((p) => p.id));
    examples = picked.map((p) => ({
      dish: p.name,
      items: items.filter((i) => i.dishId === p.id).map((i) => ({ name: i.name, unit: i.unit, qtyPerPortion: i.qtyPerPortion, fixedQty: i.fixedQty, source: i.source })),
    }));
  }

  const recent = await db
    .select({ c: corrections, ing: ingredients.name, unit: ingredients.unit, dish: dishes.name })
    .from(corrections)
    .leftJoin(ingredients, eq(corrections.ingredientId, ingredients.id))
    .leftJoin(dishes, eq(corrections.dishId, dishes.id))
    .where(inArray(corrections.kind, ["recipe", "shopping"]))
    .orderBy(desc(corrections.id))
    .limit(12);
  const recentCorrections = recent
    .filter((r) => r.ing)
    .map(({ c, ing, unit, dish }) =>
      c.kind === "recipe"
        ? `${ing} en ${dish ?? "?"}: ${c.before ?? 0} → ${c.after ?? 0} ${unit}/porción${c.note ? ` (${c.note})` : ""}`
        : `Lista de compras, ${ing}: ${c.before ?? 0} → ${c.after ?? 0} ${unit}${c.note ? ` (${c.note})` : ""}`,
    );

  return { kitchenRules, overstocked, dishNotes, examples, recentCorrections };
}

/** One LLM call for up to BATCH_SIZE dishes; writes their recipes. Never throws. */
async function draftBatch(batch: (typeof dishes.$inferSelect)[], overwrite: boolean): Promise<DraftOutcome> {
  const outcome: DraftOutcome = { status: "ok", drafted: [], failed: [] };
  try {
    const known = await db.select().from(ingredients);
    const requested: DraftDish[] = batch.map((d) => ({ name: d.name, course: d.course, category: d.category, base: d.base, protein: d.protein, tags: d.tags }));
    const k = await gatherKnowledge(requested, [...new Set(batch.map((d) => d.category))]);
    for (const d of requested) d.notes = k.dishNotes.get(d.name);
    const prompt = buildDraftPrompt({
      dishes: requested,
      ingredients: known.map((i) => ({ name: i.name, unit: i.unit, storeSection: i.storeSection })),
      kitchenRules: k.kitchenRules,
      overstocked: k.overstocked,
      examples: k.examples,
      recentCorrections: k.recentCorrections,
    });
    const res = await getLlm().complete({ system: DRAFT_SYSTEM, prompt, schema: draftSchema, tier: "smart" });

    for (const [idx, dish] of batch.entries()) {
      const r = res.recipes.find((x) => norm(x.dish) === norm(dish.name)) ?? (res.recipes.length === batch.length ? res.recipes[idx] : undefined);
      if (!r || !r.ingredients.length) {
        outcome.failed.push({ dishId: dish.id, name: dish.name, error: "La IA no devolvió receta" });
        continue;
      }
      const items = new Map<number, { qtyPerPortion: number; fixedQty: number }>();
      for (const it of r.ingredients) {
        if (!it.name.trim()) continue;
        const existing = findByName(known, it.name);
        const ing = existing ?? (await findOrCreateIngredient(capitalize(it.name), it.unit, it.storeSection, known));
        const conv = (q: number) => {
          const v = Math.max(0, Number.isFinite(q) ? q : 0);
          return existing && existing.unit !== it.unit ? (convert(v, it.unit, existing.unit) ?? v) : v;
        };
        const prev = items.get(ing.id);
        items.set(ing.id, {
          qtyPerPortion: Math.round((conv(it.qtyPerPortion) + (prev?.qtyPerPortion ?? 0)) * 10000) / 10000,
          fixedQty: Math.round((conv(it.fixedQty) + (prev?.fixedQty ?? 0)) * 10000) / 10000,
        });
      }
      await writeDraft(dish.id, items, overwrite);
      outcome.drafted.push({ dishId: dish.id, name: dish.name, items: items.size });
    }
  } catch (e) {
    const unavailable = e instanceof LlmUnavailableError;
    outcome.status = unavailable ? "unavailable" : "error";
    outcome.message = (e as Error).message.slice(0, 300);
    for (const d of batch) if (!outcome.drafted.some((x) => x.dishId === d.id)) outcome.failed.push({ dishId: d.id, name: d.name, error: outcome.message });
    return outcome;
  }
  if (outcome.failed.length) outcome.status = outcome.drafted.length ? "partial" : "error";
  return outcome;
}

/** Writes AI items; keeps manual/learned items unless `overwrite`. */
async function writeDraft(dishId: number, items: Map<number, { qtyPerPortion: number; fixedQty: number }>, overwrite: boolean) {
  // read first, then one short batch (no interactive transaction: avoids SQLITE_BUSY with concurrent writers)
  const kept = overwrite
    ? new Set<number>()
    : new Set(
        (await db.select({ i: recipeItems.ingredientId }).from(recipeItems).where(and(eq(recipeItems.dishId, dishId), ne(recipeItems.source, "ai")))).map((r) => r.i),
      );
  const rows = [...items].filter(([id]) => !kept.has(id)).map(([ingredientId, q]) => ({ dishId, ingredientId, ...q, source: "ai" as const }));
  const del = overwrite
    ? db.delete(recipeItems).where(eq(recipeItems.dishId, dishId))
    : db.delete(recipeItems).where(and(eq(recipeItems.dishId, dishId), eq(recipeItems.source, "ai")));
  if (rows.length) await db.batch([del, db.insert(recipeItems).values(rows)]);
  else await del;
}

async function pool<T, R>(list: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, list.length) }, async () => {
      while (next < list.length) {
        const i = next++;
        out[i] = await fn(list[i]);
      }
    }),
  );
  return out;
}

function mergeOutcomes(list: DraftOutcome[]): DraftOutcome {
  const drafted = list.flatMap((o) => o.drafted);
  const failed = list.flatMap((o) => o.failed);
  const status: DraftStatus = !failed.length ? "ok" : drafted.length ? "partial" : list.every((o) => o.status === "unavailable") ? "unavailable" : "error";
  return { status, drafted, failed, message: list.find((o) => o.message)?.message };
}

/**
 * Drafts recipes for the given dishes with the LLM (batches of 6, 2 at a time). Dishes already being
 * drafted are awaited instead of drafted twice. Never throws: the outcome says what happened.
 */
export async function draftRecipes(dishIds: number[], opts: { overwrite?: boolean; onBatch?: (o: DraftOutcome) => void } = {}): Promise<DraftOutcome> {
  const ids = [...new Set(dishIds)];
  const waiting = ids.filter((id) => inFlight.has(id));
  const todo = ids.filter((id) => !inFlight.has(id));
  const rows = todo.length ? await db.select().from(dishes).where(inArray(dishes.id, todo)) : [];
  const batches: (typeof rows)[] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) batches.push(rows.slice(i, i + BATCH_SIZE));

  const results = await pool(batches, CONCURRENCY, async (batch) => {
    let done!: () => void;
    const p = new Promise<void>((r) => (done = r));
    for (const d of batch) inFlight.set(d.id, p);
    try {
      const o = await draftBatch(batch, opts.overwrite ?? false);
      opts.onBatch?.(o);
      return o;
    } finally {
      for (const d of batch) inFlight.delete(d.id);
      done();
    }
  });
  await Promise.all(waiting.map((id) => inFlight.get(id)));
  return mergeOutcomes(results);
}

/** Catalog dishes (not archived) with no recipe, most served first. */
export async function dishesWithoutRecipe(limit?: number) {
  const q = db
    .select({ id: dishes.id, name: dishes.name, served: sql<number>`count(${menuItems.id})` })
    .from(dishes)
    .leftJoin(recipeItems, eq(recipeItems.dishId, dishes.id))
    .leftJoin(menuItems, eq(menuItems.dishId, dishes.id))
    .where(and(isNull(recipeItems.id), ne(dishes.status, "archivado")))
    .groupBy(dishes.id)
    .orderBy(desc(sql`count(${menuItems.id})`), dishes.name);
  return limit ? q.limit(limit) : q;
}

/** Of the given dishes, those with no recipe items. */
export async function withoutRecipe(dishIds: number[]): Promise<number[]> {
  if (!dishIds.length) return [];
  const have = await db.selectDistinct({ id: recipeItems.dishId }).from(recipeItems).where(inArray(recipeItems.dishId, dishIds));
  const set = new Set(have.map((h) => h.id));
  return [...new Set(dishIds)].filter((id) => !set.has(id));
}

// ---------------------------------------------------------------- background job: "Generar recetas faltantes"

export interface DraftJob {
  running: boolean;
  startedAt: string;
  finishedAt?: string;
  total: number;
  done: number;
  drafted: number;
  failed: { dishId: number; name: string; error: string }[];
  status?: DraftStatus;
  message?: string;
}

export function draftJobStatus(): DraftJob | null {
  return g.__draftJob ?? null;
}

/** Starts drafting all missing recipes in the background (or returns the job already running). */
export async function startDraftMissing(limit?: number): Promise<DraftJob> {
  if (g.__draftJob?.running) return g.__draftJob;
  // inline mode (Cloud Run): no CPU after the response, so draft one chunk per request and return when done
  const inline = inlineBackground();
  const missing = await dishesWithoutRecipe(inline ? Math.min(limit ?? 12, 12) : limit);
  const job: DraftJob = { running: missing.length > 0, startedAt: new Date().toISOString(), total: missing.length, done: 0, drafted: 0, failed: [] };
  g.__draftJob = job;
  if (!missing.length) {
    job.finishedAt = job.startedAt;
    job.status = "ok";
    return job;
  }
  const run = draftRecipes(
    missing.map((m) => m.id),
    {
      onBatch: (o) => {
        job.done += o.drafted.length + o.failed.length;
        job.drafted += o.drafted.length;
        job.failed.push(...o.failed);
        if (o.message) job.message = o.message;
      },
    },
  )
    .then((o) => (job.status = o.status))
    .catch((e) => {
      job.status = "error";
      job.message = (e as Error).message;
    })
    .finally(() => {
      job.running = false;
      job.finishedAt = new Date().toISOString();
    });
  if (inline) await run;
  return job;
}
