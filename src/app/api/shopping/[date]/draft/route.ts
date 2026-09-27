import { draftMissingForMenu, getMenuByDate, getShoppingView } from "@/lib/shopping";
import { dateParam, handle, HttpError } from "@/lib/shopping/http";

export const maxDuration = 300;

type Ctx = { params: Promise<{ date: string }> };

/** POST — drafts (LLM) the recipes missing for this menu's dishes, then recomputes. */
export async function POST(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const date = dateParam((await params).date);
    const menu = await getMenuByDate(date);
    if (!menu) throw new HttpError("No hay menú para esta fecha", 404);
    const outcome = await draftMissingForMenu(menu.id);
    return { outcome, view: await getShoppingView(date) };
  });
}
