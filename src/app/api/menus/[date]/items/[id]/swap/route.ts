import { z } from "zod";
import { afterItemsChanged, handle, parseDate, parseId, readJson } from "@/lib/generator/http";
import { menuPayload, swapMenuItem } from "@/lib/generator/service";

export const maxDuration = 120;

const bodySchema = z.object({ useLlm: z.boolean().optional() });

export async function POST(req: Request, { params }: { params: Promise<{ date: string; id: string }> }) {
  return handle(async () => {
    const p = await params;
    const date = parseDate(p.date);
    const { useLlm } = bodySchema.parse(await readJson(req));
    const m = await swapMenuItem(date, parseId(p.id), { useLlm });
    await afterItemsChanged(date, { ...m, newDishIds: [] });
    return Response.json(await menuPayload(date));
  });
}
