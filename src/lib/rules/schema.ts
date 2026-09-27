/** zod schemas for `RuleParams` (API bodies and LLM structured output). */
import { z } from "zod";
import type { RuleParams } from "@/lib/types";

const count = z.number().int().min(0);

export const dishFilterSchema = z.object({
  course: z.enum(["entrada", "segundo", "extra"]).optional(),
  categories: z.array(z.string()).optional(),
  tagsAny: z.array(z.string()).optional(),
  names: z.array(z.string()).optional(),
});

const minMax = z.object({ min: count.optional(), max: count.optional() });

export const ruleParamsSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("count_per_day"),
    filter: dishFilterSchema,
    min: count.optional(),
    max: count.optional(),
    weekdayOverrides: z
      .object({
        lunes: minMax.optional(),
        martes: minMax.optional(),
        miércoles: minMax.optional(),
        jueves: minMax.optional(),
        viernes: minMax.optional(),
        sábado: minMax.optional(),
        domingo: minMax.optional(),
      })
      .optional(),
  }),
  z.object({ type: z.literal("count_per_week"), filter: dishFilterSchema, max: count }),
  z.object({ type: z.literal("forbid_pair"), a: dishFilterSchema, b: dishFilterSchema }),
  z.object({ type: z.literal("no_repeat"), days: z.number().int().min(1), exceptNames: z.array(z.string()).optional() }),
  z.object({ type: z.literal("text"), text: z.string().min(1) }),
]) satisfies z.ZodType<RuleParams>;

export const ruleBodySchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().nullish(),
  params: ruleParamsSchema,
  hard: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

/** Drops empty filter lists so stored params stay tidy. */
export function cleanParams(p: RuleParams): RuleParams {
  const f = <T extends object>(x: T): T =>
    Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))) as T;
  switch (p.type) {
    case "count_per_day":
      return f({ ...p, filter: f(p.filter), weekdayOverrides: p.weekdayOverrides && Object.keys(f(p.weekdayOverrides)).length ? f(p.weekdayOverrides) : undefined });
    case "count_per_week":
      return { ...p, filter: f(p.filter) };
    case "forbid_pair":
      return { ...p, a: f(p.a), b: f(p.b) };
    case "no_repeat":
      return f(p);
    default:
      return p;
  }
}
