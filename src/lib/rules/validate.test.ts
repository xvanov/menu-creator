import { describe, expect, it } from "vitest";
import type { Course, RuleParams } from "@/lib/types";
import { serviceWeek } from "./dates";
import { formatWarnings, validateMenu, type DayMenu, type RuleDef, type RuleItem } from "./validate";

// The owner's default rules, as seeded by scripts/seed.ts.
const SEED: { name: string; params: RuleParams; hard?: boolean }[] = [
  { name: "Una sopa o crema", params: { type: "count_per_day", filter: { course: "entrada", categories: ["sopa", "crema"] }, min: 1, max: 1 } },
  {
    name: "Menestra diaria (menos sábado)",
    params: { type: "count_per_day", filter: { course: "segundo", categories: ["menestra"] }, min: 1, max: 1, weekdayOverrides: { sábado: { min: 0, max: 1 } } },
  },
  {
    name: "Menestra no va con sopa pesada o de legumbre",
    params: { type: "forbid_pair", a: { course: "entrada", tagsAny: ["legumbre", "pesado"] }, b: { course: "segundo", categories: ["menestra"] } },
  },
  { name: "Máximo una fritura", params: { type: "count_per_day", filter: { course: "segundo", categories: ["fritura"] }, max: 1, weekdayOverrides: { sábado: { max: 2 } } } },
  { name: "Chancho una vez por semana", params: { type: "count_per_week", filter: { tagsAny: ["cerdo"] }, max: 1 } },
  { name: "No repetir en 7 días", params: { type: "no_repeat", days: 7, exceptNames: ["Papa a la huancaína", "Tamal criollo", "Pollo broaster"] } },
  { name: "Costumbres de la semana", hard: false, params: { type: "text", text: "Lunes: lentejas." } },
];
const RULES: RuleDef[] = SEED.map((r, i) => ({ id: i + 1, name: r.name, params: r.params, hard: r.hard ?? true, enabled: true }));

let nextId = 1;
const DISHES: Record<string, { category: string; tags?: string[]; course: Course; id: number }> = {};
function dish(name: string, course: Course, category: string, tags: string[] = []) {
  DISHES[name] = { category, tags, course, id: Object.keys(DISHES).length + 1 };
}
dish("Caldo de pollo", "entrada", "sopa");
dish("Crema de rocoto", "entrada", "crema", ["picante"]);
dish("Crema de arveja", "entrada", "crema", ["legumbre", "pesado"]);
dish("Sancochado", "entrada", "sopa", ["pesado"]);
dish("Papa a la huancaína", "entrada", "fria");
dish("Tamal criollo", "entrada", "criolla");
dish("Ensalada mixta", "entrada", "ensalada");
dish("Lentejas con pollo frito", "segundo", "menestra", ["legumbre", "frito"]);
dish("Arvejita partida con pescado", "segundo", "menestra", ["legumbre"]);
dish("Ají de gallina", "segundo", "guiso");
dish("Estofado de pollo", "segundo", "guiso");
dish("Adobo de chancho", "segundo", "guiso", ["cerdo"]);
dish("Chicharrón de chancho", "segundo", "fritura", ["cerdo", "frito"]);
dish("Pollo broaster", "segundo", "fritura", ["frito"]);
dish("Pescado frito", "segundo", "fritura", ["frito", "pescado"]);
dish("Lomo saltado", "segundo", "saltado");
dish("Tallarines rojos", "segundo", "pasta");

function item(name: string, course?: Course): RuleItem {
  const d = DISHES[name];
  if (!d) throw new Error(name);
  return { id: nextId++, name, course: course ?? d.course, dishId: d.id, dishName: name, category: d.category, tags: d.tags ?? [] };
}

// 2026-09-21 is a Monday; 2026-09-26 a Saturday.
const MON = "2026-09-21";
const WED = "2026-09-23";
const SAT = "2026-09-26";

const good = () => [
  item("Caldo de pollo"),
  item("Papa a la huancaína"),
  item("Ensalada mixta"),
  item("Lentejas con pollo frito"),
  item("Ají de gallina"),
  item("Estofado de pollo"),
  item("Lomo saltado"),
];

const check = (date: string, items: RuleItem[], others: DayMenu[] = []) => validateMenu({ date, items, rules: RULES, others });
const byRule = (vs: ReturnType<typeof check>, name: string) => vs.filter((v) => v.ruleName === name);

