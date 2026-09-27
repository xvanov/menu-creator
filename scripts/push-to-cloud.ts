/**
 * Copies work done in the local app (local.db) to the cloud database (Turso): menus made in the app with their
 * items and shopping lists, dishes the cloud doesn't have, recipes the cloud doesn't have, missing ingredients.
 * Safe by default: a cloud menu that already has dishes is not touched unless --overwrite.
 *
 *   npm run push:cloud                       # all menus made in the app
 *   npm run push:cloud -- --date 2026-09-28  # one day
 *   npm run push:cloud -- --overwrite        # replace cloud menus on the same dates
 *   npm run push:cloud -- --rules --settings # also replace the cloud's rules / settings
 *   npm run push:cloud -- --list             # just show the menus on both sides
 *   npm run push:cloud -- --recipes-only     # only recipes (and the dishes/ingredients they need)
 *
 * Source defaults to local.db; set SOURCE_DATABASE_URL (+ SOURCE_DATABASE_AUTH_TOKEN) to copy from another
 * database, e.g. a Turso point-in-time restore. CLOUD_DATABASE_URL / CLOUD_DATABASE_AUTH_TOKEN override the target.
 *
 * Cloud credentials: DATABASE_URL + DATABASE_AUTH_TOKEN (or TURSO_*) in .env.deploy, else it asks.
 * Copy them from Vercel → Project → Settings → Environment Variables (or Storage → your Turso DB).
 */
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { createClient } from "@libsql/client";
import { eq, inArray, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../src/db/schema";

const { dishes, ingredients, recipeItems, menus, menuItems, shoppingLines, rules, settings } = schema;
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const onlyDate = args.includes("--date") ? args[args.indexOf("--date") + 1] : null;

function readDeployConfig(): Record<string, string> {
  if (!existsSync(".env.deploy")) return {};
  return Object.fromEntries(
    readFileSync(".env.deploy", "utf8")
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => [m[1], m[2].replace(/^"(.*)"$/, "$1")]),
  );
}

