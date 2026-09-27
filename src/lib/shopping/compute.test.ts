import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../types";
import { mergeLines, planShopping, sideRiceQty, type ExistingLine, type PlanIngredient, type PlanItem } from "./compute";
import { convert, roundBuy, shoppingWhatsapp } from "./units";

const ing = (id: number, name: string, unit = "kg", extra: Partial<PlanIngredient> = {}): PlanIngredient => ({
  id,
  name,
  unit,
  storeSection: "mercado",
  stockQty: 0,
  alwaysCheckStock: false,
  ...extra,
});
const item = (menuItemId: number, dishId: number | null, name: string, portions = 20, course: PlanItem["course"] = "segundo"): PlanItem => ({
  menuItemId,
  dishId,
  name,
  course,
  portions,
});

describe("roundBuy", () => {
  it("rounds kg to 0.5 with a small tolerance", () => {
    expect(roundBuy(4.2, "kg")).toBe(4.5);
    expect(roundBuy(5.02, "kg")).toBe(5);
    expect(roundBuy(0.7, "kg")).toBe(0.75);
    expect(roundBuy(0.12, "kg")).toBe(0.2);
    expect(roundBuy(0.004, "kg")).toBe(0.1);
  });
  it("rounds countable units to whole numbers and grams to 50", () => {
    expect(roundBuy(19.3, "presa")).toBe(20);
    expect(roundBuy(20.05, "presa")).toBe(20);
    expect(roundBuy(2.5, "unidad")).toBe(3);
    expect(roundBuy(230, "g")).toBe(250);
    expect(roundBuy(42, "g")).toBe(50);
    expect(roundBuy(0, "kg")).toBe(0);
    expect(roundBuy(-3, "kg")).toBe(0);
  });
  it("converts mass and volume", () => {
    expect(convert(500, "g", "kg")).toBe(0.5);
    expect(convert(1, "l", "ml")).toBe(1000);
    expect(convert(1, "kg", "unidad")).toBeNull();
  });
});

describe("sideRiceQty", () => {
  const rule = DEFAULT_SETTINGS.sideRice!;
  it("uses 5 kg for 80 segundos when there is no rice/pasta dish", () => {
    const items = [1, 2, 3, 4].map((i) => item(i, i, `Guiso ${i}`));
    expect(sideRiceQty(items, rule)?.qty).toBe(5);
  });
  it("uses 3 kg when there is tallarín/arroz con pollo/chaufa/jardinera and scales with portions", () => {
    const items = [item(1, 1, "Tallarines rojos con pollo"), item(2, 2, "Estofado de pollo", 40), item(3, 3, "Papa rellena", 20, "entrada")];
    expect(sideRiceQty(items, rule)?.qty).toBeCloseTo((3 * 60) / 80);
  });
});

describe("planShopping", () => {
  const ingredients = [
    ing(1, "Pollo", "presa", { storeSection: "pollería" }),
    ing(2, "Papa amarilla", "kg", { stockQty: 1 }),
    ing(3, "Cebolla roja", "kg", { alwaysCheckStock: true, stockQty: 10 }),
    ing(4, "Arroz", "kg", { storeSection: "abarrotes", stockQty: 2 }),
    ing(5, "Comino", "kg", { storeSection: "abarrotes" }),
  ];
  const recipes = [
    { dishId: 10, ingredientId: 1, qtyPerPortion: 1, fixedQty: 0, source: "ai", corrections: 0 },
    { dishId: 10, ingredientId: 2, qtyPerPortion: 0.15, fixedQty: 0, source: "learned", corrections: 2 },
    { dishId: 10, ingredientId: 3, qtyPerPortion: 0.04, fixedQty: 0, source: "ai", corrections: 0 },
    { dishId: 10, ingredientId: 5, qtyPerPortion: 0, fixedQty: 0.02, source: "ai", corrections: 0 },
    { dishId: 11, ingredientId: 2, qtyPerPortion: 0.2, fixedQty: 0, source: "manual", corrections: 0 },
  ];
  const plan = planShopping({
    items: [item(1, 10, "Estofado de pollo"), item(2, 11, "Papa a la huancaína", 30, "entrada"), item(3, 12, "Plato sin receta"), item(4, null, "Algo escrito")],
    recipes,
    ingredients,
    sideRice: DEFAULT_SETTINGS.sideRice,
  });
  const line = (id: number) => plan.lines.find((l) => l.ingredientId === id)!;

  it("sums portions × qty per portion + fixed qty across dishes, minus stock", () => {
    expect(line(1)).toMatchObject({ needed: 20, suggested: 20, unit: "presa" });
    expect(line(2).needed).toBeCloseTo(20 * 0.15 + 30 * 0.2);
    expect(line(2).suggested).toBe(8); // 9 needed − 1 in stock
    expect(line(5)).toMatchObject({ needed: 0.02, suggested: 0.1 });
    expect(line(2).contributions.map((c) => c.label)).toEqual(["Papa a la huancaína", "Estofado de pollo"]);
  });
  it("hides always-check-stock ingredients when storage covers them", () => {
    expect(line(3)).toMatchObject({ hidden: true, needed: 0.8 });
  });
  it("adds the side-rice rule scaled by segundo portions", () => {
    // 3 segundos × 20 = 60 portions → 5 × 60/80 = 3.75 kg, 2 in stock → buy 2
    expect(line(4)).toMatchObject({ needed: 3.75, ruleNeeded: 3.75, source: "regla", suggested: 2 });
  });
  it("reports dishes with no recipe or no catalog link", () => {
    expect(plan.missingRecipes.map((m) => m.name)).toEqual(["Plato sin receta"]);
    expect(plan.unlinked.map((m) => m.name)).toEqual(["Algo escrito"]);
  });
});

