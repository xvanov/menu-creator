import { describe, expect, it } from "vitest";
import type { Course, RuleParams } from "@/lib/types";
import { addDays } from "@/lib/rules/dates";
import type { RuleDef } from "@/lib/rules/validate";
import { createEngine, generateMenu, rankReplacements, type CatalogDish, type GenerateInput, type HistoryMenu, type PlannedItem } from "./core";

const RULES: RuleDef[] = (
  [
    { type: "count_per_day", filter: { course: "entrada", categories: ["sopa", "crema"] }, min: 1, max: 1 },
    { type: "count_per_day", filter: { course: "segundo", categories: ["menestra"] }, min: 1, max: 1, weekdayOverrides: { sábado: { min: 0, max: 1 } } },
    { type: "forbid_pair", a: { course: "entrada", tagsAny: ["legumbre", "pesado"] }, b: { course: "segundo", categories: ["menestra"] } },
    { type: "count_per_day", filter: { course: "segundo", categories: ["fritura"] }, max: 1, weekdayOverrides: { sábado: { max: 2 } } },
    { type: "count_per_week", filter: { tagsAny: ["cerdo"] }, max: 1 },
    { type: "no_repeat", days: 7, exceptNames: ["Papa a la huancaína"] },
  ] satisfies RuleParams[]
).map((params, i) => ({ id: i + 1, name: `R${i + 1}`, params, hard: true, enabled: true }));

const DISHES: CatalogDish[] = [];
const add = (name: string, course: Course, category: string, extra: Partial<CatalogDish> = {}) =>
  DISHES.push({ id: DISHES.length + 1, name, course, category, tags: [], protein: null, base: null, status: "activo", price: null, ...extra });

add("Caldo de pollo", "entrada", "sopa");
add("Sopa de verduras", "entrada", "sopa");
add("Crema de rocoto", "entrada", "crema");
add("Crema de arveja", "entrada", "crema", { tags: ["legumbre", "pesado"] });
add("Papa a la huancaína", "entrada", "fria");
add("Ocopa", "entrada", "fria");
add("Tamal criollo", "entrada", "criolla");
add("Ensalada mixta", "entrada", "ensalada");
add("Tequeños", "entrada", "fritura", { tags: ["frito"] });
add("Lentejas con pollo", "segundo", "menestra", { base: "Lentejas", tags: ["legumbre"] });
add("Lentejas con pescado", "segundo", "menestra", { base: "Lentejas", tags: ["legumbre"] });
add("Frijoles con seco", "segundo", "menestra", { base: "Frijoles", tags: ["legumbre", "pesado"] });
add("Garbanzos con pollo", "segundo", "menestra", { base: "Garbanzo", tags: ["legumbre"] });
add("Ají de gallina", "segundo", "guiso", { protein: "Pollo" });
add("Estofado de pollo", "segundo", "guiso", { protein: "Pollo" });
add("Seco de res", "segundo", "guiso", { protein: "Res" });
add("Adobo de chancho", "segundo", "guiso", { protein: "Cerdo", tags: ["cerdo"] });
add("Olluquito con carne", "segundo", "guiso", { protein: "Res" });
add("Pollo frito", "segundo", "fritura", { protein: "Pollo", tags: ["frito"] });
add("Pescado frito", "segundo", "fritura", { protein: "Pescado", tags: ["frito"] });
add("Tallarines rojos", "segundo", "pasta", { protein: "Pollo" });
add("Arroz con pollo", "segundo", "arroz", { protein: "Pollo" });
add("Lomo saltado", "segundo", "saltado", { protein: "Res", price: 17 });
add("Plato archivado", "segundo", "guiso", { status: "archivado" });
add("Trucha frita", "extra", "fritura", { price: 20 });
add("Pollo broaster", "extra", "fritura", { price: 15 });
add("Arroz chaufa", "extra", "arroz", { price: 15 });

const byName = (n: string) => DISHES.find((d) => d.name === n)!;

/** 8 weeks of Mondays with lentejas and Fridays with frijoles. */
function history(): HistoryMenu[] {
  const out: HistoryMenu[] = [];
  for (let w = 8; w >= 1; w--) {
    const mon = addDays("2026-09-28", -7 * w);
    out.push({ date: mon, items: [{ dishId: byName(w % 2 ? "Lentejas con pollo" : "Lentejas con pescado").id, name: "x", course: "segundo" }] });
    out.push({ date: addDays(mon, 4), items: [{ dishId: byName("Frijoles con seco").id, name: "x", course: "segundo" }] });
  }
  return out;
}

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const input = (date: string, extra: Partial<GenerateInput> = {}): GenerateInput => ({
  date,
  dishes: DISHES,
  history: history(),
  rules: RULES,
  structure: { entradas: 3, segundos: 4 },
  pinned: [],
  extras: { names: ["Trucha frita", "Pollo broaster", "Arroz chaufa", "Lomo saltado"], perDay: 2 },
  rng: seeded(7),
  ...extra,
});

