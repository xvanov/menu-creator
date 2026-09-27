import { NextRequest } from "next/server";
import { count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { afterItemsChanged, handle, parseDate } from "@/lib/generator/http";
import { findMenu, generateMenuForDate } from "@/lib/generator/service";
import { tomorrow } from "@/lib/menus";
import { getSettings } from "@/lib/settings";
import { weekdayOf } from "@/lib/types";

export const maxDuration = 300;

const g = globalThis as unknown as { __menuCronRunning?: boolean };

function limaTime(): string {
  return new Date().toLocaleTimeString("en-GB", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * Generates tomorrow's menu (Lima time) unless it already exists. Called by Vercel Cron and by
 * the local scheduler in src/instrumentation.ts (with `?auto=1`, which also waits for
 * settings.generateAt). Query: `date` (override), `llm=0` (rules only).
 * When CRON_SECRET is set, requires `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "No autorizado." }, { status: 401 });

    const q = req.nextUrl.searchParams;
    const date = parseDate(q.get("date") ?? tomorrow());
    if (weekdayOf(date) === "domingo") return Response.json({ date, status: "skipped", reason: "domingo: cerrado" });
    if (q.get("auto") === "1") {
      const { generateAt } = await getSettings();
      if (limaTime() < generateAt) return Response.json({ date, status: "skipped", reason: `todavía no son las ${generateAt}` });
    }
    const existing = await findMenu(date);
    if (existing) {
      const [{ n }] = await db.select({ n: count() }).from(schema.menuItems).where(eq(schema.menuItems.menuId, existing.id));
      if (n > 0) return Response.json({ date, status: "skipped", reason: "ya existe un menú" });
    }
    if (g.__menuCronRunning) return Response.json({ date, status: "skipped", reason: "ya se está generando" });
    g.__menuCronRunning = true;
    try {
      const out = await generateMenuForDate(date, { useLlm: q.get("llm") !== "0" });
      await afterItemsChanged(date, { menuId: out.menuId, newDishIds: [] });
      return Response.json({ date, status: "generated", usedLlm: out.usedLlm, note: out.note ?? null });
    } finally {
      g.__menuCronRunning = false;
    }
  });
}
