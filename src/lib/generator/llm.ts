/** Prompts and structured-output schemas for LLM menu generation and swaps (pure). */
import { z } from "zod";
import { ENTRADA_CATEGORIES, SEGUNDO_CATEGORIES, TAGS, type Weekday } from "@/lib/types";
import { describeRule } from "@/lib/rules/describe";
import { shortDate } from "@/lib/rules/dates";
import type { RuleDef } from "@/lib/rules/validate";
import { daysSince, type CatalogDish, type Engine, type HistoryMenu, type PlannedItem } from "./core";

export const newDishSchema = z.object({
  name: z.string().min(3),
  category: z.enum([...new Set([...ENTRADA_CATEGORIES, ...SEGUNDO_CATEGORIES])] as [string, ...string[]]),
  tags: z.array(z.enum(TAGS)),
  protein: z.string().nullable(),
  base: z.string().nullable(),
});

export const generateSchema = z.object({
  items: z.array(
    z.object({
      course: z.enum(["entrada", "segundo"]),
      dishId: z.number().int().nullable().describe("id (#) del plato elegido de la lista; null solo si es un plato nuevo"),
      newDish: newDishSchema.nullable().describe("solo para el plato nuevo inventado; null en los demás"),
      reason: z.string().describe("motivo corto (máx. 8 palabras) en español natural, p. ej. 'Lunes de lentejas' o 'No sale hace 12 días'"),
    }),
  ),
  reasoning: z.string().describe("resumen del menú en 1–2 frases en español natural, para el dueño"),
});
export type GenerateOutput = z.infer<typeof generateSchema>;

export const swapSchema = z.object({ dishId: z.number().int(), reason: z.string().describe("motivo corto (máx. 10 palabras) en español natural") });

export const MENU_SYSTEM = [
  "Eres el chef de La Sazón de Luis, un restaurante criollo peruano en Lima que sirve un menú del día (entrada + segundo a precio fijo).",
  "Armas el menú de mañana: variado, casero, balanceado (no todo frito ni todo pesado), respetando las reglas de la cocina y las costumbres de cada día.",
  "Usa solo platos de la lista de candidatos (por su id #), salvo que se permita inventar uno nuevo. Responde solo con el JSON pedido, en español.",
].join(" ");

function dishLine(d: CatalogDish, engine: Engine): string {
  const days = daysSince(engine.stats, d.id);
  const wc = engine.stats.weekdayCount.get(d.id) ?? 0;
  const parts = [
    `#${d.id}`,
    d.course,
    d.category,
    d.name,
    d.tags.length ? `etiquetas: ${d.tags.join(", ")}` : null,
    d.protein ? `proteína: ${d.protein}` : null,
    days == null ? "nunca servido" : `última vez hace ${days} días`,
    `${engine.stats.weekday}: ${wc}/${engine.stats.weekdayMenus}`,
    `total: ${engine.stats.count.get(d.id) ?? 0}`,
  ];
  return parts.filter(Boolean).join(" | ");
}

export function rulesText(rules: RuleDef[]): string {
  return rules
    .filter((r) => r.enabled)
    .map((r) => `- [${r.hard ? "obligatoria" : "preferencia"}] ${r.name}: ${describeRule(r.params)}`)
    .join("\n");
}

export function recentText(history: HistoryMenu[], date: string, byId: Map<number, CatalogDish>, days = 14): string {
  const recent = history.filter((m) => m.date < date).slice(-days);
  return recent
    .map((m) => {
      const by = (c: string) => m.items.filter((i) => i.course === c).map((i) => (i.dishId != null ? byId.get(i.dishId)?.name : null) ?? i.name);
      return `- ${shortDate(m.date)}: entradas: ${by("entrada").join("; ")} || segundos: ${by("segundo").join("; ")}`;
    })
    .join("\n");
}

export interface GeneratePromptInput {
  engine: Engine;
  weekday: Weekday;
  need: { entradas: number; segundos: number };
  pinned: PlannedItem[];
  history: HistoryMenu[];
  candidates: CatalogDish[];
  allowNewDish: boolean;
  feedback?: string[];
}

export function buildGeneratePrompt({ engine, weekday, need, pinned, history, candidates, allowNewDish, feedback }: GeneratePromptInput): string {
  const pinnedText = pinned.filter((p) => p.course !== "extra").map((p) => `- ${p.course}: ${p.name}`);
  const lines = [
    `Fecha: ${engine.date} (${weekday}).`,
    `Elige ${need.entradas} entrada(s) y ${need.segundos} segundo(s) nuevos${pinnedText.length ? ", que se suman a estos platos ya fijados (no los repitas)" : ""}.`,
    ...(pinnedText.length ? ["Fijados:", ...pinnedText] : []),
    "",
    "Composición habitual: entradas = 1 sopa o crema + otras de distinta categoría (fría, ensalada, fritura, criolla).",
    "Segundos = 1 menestra (si toca ese día) + 1–2 guisos + uno de arroz / pasta / fritura / saltado / verduras / frío. Varía las proteínas.",
    "",
    "Reglas de la cocina:",
    rulesText(engine.rules),
    "",
    "Menús de los últimos días:",
    recentText(history, engine.date, engine.byId),
    "",
    `Candidatos válidos (ya filtrados por repetición y chancho semanal). Formato: #id | plato | categoría | nombre | … | veces en ${weekday} / ${weekday}s con menú | total servido:`,
    ...candidates.map((d) => dishLine(d, engine)),
    "",
    allowNewDish
      ? "Puedes (opcional) inventar UN plato nuevo parecido a los del historial, por ejemplo una base conocida con otra proteína (\"Guiso de quinua con churrasco\"). Para ese ítem pon dishId null y completa newDish (categoría, etiquetas, proteína, base). Úsalo solo si tiene sentido; no es obligatorio."
      : "No inventes platos nuevos esta vez: todos los ítems deben tener dishId de la lista y newDish null.",
    "Para cada ítem da un motivo corto en español natural, como se lo dirías a la cocinera (\"Martes de panamito\", \"No sale hace dos semanas\", \"Para variar con pescado\"); sin abreviaturas ni jerga de reglas.",
  ];
  if (feedback?.length)
    lines.push("", "Tu propuesta anterior no cumplía estas reglas. Corrígela:", ...feedback.map((f) => `- ${f}`));
  return lines.join("\n");
}

export function buildSwapPrompt(engine: Engine, items: PlannedItem[], target: PlannedItem, options: { dish: CatalogDish; reason: string }[], rules: RuleDef[]): string {
  return [
    `Fecha: ${engine.date} (${engine.stats.weekday}).`,
    "Menú actual:",
    ...items.filter((i) => i.course !== "extra").map((i) => `- ${i.course}: ${i.name}${i.key === target.key ? "   <-- REEMPLAZAR" : ""}`),
    "",
    "Reglas de la cocina:",
    rulesText(rules),
    "",
    `Elige el mejor reemplazo para "${target.name}" (${target.course}) entre estas opciones válidas:`,
    ...options.map((o) => dishLine(o.dish, engine)),
    "",
    "Devuelve el dishId elegido y un motivo corto (máx. 10 palabras) en español natural.",
  ].join("\n");
}
