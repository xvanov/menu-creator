import { z } from "zod";
import { deleteLine, patchLine } from "@/lib/shopping";
import { body, dateParam, handle, idParam } from "@/lib/shopping/http";
import { UNITS } from "@/lib/types";

type Ctx = { params: Promise<{ date: string; id: string }> };

const schema = z.object({
  quantity: z.number().min(0).optional(),
  note: z.string().max(200).nullable().optional(),
  checked: z.boolean().optional(),
  inStock: z.number().min(0).optional(),
  name: z.string().trim().min(1).max(80).optional(),
  unit: z.enum(UNITS).optional(),
});

/** PATCH — edit quantity to buy (marks the line edited), note, check-off, or what's in storage. */
export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const p = await params;
    return patchLine(dateParam(p.date), idParam(p.id), await body(req, schema));
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const p = await params;
    return deleteLine(dateParam(p.date), idParam(p.id));
  });
}
