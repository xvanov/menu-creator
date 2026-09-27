import { and, asc, desc, gte, inArray, lt, sql } from "drizzle-orm";
import Link from "next/link";
import { db, schema } from "@/db";
import { Badge, Card, PageTitle, SectionHeader } from "@/components/ui";
import { tomorrow } from "@/lib/menus";
import { weekdayOf, type Course } from "@/lib/types";

export const dynamic = "force-dynamic";

const { menus, menuItems } = schema;

const monthLabel = (ym: string) => {
  const s = new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric" }).format(new Date(`${ym}-15T12:00:00`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const nextMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

export default async function HistorialPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const months = (
    await db
      .selectDistinct({ ym: sql<string>`substr(${menus.date}, 1, 7)` })
      .from(menus)
      .orderBy(desc(sql`substr(${menus.date}, 1, 7)`))
  ).map((r) => r.ym);

  const requested = typeof sp.mes === "string" && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : null;
  const current = tomorrow().slice(0, 7);
  const ym = requested ?? (months.includes(current) ? current : (months[0] ?? current));

  const monthMenus = await db
    .select()
    .from(menus)
    .where(and(gte(menus.date, `${ym}-01`), lt(menus.date, `${nextMonth(ym)}-01`)))
    .orderBy(asc(menus.date));
  const items = monthMenus.length
    ? await db
        .select({ menuId: menuItems.menuId, name: menuItems.name, course: menuItems.course })
        .from(menuItems)
        .where(inArray(menuItems.menuId, monthMenus.map((m) => m.id)))
        .orderBy(asc(menuItems.position), asc(menuItems.id))
    : [];
  const byMenu = new Map<number, Record<Course, string[]>>();
  for (const it of items) {
    const g = byMenu.get(it.menuId) ?? { entrada: [], segundo: [], extra: [] };
    g[it.course].push(it.name);
    byMenu.set(it.menuId, g);
  }

  // Group by week (Mon–Sat), keyed by the Monday.
  const weeks = new Map<string, typeof monthMenus>();
  for (const m of monthMenus) {
    const d = new Date(`${m.date}T12:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = d.toLocaleDateString("en-CA");
    weeks.set(key, [...(weeks.get(key) ?? []), m]);
  }

  const idx = months.indexOf(ym);
  const newer = idx > 0 ? months[idx - 1] : null;
  const older = idx >= 0 && idx < months.length - 1 ? months[idx + 1] : null;

  return (
    <>
      <PageTitle sub="Historial">{monthLabel(ym)}</PageTitle>

      <nav aria-label="Meses" className="mb-6 flex flex-wrap items-center gap-2">
        {older && (
          <Link href={`/historial?mes=${older}`} className="border-2 border-ink bg-paper px-3 py-1 font-heading text-sm uppercase text-ink no-underline hover:bg-yellow">
            ← {monthLabel(older)}
          </Link>
        )}
        {newer && (
          <Link href={`/historial?mes=${newer}`} className="border-2 border-ink bg-paper px-3 py-1 font-heading text-sm uppercase text-ink no-underline hover:bg-yellow">
            {monthLabel(newer)} →
          </Link>
        )}
        <details className="relative">
          <summary className="cursor-pointer px-2 py-1 font-heading text-sm uppercase text-red">Todos los meses</summary>
          <div className="absolute z-10 mt-1 flex max-h-72 w-56 flex-col overflow-auto border-2 border-ink bg-paper">
            {months.map((m) => (
              <Link key={m} href={`/historial?mes=${m}`} className={`px-3 py-1 text-sm no-underline ${m === ym ? "bg-yellow text-ink" : "text-ink hover:bg-yellow/50"}`}>
                {monthLabel(m)}
              </Link>
            ))}
          </div>
        </details>
      </nav>

      {monthMenus.length === 0 && (
        <Card>
          <p className="text-sm">No hay menús en este mes.</p>
        </Card>
      )}

      <div className="space-y-8">
        {[...weeks.entries()].map(([monday, list], wi) => (
          <section key={monday}>
            <SectionHeader num={String(wi + 1).padStart(2, "0")} title={`Semana del ${Number(monday.slice(8))}`} note={`${list.length} días`} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((m) => {
                const g = byMenu.get(m.id) ?? { entrada: [], segundo: [], extra: [] };
                return (
                  <Link key={m.id} href={`/menu/${m.date}`} className="block bg-paper p-3 text-ink no-underline shadow-[0_1px_0_var(--line)] hover:outline-2 hover:outline-orange">
                    <div className="mb-1.5 flex items-baseline gap-2 border-b-2 border-orange pb-1">
                      <span className="font-heading text-2xl font-bold leading-none">{Number(m.date.slice(8))}</span>
                      <span className="font-heading text-sm uppercase tracking-wider text-red">{weekdayOf(m.date)}</span>
                      <span className="ml-auto">
                        <Badge tone={m.status === "publicado" ? "neutral" : "orange"}>{m.status}</Badge>
                      </span>
                    </div>
                    <DayList label="Entradas" names={g.entrada} />
                    <DayList label="Segundos" names={g.segundo} />
                    {g.extra.length > 0 && <DayList label="Extras" names={g.extra} soft />}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function DayList({ label, names, soft }: { label: string; names: string[]; soft?: boolean }) {
  return (
    <p className={`mt-1 text-sm leading-snug ${soft ? "text-ink-soft" : ""}`}>
      <span className="font-heading text-[11px] font-semibold uppercase tracking-wider text-orange">{label} </span>
      {names.length ? names.join(" · ") : "—"}
    </p>
  );
}
