import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getDish, removeDish } from "@/app/platos/_lib/dishes";
import { dishPatchSchema, isUniqueViolation, zodMessage } from "../schema";

type Ctx = { params: Promise<{ id: string }> };

async function dishId(ctx: Ctx) {
  const id = Number((await ctx.params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const id = await dishId(ctx);
  const dish = id && (await getDish(id));
  if (!dish) return Response.json({ error: "Plato no encontrado" }, { status: 404 });
  return Response.json({ dish });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const id = await dishId(ctx);
  if (!id || !(await getDish(id))) return Response.json({ error: "Plato no encontrado" }, { status: 404 });
  const parsed = dishPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: zodMessage(parsed.error) }, { status: 400 });
  if (!Object.keys(parsed.data).length) return Response.json({ dish: await getDish(id) });
  try {
    const [dish] = await db.update(schema.dishes).set(parsed.data).where(eq(schema.dishes.id, id)).returning();
    return Response.json({ dish });
  } catch (e) {
    if (isUniqueViolation(e)) return Response.json({ error: `Ya existe un plato llamado "${parsed.data.name}"` }, { status: 409 });
    throw e;
  }
}

/** Hard delete, or archive when the dish appears in any menu. Returns `{ result: "eliminado" | "archivado" }`. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const id = await dishId(ctx);
  if (!id || !(await getDish(id))) return Response.json({ error: "Plato no encontrado" }, { status: 404 });
  return Response.json({ result: await removeDish(id) });
}
