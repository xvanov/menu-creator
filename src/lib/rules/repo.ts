import "server-only";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { getLlm } from "@/lib/llm";
import { ENTRADA_CATEGORIES, SEGUNDO_CATEGORIES, TAGS, WEEKDAYS } from "@/lib/types";
import { describeRule } from "./describe";
import { cleanParams, ruleBodySchema, ruleParamsSchema } from "./schema";

const { rules } = schema;
export type RuleRow = typeof rules.$inferSelect;
export type RuleView = RuleRow & { summary: string };

const view = (r: RuleRow): RuleView => ({ ...r, summary: describeRule(r.params) });

export async function listRules(): Promise<RuleView[]> {
  return (await db.select().from(rules).orderBy(asc(rules.id))).map(view);
}

export async function createRule(body: z.infer<typeof ruleBodySchema>): Promise<RuleView> {
  const [row] = await db
    .insert(rules)
    .values({ name: body.name, description: body.description ?? null, params: cleanParams(body.params), hard: body.hard ?? true, enabled: body.enabled ?? true })
    .returning();
  return view(row);
}

export const rulePatchSchema = ruleBodySchema.partial();

export async function updateRule(id: number, patch: z.infer<typeof rulePatchSchema>): Promise<RuleView | null> {
  const set: Partial<typeof rules.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description ?? null;
  if (patch.params !== undefined) set.params = cleanParams(patch.params);
  if (patch.hard !== undefined) set.hard = patch.hard;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  const [row] = Object.keys(set).length
    ? await db.update(rules).set(set).where(eq(rules.id, id)).returning()
    : await db.select().from(rules).where(eq(rules.id, id));
  return row ? view(row) : null;
}

export async function deleteRule(id: number): Promise<boolean> {
  return (await db.delete(rules).where(eq(rules.id, id)).returning({ id: rules.id })).length > 0;
}

const parsedSchema = z.object({
  name: z.string().describe("nombre corto de la regla"),
  description: z.string().describe("explicación en una frase"),
  hard: z.boolean().describe("true si es obligatoria, false si es preferencia"),
  params: ruleParamsSchema,
});
export type ParsedRule = z.infer<typeof parsedSchema> & { summary: string };

/** Free text → RuleParams via the LLM, for the person to review before saving. Throws if unavailable. */
export async function parseRuleText(text: string): Promise<ParsedRule> {
  const dishNames = (await db.select({ name: schema.dishes.name }).from(schema.dishes)).map((d) => d.name);
  const system =
    "Conviertes reglas de cocina escritas en español (restaurante criollo peruano, menú del día con entradas, segundos y extras) en JSON estructurado. Responde solo con el JSON pedido.";
  const prompt = [
    `Regla: "${text}"`,
    "",
    "Tipos de regla (params.type):",
    "- count_per_day: cantidad de platos que cumplen `filter` por día, entre min y max. weekdayOverrides cambia min/max en días concretos (claves: " + WEEKDAYS.join(", ") + ").",
    "- count_per_week: como máximo `max` platos que cumplen `filter` en la semana (lunes a sábado).",
    "- forbid_pair: un plato que cumple `a` y otro que cumple `b` no pueden ir el mismo día.",
    "- no_repeat: un plato no se repite en `days` días, salvo `exceptNames`.",
    "- text: si no encaja en los anteriores, guarda la regla como texto para la IA (params.text).",
    "",
    "filter: { course?: entrada | segundo | extra, categories?: [...], tagsAny?: [...], names?: [nombres exactos de platos] }. Todos los campos dados deben cumplirse.",
    `Categorías de entrada: ${ENTRADA_CATEGORIES.join(", ")}. Categorías de segundo: ${SEGUNDO_CATEGORIES.join(", ")}.`,
    `Etiquetas: ${TAGS.join(", ")} (chancho = cerdo; frito = frito; menestras/legumbres = legumbre).`,
    "Si la regla nombra platos concretos, usa los nombres exactos de este catálogo:",
    dishNames.join("; "),
    "",
    'Ejemplo: "no chancho los lunes" → { type: "count_per_day", filter: { tagsAny: ["cerdo"] }, weekdayOverrides: { lunes: { max: 0 } } }.',
    'Ejemplo: "máximo dos guisos de pollo" → mejor como text si no hay una etiqueta para pollo, o count_per_day con names si se nombran platos.',
  ].join("\n");
  const out = await getLlm().complete({ system, prompt, schema: parsedSchema, tier: "fast" });
  const params = cleanParams(out.params);
  return { ...out, params, summary: describeRule(params) };
}
