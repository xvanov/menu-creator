import { PageTitle } from "@/components/ui";
import { distinctCategories, listDishes } from "./_lib/dishes";
import { Catalog } from "./catalog";

export const dynamic = "force-dynamic";

export default async function PlatosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const [dishes, categories] = await Promise.all([listDishes({ status: "all" }), distinctCategories()]);
  const status = typeof sp.estado === "string" ? sp.estado : "";
  return (
    <>
      <PageTitle sub="Catálogo">Platos</PageTitle>
      <Catalog dishes={dishes} categories={categories} initialStatus={status} />
    </>
  );
}
