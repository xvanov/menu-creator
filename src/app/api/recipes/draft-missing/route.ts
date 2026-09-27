import { z } from "zod";
import { dishesWithoutRecipe, draftJobStatus, startDraftMissing } from "@/lib/recipes";
import { body, handle } from "@/lib/shopping/http";

/** GET — progress of the "Generar recetas faltantes" job and how many dishes still have no recipe. */
export async function GET() {
  return handle(async () => ({ job: draftJobStatus(), missing: (await dishesWithoutRecipe()).length }));
}

/** POST { limit? } — drafts recipes for dishes with none, most served first, in the background. Poll GET for progress. */
export async function POST(req: Request) {
  return handle(async () => {
    const { limit } = await body(req, z.object({ limit: z.number().int().positive().optional() }));
    const job = await startDraftMissing(limit);
    return { job, missing: (await dishesWithoutRecipe()).length };
  });
}
