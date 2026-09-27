import { describe, expect, it } from "vitest";
import { describeRule } from "./describe";

describe("describeRule", () => {
  it("summarizes the seed rules in Spanish", () => {
    expect(describeRule({ type: "count_per_day", filter: { course: "entrada", categories: ["sopa", "crema"] }, min: 1, max: 1 })).toBe(
      "Cada día: exactamente 1 entradas de categoría sopa o crema.",
    );
    expect(
      describeRule({ type: "count_per_day", filter: { course: "segundo", categories: ["menestra"] }, min: 1, max: 1, weekdayOverrides: { sábado: { min: 0, max: 1 } } }),
    ).toBe("Cada día: exactamente 1 segundos de categoría menestra. Excepto sábado: entre 0 y 1 segundos de categoría menestra.");
    expect(describeRule({ type: "count_per_day", filter: { course: "segundo", categories: ["fritura"] }, max: 1, weekdayOverrides: { sábado: { max: 2 } } })).toBe(
      "Cada día: como máximo 1 segundos de categoría fritura. Excepto sábado: como máximo 2 segundos de categoría fritura.",
    );
    expect(describeRule({ type: "forbid_pair", a: { course: "entrada", tagsAny: ["legumbre", "pesado"] }, b: { course: "segundo", categories: ["menestra"] } })).toBe(
      "No juntar entradas con etiqueta legumbre o pesado con segundos de categoría menestra el mismo día.",
    );
    expect(describeRule({ type: "no_repeat", days: 7, exceptNames: ["Tamal criollo"] })).toBe("Un plato no se repite en 7 días (salvo Tamal criollo).");
  });

  it("reads weekday-only rules naturally", () => {
    expect(describeRule({ type: "count_per_day", filter: { tagsAny: ["cerdo"] }, weekdayOverrides: { lunes: { max: 0 } } })).toBe("Lunes: sin platos con etiqueta cerdo.");
  });
});
