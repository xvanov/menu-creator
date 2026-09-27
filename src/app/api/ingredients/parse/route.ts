import { z } from "zod";
import { parseStockText } from "@/lib/recipes/ingredients";
import { body, handle } from "@/lib/shopping/http";

export const maxDuration = 120;

/** POST { text } — "Hay 7 kilos de arroz, 3 aceites…" → preview items (LLM). Doesn't change storage. */
export async function POST(req: Request) {
  return handle(async () => {
    const { text } = await body(req, z.object({ text: z.string().trim().min(1).max(4000) }));
    const res = await parseStockText(text);
    return res.ok ? res : Response.json(res, { status: 503 });
  });
}
