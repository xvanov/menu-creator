import { z } from "zod";
import { afterItemsChanged, handle, parseDate, parseId, readJson } from "@/lib/generator/http";
import { deleteMenuItem, menuPayload, updateMenuItem } from "@/lib/generator/service";

const patchSchema = z.object({
  name: z.string().optional(),
  dishId: z.number().int().positive().nullish(),
  price: z.number().min(0).nullish(),
  portions: z.number().int().min(0).nullish(),
  pinned: z.boolean().optional(),
});

type Ctx = { params: Promise<{ date: string; id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const p = await params;
    const date = parseDate(p.date);
    const body = patchSchema.parse(await readJson(req));
    const m = await updateMenuItem(date, parseId(p.id), body);
    const onlyPin = Object.keys(body).every((k) => k === "pinned");
    if (!onlyPin) await afterItemsChanged(date, m);
    return Response.json(await menuPayload(date));
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const p = await params;
    const date = parseDate(p.date);
    const m = await deleteMenuItem(date, parseId(p.id));
    await afterItemsChanged(date, m);
    return Response.json(await menuPayload(date));
  });
}