describe("mergeLines", () => {
  const plan = planShopping({
    items: [item(1, 10, "Estofado")],
    recipes: [
      { dishId: 10, ingredientId: 1, qtyPerPortion: 1, fixedQty: 0, source: "ai", corrections: 0 },
      { dishId: 10, ingredientId: 2, qtyPerPortion: 0.2, fixedQty: 0, source: "ai", corrections: 0 },
      { dishId: 10, ingredientId: 3, qtyPerPortion: 0.05, fixedQty: 0, source: "ai", corrections: 0 },
    ],
    ingredients: [ing(1, "Pollo", "presa"), ing(2, "Papa", "kg", { stockQty: 1 }), ing(3, "Zanahoria")],
  });
  const base: Omit<ExistingLine, "id" | "ingredientId" | "name"> = {
    unit: "kg", needed: 0, inStock: 0, quantity: 0, suggested: 0, edited: false, source: "calculado", note: null, checked: false,
  };
  const stock = new Map([[2, 1]]);

  it("inserts new lines on first compute", () => {
    const ops = mergeLines([], plan.lines, stock);
    expect(ops.inserts.map((l) => [l.name, l.quantity])).toEqual([
      ["Papa", 3],
      ["Pollo", 20],
      ["Zanahoria", 1],
    ]);
  });

  it("keeps edited quantities, refreshes untouched lines, removes stale ones, keeps manual lines", () => {
    const existing: ExistingLine[] = [
      { ...base, id: 1, ingredientId: 1, name: "Pollo", unit: "presa", quantity: 15, suggested: 18, edited: true },
      { ...base, id: 2, ingredientId: 2, name: "Papa", quantity: 5, suggested: 5 },
      { ...base, id: 3, ingredientId: 99, name: "Ya no va", quantity: 2, suggested: 2 },
      { ...base, id: 4, ingredientId: null, name: "Bolsas", unit: "paquete", quantity: 2, source: "manual" },
      { ...base, id: 5, ingredientId: 3, name: "Zanahoria", quantity: 4, source: "manual" },
    ];
    const ops = mergeLines(existing, plan.lines, stock);
    const upd = new Map(ops.updates.map((u) => [u.id, u.patch]));
    expect(upd.get(1)).toMatchObject({ needed: 20, suggested: 20 });
    expect(upd.get(1)).not.toHaveProperty("quantity");
    expect(upd.get(2)).toMatchObject({ quantity: 3, suggested: 3, needed: 4 });
    expect(upd.get(5)).toMatchObject({ needed: 1, suggested: 1 });
    expect(upd.get(5)).not.toHaveProperty("quantity");
    expect(ops.deletes).toEqual([3]);
    expect(ops.inserts).toEqual([]); // zanahoria already covered by the manual line
    expect(upd.has(4)).toBe(false);
  });

  it("keeps an edited line even when its dish left the menu", () => {
    const existing: ExistingLine[] = [{ ...base, id: 7, ingredientId: 42, name: "Pescado", quantity: 3, edited: true }];
    const ops = mergeLines(existing, plan.lines, stock);
    expect(ops.deletes).toEqual([]);
    expect(ops.updates[0]).toMatchObject({ id: 7, patch: { needed: 0, suggested: 0 } });
  });
});

describe("shoppingWhatsapp", () => {
  it("groups by section like the kitchen writes it", () => {
    const text = shoppingWhatsapp("Compras sábado 27/09", [
      { name: "Arroz", unit: "kg", quantity: 3, section: "abarrotes" },
      { name: "Cebolla roja", unit: "kg", quantity: 15, section: "mercado" },
      { name: "Pollo", unit: "presa", quantity: 20, section: "pollería" },
      { name: "Limón", unit: "kg", quantity: 0, section: "mercado" },
      { name: "Papa amarilla", unit: "kg", quantity: 2.5, section: "mercado", checked: true },
    ]);
    expect(text).toBe(["Compras sábado 27/09", "", "*MERCADO*", "15 kilos cebolla roja", "", "*POLLERÍA*", "20 presas pollo", "", "*ABARROTES*", "3 kilos arroz"].join("\n"));
  });
});
