import { z } from "zod";
import { handle, parseDate, readJson } from "@/lib/generator/http";
import { menuPayload, updateMenu } from "@/lib/generator/service";

const patchSchema = z.object({
  status: z.enum(["borrador", "publicado"]).optional(),
  menuPrice: z.number().positive().optional(),
  /** Publish even with hard rule violations (never with unapproved dishes). */
  force: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ date: string }> }) {
  return handle(async () => {
    const date = parseDate((await params).date);
    return Response.json(await menuPayload(date));
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ date: string }> }) {
  return handle(async () => {
    const date = parseDate((await params).date);
    const body = patchSchema.parse(await readJson(req));
    await updateMenu(date, body);
    return Response.json(await menuPayload(date));
  });
}
