import { z } from "zod";
import { draftRecipes, getRecipe } from "@/lib/recipes";
import { body, handle, HttpError, idParam } from "@/lib/shopping/http";

export const maxDuration = 300;

type Ctx = { params: Promise<{ dishId: string }> };

/** POST /api/recipes/[dishId]/draft { overwrite? } — (re)drafts with the LLM; keeps manual/learned items unless overwrite. */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const dishId = idParam((await params).dishId);
    const { overwrite } = await body(req, z.object({ overwrite: z.boolean().default(false) }));
    if (!(await getRecipe(dishId))) throw new HttpError("Plato no encontrado", 404);
    const outcome = await draftRecipes([dishId], { overwrite });
    return { outcome, recipe: await getRecipe(dishId) };
  });
}
