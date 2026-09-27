import { handle, parseId, readJson } from "@/lib/generator/http";
import { MenuError } from "@/lib/generator/service";
import { deleteRule, rulePatchSchema, updateRule } from "@/lib/rules/repo";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = parseId((await params).id);
    const rule = await updateRule(id, rulePatchSchema.parse(await readJson(req)));
    if (!rule) throw new MenuError("Esa regla no existe.", 404);
    return Response.json(rule);
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = parseId((await params).id);
    if (!(await deleteRule(id))) throw new MenuError("Esa regla no existe.", 404);
    return Response.json({ ok: true });
  });
}