async function main() {
  const cfg = { ...readDeployConfig(), ...process.env } as Record<string, string | undefined>;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const url =
    cfg.CLOUD_DATABASE_URL || cfg.DATABASE_URL || cfg.TURSO_DATABASE_URL || (await rl.question("Cloud database URL (libsql://…, Vercel env TURSO_DATABASE_URL): ")).trim();
  const authToken =
    cfg.CLOUD_DATABASE_AUTH_TOKEN ?? cfg.DATABASE_AUTH_TOKEN ?? cfg.TURSO_AUTH_TOKEN ?? ((await rl.question("Cloud auth token (TURSO_AUTH_TOKEN): ")).trim() || undefined);
  rl.close();
  if (!/^(libsql|https?|wss?):\/\//.test(url)) throw new Error("That doesn't look like a Turso URL (libsql://…).");

  // source: this computer's local.db, or any other database (e.g. a Turso point-in-time restore)
  const local = drizzle(createClient({ url: process.env.SOURCE_DATABASE_URL ?? "file:local.db", authToken: process.env.SOURCE_DATABASE_AUTH_TOKEN }), { schema });
  const cloud = drizzle(createClient({ url, authToken }), { schema });

  if (flag("--list")) {
    for (const [label, db] of [["this computer / source", local], ["cloud", cloud]] as const) {
      const rows = await db.select({ id: menus.id, date: menus.date, status: menus.status, updatedAt: menus.updatedAt }).from(menus).where(ne(menus.source, "historial"));
      console.log(`\n${label}: menus made in the app`);
      for (const m of rows) console.log(`  ${m.date}  ${m.status.padEnd(10)} ${await db.$count(menuItems, eq(menuItems.menuId, m.id))} dishes  (updated ${m.updatedAt})`);
      if (!rows.length) console.log("  (none)");
    }
    return;
  }

  // ---- which menus (none with --recipes-only)
  const recipesOnly = flag("--recipes-only");
  const localMenus = recipesOnly
    ? []
    : await local
        .select()
        .from(menus)
        .where(onlyDate ? eq(menus.date, onlyDate) : ne(menus.source, "historial"));
  if (!recipesOnly && !localMenus.length) throw new Error(onlyDate ? `No local menu on ${onlyDate}.` : "No menus made in the app locally.");
  const localItems = localMenus.length ? await local.select().from(menuItems).where(inArray(menuItems.menuId, localMenus.map((m) => m.id))) : [];

  // ---- dishes (by name): used by those menus + every dish with a local recipe
  const localDishes = await local.select().from(dishes);
  const localRecipes = await local.select().from(recipeItems);
  const neededDishIds = new Set([...localItems.map((i) => i.dishId), ...localRecipes.map((r) => r.dishId)].filter((x): x is number => x != null));
  const cloudDishId = new Map((await cloud.select({ id: dishes.id, name: dishes.name }).from(dishes)).map((d) => [d.name, d.id]));
  let dishesAdded = 0;
  for (const d of localDishes.filter((d) => neededDishIds.has(d.id))) {
    if (cloudDishId.has(d.name)) continue;
    const { id: _id, createdAt: _c, ...rest } = d;
    void _id;
    void _c;
    const [row] = await cloud.insert(dishes).values(rest).returning({ id: dishes.id });
    cloudDishId.set(d.name, row.id);
    dishesAdded++;
  }
  const dishMap = new Map(localDishes.map((d) => [d.id, cloudDishId.get(d.name) ?? null]));

  // ---- ingredients (by name)
  const localIngredients = await local.select().from(ingredients);
  const cloudIngId = new Map((await cloud.select({ id: ingredients.id, name: ingredients.name }).from(ingredients)).map((i) => [i.name, i.id]));
  let ingredientsAdded = 0;
  for (const i of localIngredients) {
    if (cloudIngId.has(i.name)) continue;
    const { id: _id, ...rest } = i;
    void _id;
    const [row] = await cloud.insert(ingredients).values(rest).returning({ id: ingredients.id });
    cloudIngId.set(i.name, row.id);
    ingredientsAdded++;
  }
  const ingMap = new Map(localIngredients.map((i) => [i.id, cloudIngId.get(i.name)!]));

  // ---- recipes: only for dishes the cloud has no recipe for
  const cloudRecipeDishes = new Set((await cloud.select({ d: recipeItems.dishId }).from(recipeItems)).map((r) => r.d));
  let recipesAdded = 0;
  const byDish = new Map<number, typeof localRecipes>();
  for (const r of localRecipes) byDish.set(r.dishId, [...(byDish.get(r.dishId) ?? []), r]);
  for (const [localDishId, items] of byDish) {
    const target = dishMap.get(localDishId);
    if (!target || cloudRecipeDishes.has(target)) continue;
    await cloud.insert(recipeItems).values(items.map(({ id: _id, ...r }) => (void _id, { ...r, dishId: target, ingredientId: ingMap.get(r.ingredientId)! })));
    recipesAdded++;
  }

  // ---- menus
  const report: string[] = [];
  for (const m of localMenus) {
    const items = localItems.filter((i) => i.menuId === m.id);
    const [existing] = await cloud.select().from(menus).where(eq(menus.date, m.date));
    let menuId: number;
    const fields = { status: m.status, menuPrice: m.menuPrice, source: m.source, reasoning: m.reasoning, warnings: m.warnings, updatedAt: m.updatedAt };
    if (existing) {
      const n = await cloud.$count(menuItems, eq(menuItems.menuId, existing.id));
      if (n > 0 && !flag("--overwrite")) {
        report.push(`${m.date}: skipped (the cloud menu already has ${n} dishes; use --overwrite to replace it)`);
        continue;
      }
      await cloud.delete(shoppingLines).where(eq(shoppingLines.menuId, existing.id));
      await cloud.delete(menuItems).where(eq(menuItems.menuId, existing.id));
      await cloud.update(menus).set(fields).where(eq(menus.id, existing.id));
      menuId = existing.id;
    } else {
      const [row] = await cloud.insert(menus).values({ date: m.date, ...fields }).returning({ id: menus.id });
      menuId = row.id;
    }
    if (items.length)
      await cloud.insert(menuItems).values(items.map(({ id: _id, ...i }) => (void _id, { ...i, menuId, dishId: i.dishId != null ? dishMap.get(i.dishId) ?? null : null })));
    const lines = await local.select().from(shoppingLines).where(eq(shoppingLines.menuId, m.id));
    if (lines.length)
      await cloud
        .insert(shoppingLines)
        .values(lines.map(({ id: _id, ...l }) => (void _id, { ...l, menuId, ingredientId: l.ingredientId != null ? ingMap.get(l.ingredientId) ?? null : null })));
    report.push(`${m.date}: copied (${items.length} dishes, ${lines.length} shopping lines, ${m.status})`);
  }

  // ---- optional: rules / settings (replace)
  if (flag("--rules")) {
    const r = await local.select().from(rules);
    await cloud.delete(rules);
    if (r.length) await cloud.insert(rules).values(r.map(({ id: _id, ...x }) => (void _id, x)));
    report.push(`rules: replaced with the ${r.length} local rules`);
  }
  if (flag("--settings")) {
    for (const s of await local.select().from(settings))
      await cloud.insert(settings).values(s).onConflictDoUpdate({ target: settings.key, set: { value: s.value } });
    report.push("settings: copied");
  }

  console.log(`\nDishes added: ${dishesAdded} · ingredients added: ${ingredientsAdded} · recipes added: ${recipesAdded}`);
  for (const line of report) console.log(`  ${line}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`\n✖ ${(e as Error).message}`);
    process.exit(1);
  },
);
