import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { PageTitle } from "@/components/ui";
import { listRules } from "@/lib/rules/repo";
import { RulesEditor } from "./rules-editor";

export const dynamic = "force-dynamic";

export default async function ReglasPage() {
  const [rules, dishes] = await Promise.all([
    listRules(),
    db.select({ name: schema.dishes.name }).from(schema.dishes).orderBy(asc(schema.dishes.name)),
  ]);
  return (
    <>
      <PageTitle sub="Menú del día">Reglas</PageTitle>
      <p className="-mt-3 mb-6 max-w-2xl text-sm text-ink-soft">
        Las reglas obligatorias se revisan en cada menú: el generador no las rompe y no se puede publicar si alguna falla. Las
        preferencias solo dan avisos. Las reglas de texto libre se le pasan a la IA cuando arma el menú.
      </p>
      <RulesEditor initialRules={rules} dishNames={dishes.map((d) => d.name)} />
    </>
  );
}
