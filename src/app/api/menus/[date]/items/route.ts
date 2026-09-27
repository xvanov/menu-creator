import { z } from "zod";
import { afterItemsChanged, handle, parseDate, readJson } from "@/lib/generator/http";
import { addMenuItem, menuPayload } from "@/lib/generator/service";

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
