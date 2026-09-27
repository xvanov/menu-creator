import { recomputeDate } from "@/lib/shopping";
import { dateParam, handle } from "@/lib/shopping/http";

type Ctx = { params: Promise<{ date: string }> };

/** POST — recomputes the list from recipes, portions and storage (keeps edited and manual lines). */
export async function POST(_req: Request, { params }: Ctx) {
  return handle(async () => recomputeDate(dateParam((await params).date)));
}
