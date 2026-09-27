import { and, asc, gte, isNotNull, ne, or } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { MenuEditor } from "@/components/menu-editor";
import { daysAgo, getMenuPayload } from "@/lib/menus";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function MenuPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00`).getTime())) notFound();

  const since = daysAgo(2);
  const [payload, settings, defaults, upcoming] = await Promise.all([
    getMenuPayload(date),
    getSettings(),
    db
      .select({ id: schema.dishes.id, defaultPortions: schema.dishes.defaultPortions, price: schema.dishes.price })
      .from(schema.dishes)
      .where(or(isNotNull(schema.dishes.defaultPortions), isNotNull(schema.dishes.price))),
    db
      .select({ date: schema.menus.date, status: schema.menus.status })
      .from(schema.menus)
      .where(and(ne(schema.menus.source, "historial"), gte(schema.menus.date, since)))
      .orderBy(asc(schema.menus.date))
      .limit(12),
  ]);
  const dishDefaults = Object.fromEntries(defaults.map((d) => [d.id, { defaultPortions: d.defaultPortions, price: d.price }]));

  return (
    <MenuEditor
      key={date}
      initial={payload}
      settings={{ menuPrice: settings.menuPrice, defaultPortions: settings.defaultPortions, extraPortions: settings.extraPortions }}
      dishDefaults={dishDefaults}
      upcoming={upcoming}
    />
  );
}
