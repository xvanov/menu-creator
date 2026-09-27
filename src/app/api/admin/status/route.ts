import { ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { llmStatus } from "@/lib/llm";

export const dynamic = "force-dynamic";

/** Diagnostics (behind the PIN): which database this deployment uses and what it holds. Never returns secrets. */
export async function GET() {
  const url = process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL ?? "file:local.db";
  let where: string;
  try {
    const u = new URL(url);
    where = u.protocol === "file:" ? `file (${url})` : `${u.protocol}//${u.host.slice(0, 6)}…${u.host.slice(-22)}`;
  } catch {
    where = "invalid URL";
  }
  const env = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    TURSO_DATABASE_URL: !!process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: !!process.env.TURSO_AUTH_TOKEN,
    DATABASE_AUTH_TOKEN: !!process.env.DATABASE_AUTH_TOKEN,
    APP_PIN: !!process.env.APP_PIN,
    GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    VERCEL_ENV: process.env.VERCEL_ENV ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  };
  try {
    const count = async (t: Parameters<typeof db.$count>[0]) => db.$count(t);
    const counts = {
      menus: await count(schema.menus),
      menuItems: await count(schema.menuItems),
      dishes: await count(schema.dishes),
      recipeItems: await count(schema.recipeItems),
      rules: await count(schema.rules),
    };
    const appMenus = await db
      .select({
        date: schema.menus.date,
        status: schema.menus.status,
        updatedAt: schema.menus.updatedAt,
        items: sql<number>`(select count(*) from menu_items i where i.menu_id = ${schema.menus.id})`,
      })
      .from(schema.menus)
      .where(ne(schema.menus.source, "historial"));
    return Response.json({ database: where, env, counts, appMenus, ai: llmStatus() });
  } catch (e) {
    return Response.json({ database: where, env, error: (e as Error).message }, { status: 500 });
  }
}
