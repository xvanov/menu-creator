import { z } from "zod";
import { body, handle } from "@/lib/shopping/http";
import { getVendorsView, saveVendors } from "@/lib/shopping/vendors";

const name = z.string().trim().max(30);
const vendorsSchema = z.object({
  vendors: z.array(name).max(100),
  moves: z.array(z.object({ from: z.string().max(30), to: name })).max(100).optional(),
});

/** GET /api/ingredients/vendors → { vendors, usage } */
export async function GET() {
  return handle(getVendorsView);
}

/** PUT /api/ingredients/vendors { vendors, moves? } — saves the list; `moves` reassign ingredients (rename/remove a vendor). */
export async function PUT(req: Request) {
  return handle(async () => {
    const input = await body(req, vendorsSchema);
    return saveVendors(input.vendors, input.moves);
  });
}
