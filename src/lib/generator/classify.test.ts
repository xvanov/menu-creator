import { describe, expect, it } from "vitest";
import { classifyHeuristic } from "./classify";

describe("classifyHeuristic", () => {
  it.each([
    ["Crema de zapallo", "entrada", "crema", []],
    ["Sopa de morón", "entrada", "sopa", []],
    ["Menestrón", "entrada", "sopa", ["legumbre", "pesado"]],
    ["Wantán frito", "entrada", "fritura", ["frito"]],
    ["Lentejas con pescado frito", "segundo", "menestra", ["legumbre", "frito", "pescado"]],
    ["Guiso de quinua con churrasco apanado", "segundo", "guiso", ["frito"]],
    ["Tallarín saltado de pollo", "segundo", "pasta", []],
    ["Chicharrón de chancho", "segundo", "fritura", ["frito", "cerdo"]],
    ["Cau cau con arroz", "segundo", "guiso", ["menudencia", "pesado"]],
  ] as const)("%s", (name, course, category, tags) => {
    const c = classifyHeuristic(name, course);
    expect(c.category).toBe(category);
    expect([...c.tags].sort()).toEqual([...tags].sort());
  });

  it("detects protein and menestra base", () => {
    expect(classifyHeuristic("Frijoles con seco de res", "segundo")).toMatchObject({ category: "menestra", base: "Frijoles", protein: "Res" });
    expect(classifyHeuristic("Ají de gallina", "segundo")).toMatchObject({ category: "guiso", protein: "Pollo" });
  });
});
