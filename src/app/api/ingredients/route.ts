import type { NextRequest } from "next/server";
import { ingredientCreateSchema } from "@/lib/recipes/ingredient-schema";
import { createIngredient, listIngredients } from "@/lib/recipes/ingredients";
import { norm } from "@/lib/recipes/text";
import { body, handle } from "@/lib/shopping/http";
import { getVendors } from "@/lib/shopping/vendors";

/** GET /api/ingredients?q= — all ingredients (accent-insensitive filter) and the vendor list. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = norm(req.nextUrl.searchParams.get("q") ?? "");
    const [all, vendors] = await Promise.all([listIngredients(), getVendors()]);
    return { ingredients: q ? all.filter((i) => norm(i.name).includes(q)) : all, vendors };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const input = await body(req, ingredientCreateSchema);
    try {
      return Response.json({ ingredient: await createIngredient(input) }, { status: 201 });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.startsWith("Ya existe")) return Response.json({ error: msg }, { status: 409 });
      throw e;
    }
  });
}
