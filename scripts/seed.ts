/**
 * Seeds the database from data/*.json. Idempotent and non-destructive: only adds what is missing
 * (settings keys, default rules on an empty rules table, dishes, historical menus for dates without a
 * menu, ingredients), so re-running an install never undoes edits made in the app.
 * `--all` wipes everything first (fresh start).
 *
 *   npm run db:push && npm run db:seed
 */
import "./load-env";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db, schema } from "../src/db";
import { DEFAULT_SETTINGS, type Course, type RuleParams } from "../src/lib/types";

const s = schema;
const load = <T>(f: string): T => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));

type CatalogDish = {
  name: string; courses: Course[]; category: string; base?: string; protein?: string; tags?: string[];
  usual_price?: number;
};
type HistMenu = {
  date: string; menu_price: number | null;
  entradas: { name: string }[]; segundos: { name: string }[]; extras: { name: string; price?: number }[];
};
type Note = { ts: string; service_date?: string; type: string; dish?: string | null; rule?: string; items: { ingredient: string; unit?: string | null }[]; raw: string };
type Plan = { date: string; service: string; portions: { dish: string; portions: number }[] };

// Owner's extras list (2026-09-26), prices override history.
const EXTRAS: { name: string; price: number; category: string; protein: string; tags: string[] }[] = [
  { name: "Trucha frita", price: 20, category: "fritura", protein: "Pescado", tags: ["frito", "pescado"] },
  { name: "Arroz chaufa", price: 15, category: "arroz", protein: "Pollo", tags: [] },
  { name: "Pollo broaster", price: 15, category: "fritura", protein: "Pollo", tags: ["frito"] },
  { name: "Lomo saltado", price: 17, category: "saltado", protein: "Res", tags: [] },
  { name: "Churrasco a lo pobre", price: 20, category: "fritura", protein: "Res", tags: ["frito"] },
];

const DEFAULT_RULES: { name: string; description: string; params: RuleParams; hard?: boolean }[] = [
  {
    name: "Una sopa o crema",
    description: "Siempre exactamente una sopa o crema entre las entradas.",
    params: { type: "count_per_day", filter: { course: "entrada", categories: ["sopa", "crema"] }, min: 1, max: 1 },
  },
  {
    name: "Menestra diaria (menos sábado)",
    description: "Una menestra todos los días; el sábado es opcional.",
    params: { type: "count_per_day", filter: { course: "segundo", categories: ["menestra"] }, min: 1, max: 1, weekdayOverrides: { sábado: { min: 0, max: 1 } } },
  },
  {
    name: "Menestra no va con sopa pesada o de legumbre",
    description: "Cae pesado: si hay menestra, la sopa/crema no puede ser de legumbre ni pesada (crema de arveja, menestrón, shambar, patasca, sancochado…).",
    params: { type: "forbid_pair", a: { course: "entrada", tagsAny: ["legumbre", "pesado"] }, b: { course: "segundo", categories: ["menestra"] } },
  },
  {
    name: "Máximo una fritura",
    description: "Máximo un segundo frito por día; el sábado se permiten dos.",
    params: { type: "count_per_day", filter: { course: "segundo", categories: ["fritura"] }, max: 1, weekdayOverrides: { sábado: { max: 2 } } },
  },
  {
    name: "Chancho una vez por semana",
    description: "Máximo un plato de chancho por semana.",
    params: { type: "count_per_week", filter: { tagsAny: ["cerdo"] }, max: 1 },
  },
  {
    name: "No repetir en 7 días",
    description: "Un plato no vuelve antes de 7 días, salvo los de siempre.",
    params: { type: "no_repeat", days: 7, exceptNames: ["Papa a la huancaína", "Tamal criollo", "Pollo broaster"] },
  },
  {
    name: "Costumbres de la semana",
    description: "Preferencia, no obligación.",
    hard: false,
    params: { type: "text", text: "Lunes: lentejas. Viernes: frijoles. Martes: garbanzo, frijol panamito o pallares. Miércoles y jueves: arvejita partida. No más de dos guisos de pollo el mismo día." },
  },
];

function storeSection(name: string): string {
  const n = name.toLowerCase();
  if (/pollo|presa|molleja|gallina|huevo/.test(n)) return "pollería";
  if (/res|carne|churrasco|chuleta|bistec|lomo|chancho|cerdo|hígado|mondongo|pata|asado/.test(n)) return "carnicería";
  if (/pescado|trucha|bonito|choro|atún/.test(n)) return "pescadería";
  if (/arroz|aceite|azúcar|sal\b|fideo|tallar|harina|leche|galleta|sillao|vinagre|pomarola|doña gusto|ajinomoto|sibarita|palillo|tuco|lenteja|frijol|pallar|garbanzo|arveja partida|quinua|trigo|maní|mostaza|pimienta|comino|orégano|laurel|pasas|chuño|mayonesa|lata|conserva|té/.test(n)) return "abarrotes";
  return "mercado";
}

