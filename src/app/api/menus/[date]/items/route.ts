import { z } from "zod";
import { afterItemsChanged, handle, parseDate, readJson } from "@/lib/generator/http";
import { addMenuItem, menuPayload, reorderMenuItems } from "@/lib/generator/service";

const bodySchema = z.object({
  course: z.enum(["entrada", "segundo", "extra"]),
  name: z.string().optional(),
  dishId: z.number().int().positive().nullish(),
  price: z.number().min(0).nullish(),
  portions: z.number().int().min(0).nullish(),
});

export async function POST(req: Request, { params }: { params: Promise<{ date: string }> }) {
  return handle(async () => {
    const date = parseDate((await params).date);
    const body = bodySchema.parse(await readJson(req));
    const m = await addMenuItem(date, body);
    await afterItemsChanged(date, m);
    return Response.json(await menuPayload(date), { status: 201 });
  });
}

const orderSchema = z.object({ order: z.array(z.number().int().positive()).max(200) });

/** PATCH { order: [itemId, …] } — saves the display order (drag & drop in the editor). No shopping recompute needed. */
export async function PATCH(req: Request, { params }: { params: Promise<{ date: string }> }) {
  return handle(async () => {
    const date = parseDate((await params).date);
    const { order } = orderSchema.parse(await readJson(req));
    await reorderMenuItems(date, order);
    return Response.json(await menuPayload(date));
  });
}
