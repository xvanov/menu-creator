/** Prompt and schema for LLM recipe drafting. Pure (no DB) so it can be tested and inspected. */
import { z } from "zod";
import { UNITS } from "../types";
import { fmtQty } from "../shopping/units";

export const draftSchema = z.object({
  recipes: z.array(
    z.object({
      dish: z.string().describe("Nombre exacto del plato, tal como se pidió"),
      ingredients: z.array(
        z.object({
          name: z.string().describe("Ingrediente; reutiliza el nombre exacto de la lista si existe"),
          unit: z.enum(UNITS),
          qtyPerPortion: z.number().describe("Cantidad por porción en `unit` (0 si solo va por olla)"),
          fixedQty: z.number().describe("Cantidad fija por olla/tanda en `unit`, independiente de las porciones (0 si no aplica)"),
        }),
      ),
    }),
  ),
});
export type DraftResult = z.infer<typeof draftSchema>;

export const stockParseSchema = z.object({
  items: z.array(
    z.object({
      name: z.string().describe("Ingrediente; nombre exacto de la lista si existe"),
      qty: z.number().nullable().describe("Cantidad en `unit`; null si no se dijo un número (\"bastante\", \"poco\")"),
      unit: z.enum(UNITS),
      note: z.string().nullable().describe("Lo que dijeron si no es un número exacto, p.ej. \"bastante\""),
    }),
  ),
});
export type StockParseResult = z.infer<typeof stockParseSchema>;

export interface DraftDish {
  name: string;
  course: string;
  category: string;
  base?: string | null;
  protein?: string | null;
  tags?: string[];
  notes?: string[]; // chat notes about this dish
}

export interface KnownIngredient {
  name: string;
  unit: string;
}

export interface ExampleRecipe {
  dish: string;
  items: { name: string; unit: string; qtyPerPortion: number; fixedQty: number; source: string }[];
}

export const DRAFT_SYSTEM = `Eres el jefe de cocina de "La Sazón de Luis", un restaurante criollo peruano en un mercado de Lima que vende unos 100 almuerzos de menú del día a S/13 (entrada + segundo). Tu trabajo: escribir la receta de COMPRAS de cada plato, es decir, cuánto de cada ingrediente hay que comprar por porción, para que la lista de compras del día salga bien.

Reglas para las cantidades:
- Porciones de menú del día de Lima: generosas pero de mercado, no de restaurante caro. Razona cada plato.
- Cantidades en PESO DE COMPRA (crudo, con cáscara/hueso, como se compra en el mercado), en la unidad del ingrediente.
- Pollo en "presa": 1 presa por porción en guisos/frituras de pollo (1 presa ≈ 0.25 kg). Pollo deshilachado (ají de gallina, causa, ensaladas) ≈ 0.5 presa por porción.
- Referencias por porción: arroz crudo ≈ 0.1 kg cuando el arroz ES parte del plato (arroz con pollo, chaufa, tacu tacu, arroz tapado); papa ≈ 0.15–0.2 kg (acompañamiento 0.15, plato de papa 0.2–0.25); menestra seca (lenteja, frijol, pallar, garbanzo, arvejita partida) ≈ 0.07 kg; carne de res/cerdo ≈ 0.15–0.18 kg; pescado ≈ 0.15–0.2 kg; fideo seco ≈ 0.1 kg; sopa: 0.05 kg de fideo/trigo y verduras 0.1 kg; entradas frías (papa a la huancaína, ocopa, causa) ≈ 0.2 kg de papa.
- NO incluyas el arroz blanco de acompañamiento de los segundos (se calcula aparte con una regla de la cocina). Tampoco agua, gas ni descartables.
- Condimentos y aderezos que no dependen tanto de las porciones (ajo, comino, pimienta, sillao, vinagre, sal, ají panca en pasta, caldo en cubitos, orégano, laurel) van en "fixedQty" por olla de ~20 porciones, en cantidades realistas (p.ej. ajo 0.1 kg, comino 0.02 kg).
- Aceite para freír: fixedQty (p.ej. 1 botella por tanda de fritura); para aderezo, un poco por porción.
- La cocina pidió REDUCIR cebolla, ají y rocoto porque están caros: usa cantidades moderadas (cebolla roja ≈ 0.03–0.05 kg por porción en guisos, más solo si es protagonista como en escabeche o sarsa).
- Solo ingredientes que se compran crudos: nada de preparaciones intermedias ni nombres de platos. Desglosa las salsas: crema huancaína = queso fresco + ají amarillo + leche evaporada + galleta + aceite; ocopa = huacatay + maní + queso + ají; huevo sancochado = "Huevo" en unidad (1 huevo ≈ 1 unidad). Usa "Pollo" (presa) para el pollo.
- Reutiliza el nombre EXACTO y la unidad de la lista de ingredientes existentes siempre que sea el mismo producto. NUNCA sustituyas un producto por otro parecido: la proteína del plato debe ser la del nombre (cabrito → "Cabrito", no "Carne para lomo"; "seco de res" → "Carne de res para guiso"; pescado → "Pescado"). Solo crea un ingrediente nuevo si no está, con un nombre simple en singular ("Ají amarillo", "Culantro", "Queso fresco").
- Unidades: kg para lo que se pesa, "unidad" para lo que se cuenta (huevo, limón si la lista lo tiene en unidad, lechuga), "atado" para hierbas por atado, etc. Si un ingrediente existente usa otra unidad, usa la suya.
- 4 a 14 ingredientes por plato, lo importante para comprar. Devuelve una receta por cada plato pedido, con el nombre exacto del plato.`;

