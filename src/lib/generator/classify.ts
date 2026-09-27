/** Dish classification: LLM schema/prompt plus a keyword heuristic used when the LLM fails. */
import { z } from "zod";
import { ENTRADA_CATEGORIES, SEGUNDO_CATEGORIES, TAGS, type Course } from "@/lib/types";
import { normalizeName } from "@/lib/rules/text";

export interface DishClass {
  category: string;
  tags: string[];
  protein: string | null;
  base: string | null;
}

export const categoriesFor = (course: Course): readonly string[] => (course === "entrada" ? ENTRADA_CATEGORIES : SEGUNDO_CATEGORIES);

export const PROTEINS = ["Pollo", "Res", "Cerdo", "Pescado", "Mariscos", "Huevo", "Pavo", "Cuy", "Menudencia", "Ninguna"] as const;

export function classifySchema(course: Course) {
  return z.object({
    category: z.enum(categoriesFor(course) as [string, ...string[]]),
    tags: z.array(z.enum(TAGS)),
    protein: z.string().nullable(),
    base: z.string().nullable(),
  });
}

export const CLASSIFY_SYSTEM =
  "Eres el jefe de cocina de un restaurante criollo peruano en Lima. Clasificas platos del menú del día. Responde solo con el JSON pedido.";

export function classifyPrompt(name: string, course: Course, examples: { name: string; category: string; tags: string[]; protein: string | null; base: string | null }[]) {
  return [
    `Plato: "${name}" (se sirve como ${course}).`,
    `Categorías posibles: ${categoriesFor(course).join(", ")}.`,
    `Etiquetas posibles (elige las que apliquen, puede ser ninguna): ${TAGS.join(", ")}.`,
    "- legumbre: lleva menestra/legumbre como base (lentejas, frijoles, arveja, pallares, garbanzo, habas).",
    "- pesado: plato contundente (sancochado, menestrón, shambar, patasca, cau cau, carapulcra, frijoles…).",
    "- frito: el componente principal va frito. picante: picante de verdad (rocoto, picantes). cerdo: lleva chancho.",
    "- pescado: pescado o mariscos. menudencia: hígado, mondongo, mollejas, pata, bofe, sangrecita.",
    `protein: la proteína principal (${PROTEINS.join(", ")}) o null. base: la base del plato si es combinado (p. ej. "Lentejas", "Tallarines", "Guiso de quinua") o null.`,
    "",
    "Ejemplos del catálogo:",
    ...examples.map((e) => `- ${e.name}: ${e.category}; etiquetas [${e.tags.join(", ")}]; proteína ${e.protein ?? "null"}; base ${e.base ?? "null"}`),
  ].join("\n");
}

const has = (n: string, re: RegExp) => re.test(n);

const LEGUMES: [RegExp, string][] = [
  [/lenteja/, "Lentejas"],
  [/frijol|frejol|panamito/, "Frijoles"],
  [/pallar/, "Pallares"],
  [/garbanzo/, "Garbanzos"],
  [/arvejita|arveja partida/, "Arvejita partida"],
  [/haba/, "Habas"],
];

/** Keyword heuristic, good enough to keep rules working until someone edits the dish. */
export function classifyHeuristic(name: string, course: Course): DishClass {
  const n = normalizeName(name);
  const legume = LEGUMES.find(([re]) => re.test(n));
  const tags = new Set<string>();
  let category: string;
  let base: string | null = null;

  if (course === "entrada") {
    if (has(n, /\bcrema\b/)) category = "crema";
    else if (has(n, /sopa|caldo|chupe|sancochado|menestron|shambar|patasca|aguadito|parihuela|dieta|chilcano|sustancia|chairo|inchicapi/)) category = "sopa";
    else if (has(n, /ensalada/)) category = "ensalada";
    else if (has(n, /frit|tequeno|wantan|salchipapa|chicharron|empanada|rellen|nugget/)) category = "fritura";
    else if (has(n, /tamal|humita|anticucho|juane/)) category = "criolla";
    else category = "fria";
  } else {
    if (legume && !has(n, /crema|sopa/)) {
      category = "menestra";
      base = legume[1];
    } else if (has(n, /^(guiso|estofado|seco|aji de|picante de|olluquito|cau cau|carapulcra|adobo|chanfainita|locro|pachamanca)/)) category = "guiso";
    else if (has(n, /tallar|fideo|lasana|spaghetti|macarron|pasta|canelon/)) category = "pasta";
    else if (has(n, /\barroz\b|chaufa|tacu|jardinera|aeropuerto|risotto/)) category = "arroz";
    else if (has(n, /saltad/)) category = "saltado";
    else if (has(n, /frit|broaster|chicharron|milanesa|apanad|chuleta|churrasco|a lo pobre|bistec|nugget|chactado/)) category = "fritura";
    else if (has(n, /ensalada|ceviche|escabeche|causa|\bfrio\b/)) category = "frio";
    else if (has(n, /verdura|vainita|brocoli|coliflor|tortilla|zapallo|espinaca|acelga|caigua|cayhua/)) category = "verduras";
    else category = "guiso";
  }

  if (legume || has(n, /arveja|menestron|shambar/)) tags.add("legumbre");
  if (has(n, /frit|broaster|chicharron|apanad|milanesa|tequeno|wantan|chactado/)) tags.add("frito");
  if (has(n, /picante|rocoto/)) tags.add("picante");
  if (has(n, /chancho|cerdo|lechon|chicharron de chancho/)) tags.add("cerdo");
  // "sudado" alone usually means fish, unless another meat is named ("sudado de cabrito")
  const otherMeat = has(n, /pollo|gallina|cabrito|carne|\bres\b|chancho|cerdo|cordero|pavo/);
  if (has(n, /pescado|trucha|bonito|jurel|caballa|atun|choro|marisc|chilcano|parihuela|tilapia|merluza/) || (has(n, /sudado/) && !otherMeat))
    tags.add("pescado");
  if (has(n, /higado|mondongo|mollej|rachi|pancita|cau cau|chanfainita|patita|bofe|sangrecita/)) tags.add("menudencia");
  if (has(n, /sancochado|menestron|shambar|patasca|mondongo|cau cau|carapulcra|pachamanca|chanfainita|frijol|frejol|cabrito/)) tags.add("pesado");

  let protein: string | null = null;
  if (has(n, /pollo|gallina/)) protein = "Pollo";
  else if (tags.has("pescado")) protein = "Pescado";
  else if (tags.has("cerdo")) protein = "Cerdo";
  else if (has(n, /\bres\b|carne|lomo|bistec|churrasco|seco|asado|sabana|cabrito/)) protein = "Res";
  else if (has(n, /huevo/)) protein = "Huevo";

  return { category, tags: [...tags], protein, base };
}