describe("validateMenu with the owner's rules", () => {
  it("accepts a normal menu", () => {
    expect(check(MON, good())).toEqual([]);
  });

  it("requires exactly one sopa/crema", () => {
    const none = good().filter((i) => i.name !== "Caldo de pollo");
    expect(byRule(check(MON, none), "Una sopa o crema")).toMatchObject([{ kind: "min", hard: true }]);

    const two = [...good(), item("Crema de rocoto")];
    const [v] = byRule(check(MON, two), "Una sopa o crema");
    expect(v.kind).toBe("max");
    expect(v.itemIds).toHaveLength(2);
    expect(v.message).toContain("Caldo de pollo, Crema de rocoto");
  });

  it("requires a menestra every day but Saturday", () => {
    const noMenestra = good().filter((i) => i.name !== "Lentejas con pollo frito");
    expect(byRule(check(MON, noMenestra), "Menestra diaria (menos sábado)")).toMatchObject([{ kind: "min" }]);
    expect(byRule(check(SAT, noMenestra), "Menestra diaria (menos sábado)")).toEqual([]);

    const twoMenestras = [...good(), item("Arvejita partida con pescado")];
    expect(byRule(check(SAT, twoMenestras), "Menestra diaria (menos sábado)")).toMatchObject([{ kind: "max" }]);
  });

  it("forbids menestra with a legume or heavy soup", () => {
    const withArveja = good().map((i) => (i.name === "Caldo de pollo" ? item("Crema de arveja") : i));
    const [v] = byRule(check(MON, withArveja), "Menestra no va con sopa pesada o de legumbre");
    expect(v.kind).toBe("pair");
    expect(v.message).toContain("Crema de arveja no puede ir con Lentejas con pollo frito");
    expect(v.itemIds).toHaveLength(2);

    const withSancochado = good().map((i) => (i.name === "Caldo de pollo" ? item("Sancochado") : i));
    expect(byRule(check(MON, withSancochado), "Menestra no va con sopa pesada o de legumbre")).toHaveLength(1);

    // without menestra (Saturday) a heavy soup is fine
    const sat = withSancochado.filter((i) => i.name !== "Lentejas con pollo frito");
    expect(byRule(check(SAT, sat), "Menestra no va con sopa pesada o de legumbre")).toEqual([]);
  });

  it("allows one fried segundo, two on Saturday", () => {
    const menu = [...good().filter((i) => i.name !== "Lomo saltado"), item("Pollo broaster"), item("Pescado frito")];
    expect(byRule(check(MON, menu), "Máximo una fritura")).toMatchObject([{ kind: "max", itemIds: expect.any(Array) }]);
    expect(byRule(check(SAT, menu), "Máximo una fritura")).toEqual([]);
    const three = [...menu, item("Chicharrón de chancho")];
    expect(byRule(check(SAT, three), "Máximo una fritura")).toHaveLength(1);
  });

  it("does not count fried extras or fried menestras as fritura segundos", () => {
    const menu = [...good(), item("Pollo broaster", "extra"), item("Pescado frito", "extra")];
    expect(byRule(check(MON, menu), "Máximo una fritura")).toEqual([]);
  });

  it("allows one cerdo dish per Mon–Sat week, counting other days", () => {
    const today = [...good(), item("Adobo de chancho")];
    expect(byRule(check(WED, today), "Chancho una vez por semana")).toEqual([]);

    const monday: DayMenu = { date: MON, items: [item("Chicharrón de chancho")] };
    const [v] = byRule(check(WED, today, [monday]), "Chancho una vez por semana");
    expect(v.kind).toBe("week");
    expect(v.message).toContain("Chicharrón de chancho (lun 21/09)");

    // previous week's Saturday does not count
    const lastSat: DayMenu = { date: "2026-09-19", items: [item("Chicharrón de chancho")] };
    expect(byRule(check(WED, today, [lastSat]), "Chancho una vez por semana")).toEqual([]);

    // two in the same menu
    expect(byRule(check(WED, [...today, item("Chicharrón de chancho")]), "Chancho una vez por semana")).toHaveLength(1);
  });

  it("does not repeat a dish within 7 days, except the staples", () => {
    const lastWeek: DayMenu = { date: "2026-09-16", items: [item("Ají de gallina"), item("Papa a la huancaína"), item("Pollo broaster")] }; // 7 days before WED
    const twoDaysAgo: DayMenu = { date: "2026-09-21", items: [item("Ají de gallina"), item("Papa a la huancaína"), item("Lomo saltado", "extra")] };

    const menu = [...good(), item("Pollo broaster")];
    expect(byRule(check(WED, menu, [lastWeek]), "No repetir en 7 días")).toEqual([]);

    const vs = byRule(check(WED, menu, [lastWeek, twoDaysAgo]), "No repetir en 7 días");
    expect(vs).toHaveLength(1); // ají de gallina; huancaína is an exception, lomo saltado was only an extra
    expect(vs[0].message).toContain("Ají de gallina se sirvió el lun 21/09 (hace 2 días)");
    expect(vs[0].itemIds).toEqual([menu.find((i) => i.name === "Ají de gallina")!.id]);

    // a draft saved for a later day also counts
    const future: DayMenu = { date: "2026-09-25", items: [item("Estofado de pollo")] };
    expect(byRule(check(WED, menu, [future]), "No repetir en 7 días")[0].message).toContain("está en el menú del vie 25/09");

    // same dish twice on one menu
    expect(byRule(check(WED, [...good(), item("Ají de gallina")]), "No repetir en 7 días")[0].message).toContain("dos veces");
  });

  it("ignores disabled and text rules, and marks soft violations", () => {
    const rules = RULES.map((r) => (r.id === 1 ? { ...r, enabled: false } : r));
    expect(validateMenu({ date: MON, items: [], rules }).map((v) => v.ruleName)).toEqual(["Menestra diaria (menos sábado)"]);

    const soft = RULES.map((r) => (r.id === 1 ? { ...r, hard: false } : r));
    const vs = validateMenu({ date: MON, items: good().filter((i) => i.name !== "Caldo de pollo"), rules: soft });
    expect(formatWarnings(vs)).toEqual(["Sugerencia: Una sopa o crema: falta 1."]);
  });

  it("matches filters by dish name, accent-insensitively", () => {
    const rules: RuleDef[] = [
      { id: 9, name: "Sin ají los lunes", hard: true, enabled: true, params: { type: "count_per_day", filter: { names: ["aji de gallina"] }, max: 0 } },
    ];
    expect(validateMenu({ date: MON, items: good(), rules })).toHaveLength(1);
  });
});

describe("serviceWeek", () => {
  it("spans Monday to Saturday", () => {
    expect(serviceWeek(WED)).toEqual({ start: MON, end: SAT });
    expect(serviceWeek("2026-09-27")).toEqual({ start: MON, end: SAT }); // Sunday
    expect(serviceWeek("2026-09-28").start).toBe("2026-09-28");
  });
});