const cat = (i: PlannedItem) => DISHES.find((d) => d.id === i.dishId)?.category;

describe("generateMenu (deterministic)", () => {
  it("fills the structure with a valid, varied menu", () => {
    for (let s = 1; s <= 20; s++) {
      const r = generateMenu(input("2026-09-30", { rng: seeded(s) }));
      expect(r.violations.filter((v) => v.hard)).toEqual([]);
      const entradas = r.items.filter((i) => i.course === "entrada");
      const segundos = r.items.filter((i) => i.course === "segundo");
      expect(entradas).toHaveLength(3);
      expect(segundos).toHaveLength(4);
      expect(r.items.filter((i) => i.course === "extra")).toHaveLength(2);
      expect(["sopa", "crema"]).toContain(cat(entradas[0]));
      expect(cat(segundos[0])).toBe("menestra");
      expect(segundos.filter((i) => cat(i) === "guiso")).toHaveLength(2);
      expect(r.items.every((i) => i.reason)).toBe(true);
      expect(r.items.some((i) => i.name === "Plato archivado")).toBe(false);
    }
  });

  it("follows weekday habits from the history", () => {
    const monday = generateMenu(input("2026-09-28"));
    expect(monday.items.find((i) => cat(i) === "menestra")!.name).toMatch(/^Lentejas/);
    expect(monday.items.find((i) => cat(i) === "menestra")!.reason).toContain("Lentejas los lunes (8 de 8)");
    const friday = generateMenu(input("2026-10-02"));
    expect(friday.items.find((i) => cat(i) === "menestra")!.name).toBe("Frijoles con seco");
  });

  it("keeps pinned items and builds around them", () => {
    const pinned: PlannedItem[] = [
      { key: "i1", existingId: 1, dishId: byName("Crema de arveja").id, name: "Crema de arveja", course: "entrada", price: null, pinned: true, reason: "fijado" },
      { key: "i2", existingId: 2, dishId: byName("Pollo frito").id, name: "Pollo frito", course: "segundo", price: null, pinned: true, reason: null },
    ];
    // Saturday: menestra optional, so the heavy crema can stay without a menestra.
    const r = generateMenu(input("2026-10-03", { pinned }));
    expect(r.items.filter((i) => i.pinned).map((i) => i.key)).toEqual(["i1", "i2"]);
    expect(r.items.filter((i) => i.course === "entrada")).toHaveLength(3);
    expect(r.items.filter((i) => i.course === "segundo")).toHaveLength(4);
    expect(r.items.filter((i) => ["sopa", "crema"].includes(cat(i)!))).toHaveLength(1);
    expect(r.violations.filter((v) => v.hard)).toEqual([]);
  });

  it("avoids dishes served in the last 7 days and the week's cerdo", () => {
    const h = history();
    h.push({ date: "2026-09-28", items: [{ dishId: byName("Adobo de chancho").id, name: "Adobo de chancho", course: "segundo" }] });
    for (let s = 1; s <= 10; s++) {
      const r = generateMenu(input("2026-09-30", { history: h, rng: seeded(s) }));
      expect(r.items.some((i) => i.name === "Adobo de chancho")).toBe(false);
    }
  });

  it("repairs custom minimum rules the slot plan does not know", () => {
    const rules: RuleDef[] = [...RULES, { id: 99, name: "Pescado diario", hard: true, enabled: true, params: { type: "count_per_day", filter: { course: "segundo", names: ["Pescado frito"] }, min: 1 } }];
    const r = generateMenu(input("2026-09-30", { rules }));
    expect(r.items.some((i) => i.name === "Pescado frito")).toBe(true);
    expect(r.violations.filter((v) => v.hard)).toEqual([]);
  });
});

describe("rankReplacements", () => {
  it("offers valid dishes of the same course, same category first", () => {
    const inp = input("2026-09-30");
    const engine = createEngine(inp);
    const menu = generateMenu(inp, engine);
    const guiso = menu.items.find((i) => cat(i) === "guiso")!;
    const ranked = rankReplacements(engine, menu.items, guiso.key);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].newViolations).toEqual([]);
    expect(ranked[0].dish.course).toBe("segundo");
    expect(ranked[0].dish.category).toBe("guiso");
    expect(menu.items.some((i) => i.dishId === ranked[0].dish.id)).toBe(false);

    const menestra = menu.items.find((i) => cat(i) === "menestra")!;
    const best = rankReplacements(engine, menu.items, menestra.key)[0];
    expect(best.dish.category).toBe("menestra"); // anything else would break the daily menestra rule
  });
});
