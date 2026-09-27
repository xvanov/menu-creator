/** Human-readable Spanish summaries of rule params (used by /reglas and in LLM prompts). */
import type { DishFilter, RuleParams } from "@/lib/types";

const COURSE_PLURAL = { entrada: "entradas", segundo: "segundos", extra: "extras" } as const;

const orList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} o ${xs[xs.length - 1]}`);

export function describeFilter(f: DishFilter): string {
  const parts: string[] = [];
  parts.push(f.course ? COURSE_PLURAL[f.course] : "platos");
  if (f.categories?.length) parts.push(`de categoría ${orList(f.categories)}`);
  if (f.tagsAny?.length) parts.push(`con etiqueta ${orList(f.tagsAny)}`);
  if (f.names?.length) parts.push(`llamados ${orList(f.names.map((n) => `“${n}”`))}`);
  return parts.join(" ");
}

function range(what: string, min?: number, max?: number): string {
  if (!min && max === 0) return `sin ${what}`;
  if (min != null && max != null) return min === max ? `exactamente ${min} ${what}` : `entre ${min} y ${max} ${what}`;
  if (min != null) return `al menos ${min} ${what}`;
  if (max != null) return `como máximo ${max} ${what}`;
  return `cualquier cantidad de ${what}`;
}

export function describeRule(p: RuleParams): string {
  switch (p.type) {
    case "count_per_day": {
      const what = describeFilter(p.filter);
      const constrained = p.min != null || p.max != null;
      const overrides = Object.entries(p.weekdayOverrides ?? {})
        .filter(([, o]) => o)
        .map(([day, o]) => `${day}: ${range(what, o && "min" in o ? o.min : p.min, o && "max" in o ? o.max : p.max)}`);
      if (!constrained) return overrides.length ? `${overrides.map((o) => o.charAt(0).toUpperCase() + o.slice(1)).join(". ")}.` : `Cada día: ${range(what)}.`;
      const base = `Cada día: ${range(what, p.min, p.max)}.`;
      return overrides.length ? `${base} Excepto ${overrides.join("; ")}.` : base;
    }
    case "count_per_week":
      return `Por semana (lun–sáb): como máximo ${p.max} ${describeFilter(p.filter)}.`;
    case "forbid_pair":
      return `No juntar ${describeFilter(p.a)} con ${describeFilter(p.b)} el mismo día.`;
    case "no_repeat":
      return `Un plato no se repite en ${p.days} días${p.exceptNames?.length ? ` (salvo ${p.exceptNames.join(", ")})` : ""}.`;
    case "text":
      return p.text;
  }
}

export const RULE_TYPE_LABELS: Record<RuleParams["type"], string> = {
  count_per_day: "Cantidad por día",
  count_per_week: "Máximo por semana",
  forbid_pair: "No juntar",
  no_repeat: "No repetir",
  text: "Texto libre (para la IA)",
};
