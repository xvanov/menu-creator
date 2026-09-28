import { listIngredients } from "@/lib/recipes/ingredients";
import { getVendorsView } from "@/lib/shopping/vendors";
import { AlmacenClient } from "./almacen-client";

export const dynamic = "force-dynamic";

export default async function AlmacenPage() {
  const [ingredients, vendors] = await Promise.all([listIngredients(), getVendorsView()]);
  return <AlmacenClient initial={ingredients} initialVendors={vendors} />;
}
