import { getShoppingView } from "@/lib/shopping";
import { dateParam, handle } from "@/lib/shopping/http";

type Ctx = { params: Promise<{ date: string }> };

/** GET /api/shopping/[date] → ShoppingView (menu: null if there's no menu for that date). */
export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => getShoppingView(dateParam((await params).date)));
}
