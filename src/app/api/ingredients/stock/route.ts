import { z } from "zod";
import { applyStock, resetAllStock } from "@/lib/recipes/ingredients";
import { body, handle } from "@/lib/shopping/http";
import { UNITS } from "@/lib/types";

const schema = z.object({
  resetAll: z.boolean().optional(),
  items: z
    .array(
      z.object({
        ingredientId: z.number().int().nullish(),
        name: z.string().trim().min(1).max(80),
        unit: z.enum(UNITS).optional(),
        storeSection: z.string().max(30).optional(),
        qty: z.number().min(0),
      }),
    )
    .default([]),
});

/** POST { items, resetAll? } — sets storage quantities (creating unknown ingredients); resetAll puts everything at 0 first. */
export async function POST(req: Request) {
  return handle(async () => {
    const { items, resetAll } = await body(req, schema);
    const reset = resetAll ? await resetAllStock() : 0;
    const res = await applyStock(items);
    return { ...res, reset };
  });
}
