import { z } from "zod";
import { getRecipe, saveRecipe } from "@/lib/recipes";
import { body, handle, HttpError, idParam } from "@/lib/shopping/http";
import { UNITS } from "@/lib/types";

type Ctx = { params: Promise<{ dishId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const recipe = await getRecipe(idParam((await params).dishId));
    if (!recipe) throw new HttpError("Plato no encontrado", 404);
    return recipe;
  });
}

const putSchema = z.object({
  items: z.array(
    z.object({
      ingredientId: z.number().int().nullish(),
      name: z.string().max(80),
      unit: z.enum(UNITS).optional(),
      storeSection: z.string().max(30).optional(),
      qtyPerPortion: z.number().min(0),
      fixedQty: z.number().min(0).default(0),
    }),
  ),
});

/** PUT /api/recipes/[dishId] { items } — replaces the recipe; changed items become `manual`. */
export async function PUT(req: Request, { params }: Ctx) {
  return handle(async () => {
    const dishId = idParam((await params).dishId);
    const { items } = await body(req, putSchema);
    const recipe = await saveRecipe(dishId, items);
    if (!recipe) throw new HttpError("Plato no encontrado", 404);
    return recipe;
  });
}
