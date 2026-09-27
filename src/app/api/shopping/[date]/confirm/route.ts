import { confirm } from "@/lib/shopping";
import { dateParam, handle } from "@/lib/shopping/http";

type Ctx = { params: Promise<{ date: string }> };

/** POST — "Confirmar cantidades": learns from edited lines and portions. Returns { view, summary }. */
export async function POST(_req: Request, { params }: Ctx) {
  return handle(async () => confirm(dateParam((await params).date)));
}
