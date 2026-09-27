/**
 * Deterministic shopping math (no DB, no LLM) so it can be unit-tested:
 *   needed = Σ over menu items (portions × qtyPerPortion + fixedQty) + kitchen rule lines
 *   to buy = roundBuy(max(0, needed − stock))
 * and the merge that keeps what people edited or added by hand.
 */
import type { Course, SideRiceRule } from "../types";
import { norm } from "../recipes/text";
import { roundBuy } from "./units";

export interface PlanItem {
  menuItemId: number;
  dishId: number | null;
  name: string;
  course: Course;
  portions: number;
}

export interface PlanRecipeItem {
  dishId: number;
  ingredientId: number;
  qtyPerPortion: number;
  fixedQty: number;
  source: string;
  corrections: number;
}

export interface PlanIngredient {
  id: number;
  name: string;
  unit: string;
  storeSection: string;
  stockQty: number;
  alwaysCheckStock: boolean;
}

export interface Contribution {
  kind: "receta" | "regla";
  label: string; // dish (menu item) name or rule description
  menuItemId?: number;
  dishId?: number;
  portions?: number;
  qtyPerPortion?: number;
  fixedQty?: number;
  source?: string;
  corrections?: number;
  qty: number;
}

export interface PlannedLine {
  ingredientId: number;
  name: string;
  unit: string;
  storeSection: string;
  needed: number;
  ruleNeeded: number; // part of `needed` that comes from rules, not recipes
  inStock: number;
  suggested: number;
  source: "calculado" | "regla";
  note: string | null;
  /** alwaysCheckStock ingredient with enough in storage: not listed. */
  hidden: boolean;
  contributions: Contribution[];
}

