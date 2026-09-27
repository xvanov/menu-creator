import { handle } from "@/lib/generator/http";
import { listRules, restoreDefaultRules } from "@/lib/rules/repo";

/** POST — re-adds any of the original rules that were deleted. Returns { added, rules }. */
export async function POST() {
  return handle(async () => {
    const { added } = await restoreDefaultRules();
    return Response.json({ added, rules: await listRules() });
  });
}
