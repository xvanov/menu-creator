import { z } from "zod";
import { afterItemsChanged, handle, parseDate, readJson } from "@/lib/generator/http";
import { generateMenuForDate, menuPayload } from "@/lib/generator/service";

export const maxDuration = 300; // LLM generation can take a few minutes with a retry

const bodySchema = z.object({ useLlm: z.boolean().optional() });

export async function POST(req: Request, { params }: { params: Promise<{ date: string }> }) {
  return handle(async () => {
    const date = parseDate((await params).date);
    const { useLlm } = bodySchema.parse(await readJson(req));
    const out = await generateMenuForDate(date, { useLlm });
    await afterItemsChanged(date, { menuId: out.menuId, newDishIds: [] });
    return Response.json({ ...(await menuPayload(date)), note: out.note ?? null });
  });
}