export interface ShoppingPlan {
  lines: PlannedLine[];
  /** Menu items whose dish has no recipe yet (their ingredients are missing from the list). */
  missingRecipes: PlanItem[];
  /** Menu items without a catalog dish. */
  unlinked: PlanItem[];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function sideRiceQty(items: PlanItem[], rule: SideRiceRule): { qty: number; label: string } | null {
  if (!rule.enabled || rule.basePortions <= 0) return null;
  const segundoPortions = items.filter((i) => i.course === "segundo").reduce((s, i) => s + i.portions, 0);
  if (segundoPortions <= 0) return null;
  const triggers = rule.triggers.map(norm).filter(Boolean);
  const hit = items.find((i) => triggers.some((t) => norm(i.name).includes(t)));
  const base = hit ? rule.withRiceDishKg : rule.defaultKg;
  const qty = round3((base * segundoPortions) / rule.basePortions);
  const why = hit ? `hay ${hit.name.toLocaleLowerCase("es")}: ${base} kg` : `sin tallarín/arroz con pollo/chaufa/jardinera: ${base} kg`;
  return { qty, label: `Arroz blanco de acompañamiento (regla: ${why} por ${rule.basePortions} segundos; hoy ${segundoPortions})` };
}

export function planShopping(input: {
  items: PlanItem[];
  recipes: PlanRecipeItem[];
  ingredients: PlanIngredient[];
  sideRice?: SideRiceRule;
}): ShoppingPlan {
  const ingById = new Map(input.ingredients.map((i) => [i.id, i]));
  const byDish = new Map<number, PlanRecipeItem[]>();
  for (const r of input.recipes) {
    const list = byDish.get(r.dishId) ?? [];
    list.push(r);
    byDish.set(r.dishId, list);
  }

  const contrib = new Map<number, Contribution[]>();
  const add = (ingredientId: number, c: Contribution) => {
    const list = contrib.get(ingredientId) ?? [];
    list.push(c);
    contrib.set(ingredientId, list);
  };

  const missingRecipes: PlanItem[] = [];
  const unlinked: PlanItem[] = [];
  for (const item of input.items) {
    if (item.portions <= 0) continue;
    if (item.dishId == null) {
      unlinked.push(item);
      continue;
    }
    const recipe = byDish.get(item.dishId);
    if (!recipe?.length) {
      missingRecipes.push(item);
      continue;
    }
    for (const r of recipe) {
      if (!ingById.has(r.ingredientId)) continue;
      const qty = item.portions * r.qtyPerPortion + r.fixedQty;
      if (!(qty > 0)) continue;
      add(r.ingredientId, {
        kind: "receta",
        label: item.name,
        menuItemId: item.menuItemId,
        dishId: item.dishId,
        portions: item.portions,
        qtyPerPortion: r.qtyPerPortion,
        fixedQty: r.fixedQty,
        source: r.source,
        corrections: r.corrections,
        qty: round3(qty),
      });
    }
  }

  if (input.sideRice) {
    const rice = input.ingredients.find((i) => norm(i.name) === norm(input.sideRice!.ingredient));
    const side = rice && sideRiceQty(input.items, input.sideRice);
    if (rice && side && side.qty > 0) add(rice.id, { kind: "regla", label: side.label, qty: side.qty });
  }

  const lines: PlannedLine[] = [];
  for (const [ingredientId, cs] of contrib) {
    const ing = ingById.get(ingredientId)!;
    const needed = round3(cs.reduce((s, c) => s + c.qty, 0));
    const ruleNeeded = round3(cs.filter((c) => c.kind === "regla").reduce((s, c) => s + c.qty, 0));
    const inStock = Math.max(0, ing.stockQty);
    const short = needed - inStock;
    const suggested = roundBuy(Math.max(0, short), ing.unit);
    const hidden = ing.alwaysCheckStock && short <= 0;
    let note: string | null = null;
    if (ing.alwaysCheckStock) note = "Suele sobrar: revisar almacén antes de comprar";
    else if (suggested === 0) note = "Alcanza con lo del almacén";
    if (ing.unit === "presa" && norm(ing.name) === "pollo")
      note = [note, "Chuleta/churrasco solo de reserva por si faltan presas"].filter(Boolean).join(" · ");
    lines.push({
      ingredientId,
      name: ing.name,
      unit: ing.unit,
      storeSection: ing.storeSection,
      needed,
      ruleNeeded,
      inStock,
      suggested,
      source: ruleNeeded === needed ? "regla" : "calculado",
      note,
      hidden,
      contributions: cs.sort((a, b) => b.qty - a.qty),
    });
  }
  lines.sort((a, b) => a.storeSection.localeCompare(b.storeSection, "es") || a.name.localeCompare(b.name, "es"));
  return { lines, missingRecipes, unlinked };
}

export interface ExistingLine {
  id: number;
  ingredientId: number | null;
  name: string;
  unit: string;
  needed: number;
  inStock: number;
  quantity: number;
  suggested: number;
  edited: boolean;
  source: "calculado" | "manual" | "regla";
  note: string | null;
  checked: boolean;
}

export type LinePatch = Partial<Omit<ExistingLine, "id">>;
export type NewLine = Omit<ExistingLine, "id" | "checked"> & { position: number };

/**
 * Turns a fresh plan into DB operations:
 * - untouched computed lines take the new values (or are removed when no longer needed);
 * - edited lines keep their `quantity` (and note) but refresh `needed`/`inStock`/`suggested`;
 * - manual lines are never removed; if they point at an ingredient their `needed`/`inStock` are refreshed;
 * - an ingredient already covered by a manual line doesn't get a second computed line.
 */
export function mergeLines(
  existing: ExistingLine[],
  plan: PlannedLine[],
  stockById: Map<number, number>,
): { updates: { id: number; patch: LinePatch }[]; inserts: NewLine[]; deletes: number[] } {
  const updates: { id: number; patch: LinePatch }[] = [];
  const inserts: NewLine[] = [];
  const deletes: number[] = [];
  const planById = new Map(plan.map((p) => [p.ingredientId, p]));
  const covered = new Set<number>();

  for (const e of existing.filter((l) => l.source === "manual")) {
    if (e.ingredientId == null) continue;
    const p = planById.get(e.ingredientId);
    covered.add(e.ingredientId);
    updates.push({
      id: e.id,
      patch: { needed: p?.needed ?? 0, inStock: p?.inStock ?? stockById.get(e.ingredientId) ?? e.inStock, suggested: p?.suggested ?? 0 },
    });
  }

  const seen = new Set<number>();
  for (const e of existing.filter((l) => l.source !== "manual")) {
    const p = e.ingredientId != null ? planById.get(e.ingredientId) : undefined;
    const duplicate = e.ingredientId != null && (seen.has(e.ingredientId) || covered.has(e.ingredientId));
    if (!p || duplicate) {
      if ((e.edited || e.checked) && !duplicate) {
        updates.push({ id: e.id, patch: { needed: 0, suggested: 0, inStock: e.ingredientId != null ? stockById.get(e.ingredientId) ?? e.inStock : e.inStock } });
      } else deletes.push(e.id);
      continue;
    }
    seen.add(p.ingredientId);
    if (e.edited) {
      updates.push({ id: e.id, patch: { name: p.name, unit: p.unit, needed: p.needed, inStock: p.inStock, suggested: p.suggested, source: p.source } });
    } else if (p.hidden) {
      deletes.push(e.id);
    } else {
      updates.push({
        id: e.id,
        patch: { name: p.name, unit: p.unit, needed: p.needed, inStock: p.inStock, suggested: p.suggested, quantity: p.suggested, note: p.note, source: p.source },
      });
    }
  }

  let position = existing.length;
  for (const p of plan) {
    if (p.hidden || seen.has(p.ingredientId) || covered.has(p.ingredientId)) continue;
    inserts.push({
      ingredientId: p.ingredientId,
      name: p.name,
      unit: p.unit,
      needed: p.needed,
      inStock: p.inStock,
      quantity: p.suggested,
      suggested: p.suggested,
      edited: false,
      source: p.source,
      note: p.note,
      position: position++,
    });
  }
  return { updates, inserts, deletes };
}
