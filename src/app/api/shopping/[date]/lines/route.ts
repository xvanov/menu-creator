import { z } from "zod";
import { addLine } from "@/lib/shopping";
import { body, dateParam, handle } from "@/lib/shopping/http";
import { UNITS } from "@/lib/types";

type Ctx = { params: Promise<{ date: string }> };

const schema = z.object({
  ingredientId: z.number().int().nullish(),
  name: z.string().trim().min(1).max(80),
  unit: z.enum(UNITS).optional(),
  quantity: z.number().min(0),
  note: z.string().max(200).nullish(),
  storeSection: z.string().max(30).optional(),
  saveIngredient: z.boolean().optional(),
});

/** POST — adds a manual line (existing ingredient, new ingredient, or free text). */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => addLine(dateParam((await params).date), await body(req, schema)));
}
