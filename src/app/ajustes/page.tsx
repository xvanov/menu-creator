import { inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { PageTitle } from "@/components/ui";
import { getSettings } from "@/lib/settings";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function AjustesPage() {
  const settings = await getSettings();
  const extraDishes = settings.defaultExtras.length
    ? await db
        .select({ id: schema.dishes.id, name: schema.dishes.name, price: schema.dishes.price })
        .from(schema.dishes)
        .where(inArray(schema.dishes.name, settings.defaultExtras))
    : [];
  return (
    <>
      <PageTitle sub="Configuración">Ajustes</PageTitle>
      <SettingsForm initial={settings} extraDishes={extraDishes} />
    </>
  );
}
