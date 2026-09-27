import { handle, readJson } from "@/lib/generator/http";
import { createRule, listRules } from "@/lib/rules/repo";
import { ruleBodySchema } from "@/lib/rules/schema";

export async function GET() {
  return handle(async () => Response.json(await listRules()));
}

export async function POST(req: Request) {
  return handle(async () => {
    const body = ruleBodySchema.parse(await readJson(req));
    return Response.json(await createRule(body), { status: 201 });
  });
}