function fmtItem(i: ExampleRecipe["items"][number]) {
  const parts = [];
  if (i.qtyPerPortion > 0) parts.push(`${fmtQty(i.qtyPerPortion)} ${i.unit}/porción`);
  if (i.fixedQty > 0) parts.push(`${fmtQty(i.fixedQty)} ${i.unit} por olla`);
  return `${i.name} ${parts.join(" + ")}`;
}

/**
 * Names in the chat-derived ingredient list that are dishes or preparations, not things you buy.
 * They're hidden from the LLM so drafts use raw ingredients.
 */
export const NOT_RAW_INGREDIENTS = [
  "Ceviche",
  "Seco de res",
  "Tallarín con pollo",
  "Ají de gallina",
  "Crema huancaína",
  "Pollo broaster",
  "Pollo frito",
  "Huevo sancochado",
  "Chancho cocinado",
  "Harinas",
];

export function buildDraftPrompt(input: {
  dishes: DraftDish[];
  ingredients: KnownIngredient[];
  kitchenRules: string[];
  overstocked: string[];
  examples: ExampleRecipe[];
  recentCorrections: string[];
}): string {
  const out: string[] = [];
  out.push("## Ingredientes existentes (nombre · unidad)");
  const hidden = new Set(NOT_RAW_INGREDIENTS.map((n) => n.toLocaleLowerCase("es")));
  out.push(
    input.ingredients
      .filter((i) => !hidden.has(i.name.toLocaleLowerCase("es")))
      .map((i) => `${i.name} · ${i.unit}`)
      .join("\n"),
  );
  if (input.kitchenRules.length) {
    out.push("", "## Lo que dijo la cocina en el chat");
    out.push(...input.kitchenRules.map((r) => `- ${r}`));
  }
  if (input.overstocked.length) out.push("", `Suele sobrar (no exagerar): ${input.overstocked.join(", ")}.`);
  if (input.examples.length) {
    out.push("", "## Recetas ya corregidas por la cocina (úsalas como referencia de porciones)");
    for (const e of input.examples) out.push(`- ${e.dish}: ${e.items.map(fmtItem).join("; ")}`);
  }
  if (input.recentCorrections.length) {
    out.push("", "## Correcciones recientes de cantidades");
    out.push(...input.recentCorrections.map((c) => `- ${c}`));
  }
  out.push("", "## Platos a los que hay que escribir la receta");
  for (const d of input.dishes) {
    const info = [d.course, d.category, d.base && `base ${d.base}`, d.protein && `proteína ${d.protein}`, d.tags?.length && `tags ${d.tags.join("/")}`]
      .filter(Boolean)
      .join(", ");
    out.push(`- ${d.name} (${info})`);
    for (const n of d.notes ?? []) out.push(`  · chat: ${n}`);
  }
  return out.join("\n");
}

export const STOCK_SYSTEM = `Eres el asistente de la cocina de "La Sazón de Luis" (restaurante criollo en Lima). Te pegan un mensaje de WhatsApp de lo que HAY en el almacén (p.ej. "Hay 7 kilos de arroz, 3 aceites, cebolla bastante"). Conviértelo en una lista de ingredientes con cantidad.
- Usa el nombre EXACTO y la unidad de la lista de ingredientes existentes cuando sea el mismo producto ("3 aceites" → Aceite, 3, botella; "cebolla" → Cebolla roja). Convierte a esa unidad si hace falta (500 gramos → 0.5 kg).
- "kilos", "kg", "k" = kg. Una "bolsa", "tarro", "botella" o "paquete" van en esa unidad si el ingrediente la usa.
- Si no dicen número ("bastante", "poco", "hay"), qty = null y copia la expresión en note.
- Ignora saludos y lo que no sea un ingrediente. No inventes ingredientes que no se mencionan.`;

export function buildStockPrompt(text: string, ingredients: KnownIngredient[]): string {
  return [
    "## Ingredientes existentes (nombre · unidad)",
    ingredients.map((i) => `${i.name} · ${i.unit}`).join("\n"),
    "",
    "## Mensaje",
    text,
  ].join("\n");
}
