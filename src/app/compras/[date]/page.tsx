import { notFound } from "next/navigation";
import { listIngredients } from "@/lib/recipes/ingredients";
import { getShoppingView } from "@/lib/shopping";
import { ShoppingClient } from "./shopping-client";

export const dynamic = "force-dynamic";

export default async function ComprasPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const [view, ingredients] = await Promise.all([getShoppingView(date), listIngredients()]);
  return (
    <ShoppingClient
      initial={view}
      ingredients={ingredients.map((i) => ({ id: i.id, name: i.name, unit: i.unit, storeSection: i.storeSection, stockQty: i.stockQty }))}
    />
  );
}
