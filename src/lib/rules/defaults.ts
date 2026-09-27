import type { RuleParams } from "@/lib/types";

/** The owner's rules (2026-09-26). Seeded on an empty database; "Restaurar reglas predeterminadas" re-adds missing ones. */
export const DEFAULT_RULES: { name: string; description: string; params: RuleParams; hard?: boolean }[] = [
  {
    name: "Una sopa o crema",
    description: "Siempre exactamente una sopa o crema entre las entradas.",
    params: { type: "count_per_day", filter: { course: "entrada", categories: ["sopa", "crema"] }, min: 1, max: 1 },
  },
  {
    name: "Menestra diaria (menos sábado)",
    description: "Una menestra todos los días; el sábado es opcional.",
    params: { type: "count_per_day", filter: { course: "segundo", categories: ["menestra"] }, min: 1, max: 1, weekdayOverrides: { sábado: { min: 0, max: 1 } } },
  },
  {
    name: "Menestra no va con sopa pesada o de legumbre",
    description: "Cae pesado: si hay menestra, la sopa/crema no puede ser de legumbre ni pesada (crema de arveja, menestrón, shambar, patasca, sancochado…).",
    params: { type: "forbid_pair", a: { course: "entrada", tagsAny: ["legumbre", "pesado"] }, b: { course: "segundo", categories: ["menestra"] } },
  },
  {
    name: "Máximo una fritura",
    description: "Máximo un segundo frito por día; el sábado se permiten dos.",
    params: { type: "count_per_day", filter: { course: "segundo", categories: ["fritura"] }, max: 1, weekdayOverrides: { sábado: { max: 2 } } },
  },
  {
    name: "Chancho una vez por semana",
    description: "Máximo un plato de chancho por semana.",
    params: { type: "count_per_week", filter: { tagsAny: ["cerdo"] }, max: 1 },
  },
  {
    name: "No repetir en 7 días",
    description: "Un plato no vuelve antes de 7 días, salvo los de siempre.",
    params: { type: "no_repeat", days: 7, exceptNames: ["Papa a la huancaína", "Tamal criollo", "Pollo broaster"] },
  },
  {
    name: "Costumbres de la semana",
    description: "Preferencia, no obligación.",
    hard: false,
    params: { type: "text", text: "Lunes: lentejas. Viernes: frijoles. Martes: garbanzo, frijol panamito o pallares. Miércoles y jueves: arvejita partida. No más de dos guisos de pollo el mismo día." },
  },
];
