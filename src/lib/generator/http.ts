import "server-only";
import { ZodError } from "zod";
import { runLater } from "@/lib/background";
import { reclassifyDish } from "@/lib/dishes";
import { onMenuItemsChanged } from "@/lib/shopping";
import { MenuError, refreshWarnings, type ItemMutation } from "./service";

export function parseDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new MenuError("Fecha inválida (usa AAAA-MM-DD).");
  return date;
}

export function parseId(id: string): number {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new MenuError("Id inválido.");
  return n;
}

/** Reads a JSON body; an empty body is `{}`. */
export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new MenuError("El cuerpo no es JSON válido.");
  }
}

/** Runs a route body and maps errors to JSON responses with Spanish messages. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof MenuError) return Response.json({ error: e.message, warnings: e.warnings }, { status: e.status });
    if (e instanceof ZodError) return Response.json({ error: "Datos inválidos.", issues: e.issues }, { status: 400 });
    console.error(e);
    return Response.json({ error: `Error interno: ${(e as Error)?.message ?? e}` }, { status: 500 });
  }
}

/** Background work after a menu's items change: shopping list, then LLM re-classification of new dishes. */
export function afterItemsChanged(date: string, m: ItemMutation): Promise<void> {
  return runLater(async () => {
    try {
      await onMenuItemsChanged(m.menuId);
    } catch (e) {
      console.error("[menus] onMenuItemsChanged falló:", e);
    }
    let changed = false;
    for (const id of m.newDishIds) changed = (await reclassifyDish(id)) || changed;
    if (changed) await refreshWarnings(date).catch((e) => console.error("[menus] refreshWarnings falló:", e));
  });
}
