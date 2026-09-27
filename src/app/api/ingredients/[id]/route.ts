import type { NextRequest } from "next/server";
import { ingredientPatchSchema as patchSchema } from "@/lib/recipes/ingredient-schema";
import { deleteIngredient, updateIngredient } from "@/lib/recipes/ingredients";
import { body, handle, HttpError, idParam } from "@/lib/shopping/http";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH — name, unit, section, price, storage (stockQty) or alwaysCheckStock. */
export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = idParam((await params).id);
    const ingredient = await updateIngredient(id, await body(req, patchSchema));
    if (!ingredient) throw new HttpError("Ingrediente no encontrado", 404);
    return { ingredient };
  });
}

/** DELETE ?force=1 also removes it from the recipes that use it. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const id = idParam((await params).id);
    const res = await deleteIngredient(id, req.nextUrl.searchParams.get("force") === "1");
    if (!res.ok) return Response.json({ error: `Se usa en ${res.recipes} receta(s)`, recipes: res.recipes }, { status: 409 });
    return res;
  });
}
