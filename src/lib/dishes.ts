import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getLlm } from "@/lib/llm";
import { normalizeName } from "@/lib/rules/text";
import { CLASSIFY_SYSTEM, classifyHeuristic, classifyPrompt, classifySchema, type DishClass } from "@/lib/generator/classify";
import type { Course } from "./types";

type Dish = typeof schema.dishes.$inferSelect;

/** Case/accent-insensitive lookup by name. */
export async function findDishByName(name: string): Promise<Dish | null> {
  const key = normalizeName(name);
  if (!key) return null;
  const rows = await db.select().from(schema.dishes);
  return rows.find((d) => normalizeName(d.name) === key) ?? null;
}

/** Category/tags/protein/base from the LLM (tier "fast"); throws if the LLM is unavailable. */
export async function classifyDishWithLlm(name: string, course: Course): Promise<DishClass> {
  const rows = await db.select().from(schema.dishes).where(eq(schema.dishes.status, "activo"));
  const examples = rows
    .filter((d) => (course === "entrada" ? d.course === "entrada" : d.course !== "entrada"))
    .slice(0, 40)
    .map((d) => ({ name: d.name, category: d.category, tags: d.tags, protein: d.protein, base: d.base }));
  const res = await getLlm().complete({ system: CLASSIFY_SYSTEM, prompt: classifyPrompt(name, course, examples), schema: classifySchema(course), tier: "fast" });
  const protein = res.protein && !/^ninguna$/i.test(res.protein) ? res.protein : null;
  return { category: res.category, tags: [...new Set(res.tags)], protein, base: res.base || null };
}

/**
 * Existing dish with that name, or a new `nuevo` dish. `classify: "llm"` waits for the LLM
 * (falls back to the keyword heuristic on any error); "heuristic" is instant — use it in
 * request handlers and refine later with `reclassifyDish` in `after()`.
 */
export async function ensureDish(name: string, course: Course, opts: { classify?: "llm" | "heuristic" } = {}): Promise<Dish> {
  const clean = name.trim().replace(/\s+/g, " ");
  const existing = await findDishByName(clean);
  if (existing) return existing;

  let cls = classifyHeuristic(clean, course);
  if (opts.classify !== "heuristic") {
    try {
      cls = await classifyDishWithLlm(clean, course);
    } catch (e) {
      console.warn("[dishes] clasificación con IA falló, uso heurística:", (e as Error).message);
    }
  }
  const [created] = await db
    .insert(schema.dishes)
    .values({ name: clean, course, ...cls, status: "nuevo", notes: "Creado desde el menú; revisar y aprobar." })
    .onConflictDoNothing()
    .returning();
  return created ?? (await findDishByName(clean))!;
}

/** Re-classifies a `nuevo` dish with the LLM. Returns true if something changed. Never throws. */
export async function reclassifyDish(dishId: number): Promise<boolean> {
  try {
    const [d] = await db.select().from(schema.dishes).where(eq(schema.dishes.id, dishId));
    if (!d || d.status !== "nuevo") return false;
    const cls = await classifyDishWithLlm(d.name, d.course);
    if (d.category === cls.category && d.protein === cls.protein && d.base === cls.base && [...d.tags].sort().join() === [...cls.tags].sort().join()) return false;
    await db.update(schema.dishes).set(cls).where(eq(schema.dishes.id, dishId));
    return true;
  } catch (e) {
    console.warn("[dishes] no se pudo reclasificar con IA:", (e as Error).message);
    return false;
  }
}
