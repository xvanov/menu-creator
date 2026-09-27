import { z } from "zod";
import { handle, readJson } from "@/lib/generator/http";
import { parseRuleText } from "@/lib/rules/repo";

export const maxDuration = 120;

const bodySchema = z.object({ text: z.string().trim().min(3) });

/** Free text → proposed rule (not saved). 503 with a Spanish message when the LLM is unavailable. */
export async function POST(req: Request) {
  return handle(async () => {
    const { text } = bodySchema.parse(await readJson(req));
    try {
      return Response.json(await parseRuleText(text));
    } catch (e) {
      console.warn("[rules] parse falló:", (e as Error).message);
      return Response.json(
        { error: "La IA no pudo interpretar la regla. Puedes armarla con el formulario o guardarla como texto libre." },
        { status: 503 },
      );
    }
  });
}
