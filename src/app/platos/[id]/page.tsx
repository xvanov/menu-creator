import Link from "next/link";
import { notFound } from "next/navigation";
import { RecipeEditor } from "@/components/recipe-editor";
import { Card, PageTitle, SectionHeader } from "@/components/ui";
import { getSettings } from "@/lib/settings";
import { distinctCategories, getDish, recipeCost, servedDates } from "../_lib/dishes";
import { dmy } from "../format";
import { DishForm } from "./dish-form";

export const dynamic = "force-dynamic";

export default async function DishPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const dish = await getDish(id);
  if (!dish) notFound();
  const [cost, served, categories, settings] = await Promise.all([recipeCost(id), servedDates(id), distinctCategories(), getSettings()]);

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/platos">← Platos</Link>
      </div>
      <PageTitle sub={dish.course}>{dish.name}</PageTitle>

      <DishForm
        dish={dish}
        categories={categories}
        computedCost={cost.cost}
        costNote={
          cost.ingredients === 0
            ? "Sin receta todavía"
            : cost.missingPrices > 0
              ? `${cost.missingPrices} de ${cost.ingredients} ingredientes sin precio`
              : `${cost.ingredients} ingredientes`
        }
        portionsFallback={dish.course === "extra" ? settings.extraPortions : settings.defaultPortions}
      />

      <Card>
        <SectionHeader num="02" title="Historial" note={`${served.times} veces`} />
        {served.dates.length ? (
          <ul className="flex flex-wrap gap-2">
            {served.dates.map((d) => (
              <li key={d}>
                <Link href={`/menu/${d}`} className="inline-block bg-page px-2 py-1 font-heading text-sm no-underline">
                  {dmy(d)}
                </Link>
              </li>
            ))}
            {served.times > served.dates.length && <li className="self-center text-sm text-ink-soft">…y {served.times - served.dates.length} más</li>}
          </ul>
        ) : (
          <p className="text-sm text-ink-soft">Todavía no ha salido en ningún menú.</p>
        )}
      </Card>

      <Card>
        <SectionHeader num="03" title="Receta" note="por porción" />
        <RecipeEditor dishId={id} />
      </Card>
    </div>
  );
}