async function main() {
  const all = process.argv.includes("--all");
  const catalog = load<CatalogDish[]>("dishes.json");
  const menus = load<HistMenu[]>("menus.json");
  const notes = load<Note[]>("shopping_notes.json");
  const plans = load<Plan[]>("portion_plans.json");

  if (all) {
    for (const t of [s.shoppingLines, s.menuItems, s.menus, s.recipeItems, s.corrections, s.dishes, s.ingredients, s.rules, s.settings])
      await db.delete(t);
  }

  // settings: add missing keys only
  await db
    .insert(s.settings)
    .values(Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value })))
    .onConflictDoNothing();

  // rules: defaults only on an empty table (the owner may have deleted some on purpose)
  if ((await db.select({ id: s.rules.id }).from(s.rules).limit(1)).length === 0)
    await db.insert(s.rules).values(DEFAULT_RULES.map((r) => ({ ...r, hard: r.hard ?? true })));

  // dishes: add missing ones, never overwrite edits
  const lunchSeed = new Map<string, number>();
  for (const p of plans.filter((p) => p.service === "almuerzo")) for (const x of p.portions) lunchSeed.set(x.dish, x.portions);
  const extraByName = new Map(EXTRAS.map((e) => [e.name, e]));
  const rows = catalog.map((d) => {
    const extra = extraByName.get(d.name);
    return {
      name: d.name,
      course: (d.courses.includes("segundo") ? "segundo" : d.courses[0]) as Course,
      category: d.category,
      base: d.base ?? null,
      protein: d.protein ?? null,
      tags: d.tags ?? [],
      price: extra?.price ?? d.usual_price ?? null,
      defaultPortions: lunchSeed.get(d.name) ?? null,
    };
  });
  for (const e of EXTRAS) {
    if (!rows.some((r) => r.name === e.name))
      rows.push({ name: e.name, course: "extra", category: e.category, base: null, protein: e.protein, tags: e.tags, price: e.price, defaultPortions: null });
  }
  for (const r of rows) await db.insert(s.dishes).values(r).onConflictDoNothing();
  const dishIds = new Map((await db.select({ id: s.dishes.id, name: s.dishes.name }).from(s.dishes)).map((d) => [d.name, d.id]));

  // historical menus: only dates that have no menu yet
  const existingDates = new Set((await db.select({ date: s.menus.date }).from(s.menus)).map((m) => m.date));
  for (const m of menus) {
    if (existingDates.has(m.date)) continue; // keep app-made menus
    const [menu] = await db
      .insert(s.menus)
      .values({ date: m.date, status: "publicado", source: "historial", menuPrice: m.menu_price ?? DEFAULT_SETTINGS.menuPrice })
      .returning({ id: s.menus.id });
    const items = [
      ...m.entradas.map((i) => ({ ...i, course: "entrada" as const, price: undefined })),
      ...m.segundos.map((i) => ({ ...i, course: "segundo" as const, price: undefined })),
      ...m.extras.map((i) => ({ ...i, course: "extra" as const })),
    ];
    await db.insert(s.menuItems).values(
      items.map((i, position) => ({ menuId: menu.id, dishId: dishIds.get(i.name) ?? null, name: i.name, course: i.course, price: i.price ?? null, position })),
    );
  }

  // ingredients seen in the chat (units: most common)
  const units = new Map<string, Map<string, number>>();
  for (const n of notes)
    for (const it of n.items ?? []) {
      if (!it.ingredient) continue;
      const m = units.get(it.ingredient) ?? new Map<string, number>();
      if (it.unit) m.set(it.unit, (m.get(it.unit) ?? 0) + 1);
      units.set(it.ingredient, m);
    }
  // routinely overstocked in the chat: only list when stock is low (default for new rows only)
  const overstocked = new Set(["Azúcar", "Limón", "Cebolla roja"]);
  for (const [name, m] of units) {
    const unit = [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "kg";
    await db
      .insert(s.ingredients)
      .values({ name, unit, storeSection: storeSection(name), alwaysCheckStock: overstocked.has(name) })
      .onConflictDoNothing();
  }

  // chat knowledge
  await db.delete(s.shoppingNotes);
  for (let i = 0; i < notes.length; i += 100)
    await db.insert(s.shoppingNotes).values(
      notes.slice(i, i + 100).map((n) => ({ ts: n.ts, serviceDate: n.service_date ?? null, type: n.type, dish: n.dish ?? null, rule: n.rule ?? null, items: n.items, raw: n.raw })),
    );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const count = async (t: any) => (await db.select({ n: sql<number>`count(*)` }).from(t))[0].n;
  console.log({
    dishes: await count(s.dishes), menus: await count(s.menus), menuItems: await count(s.menuItems),
    ingredients: await count(s.ingredients), rules: await count(s.rules), notes: await count(s.shoppingNotes),
  });
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
