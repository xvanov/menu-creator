import { listIngredients } from "@/lib/recipes/ingredients";
import { AlmacenClient } from "./almacen-client";

export const dynamic = "force-dynamic";

export default async function AlmacenPage() {
  return <AlmacenClient initial={await listIngredients()} />;
}
