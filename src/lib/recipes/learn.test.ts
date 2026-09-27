import { describe, expect, it } from "vitest";
import { correctionRatio, emaUpdate, learnPortions, learnRecipeItem, sourceLabel } from "./learn";
import { findByName, norm } from "./text";

describe("correctionRatio", () => {
  it("compares edited quantity + stock with what recipes needed", () => {
    // needed 15 kg, 2 in stock, they buy 8 → wanted 10 → 10/15
    expect(correctionRatio({ quantity: 8, inStock: 2, needed: 15 })).toBeCloseTo(10 / 15);
  });
  it("ignores the rule part (side rice) of the need", () => {
    // 5 kg side rice + 4 kg from recipes; person wants 7 total → recipes should give 2
    expect(correctionRatio({ quantity: 7, inStock: 0, needed: 9, ruleNeeded: 5 })).toBeCloseTo(0.5);
  });
  it("clamps extreme ratios", () => {
    expect(correctionRatio({ quantity: 100, inStock: 0, needed: 1 })).toBe(3);
    expect(correctionRatio({ quantity: 0, inStock: 0, needed: 10 })).toBe(0.3);
  });
  it("returns null when there is nothing to learn", () => {
    expect(correctionRatio({ quantity: 5, inStock: 0, needed: 0 })).toBeNull();
    expect(correctionRatio({ quantity: 10, inStock: 0, needed: 10 })).toBeNull();
    expect(correctionRatio({ quantity: 3, inStock: 0, needed: 3, ruleNeeded: 3 })).toBeNull();
  });
});

describe("emaUpdate / learnRecipeItem", () => {
  it("moves 30% of the way towards the corrected value", () => {
    expect(emaUpdate(0.1, 0.5)).toBeCloseTo(0.085); // target 0.05
    expect(emaUpdate(0.1, 2, 0.5)).toBeCloseTo(0.15);
  });
  it("converges after repeated corrections", () => {
    let q = 0.1;
    for (let i = 0; i < 20; i++) q = emaUpdate(q, 0.05 / q);
    expect(q).toBeCloseTo(0.05, 3);
  });
  it("scales per-portion qty, or the fixed amount for batch-only items", () => {
    const a = learnRecipeItem({ qtyPerPortion: 0.2, fixedQty: 0.1, corrections: 2 }, 0.5);
    expect(a).toMatchObject({ fixedQty: 0.1, corrections: 3, source: "learned" });
    expect(a.qtyPerPortion).toBeCloseTo(0.17);
    const b = learnRecipeItem({ qtyPerPortion: 0, fixedQty: 1, corrections: 0 }, 2);
    expect(b.qtyPerPortion).toBe(0);
    expect(b.fixedQty).toBeCloseTo(1.3);
  });
});

describe("learnPortions", () => {
  it("follows the owner's overrides", () => {
    expect(learnPortions(20, 30)).toBe(23);
    expect(learnPortions(20, 20)).toBe(20);
    expect(learnPortions(2, 0)).toBe(1);
  });
});

describe("labels and names", () => {
  it("explains the source", () => {
    expect(sourceLabel("learned", 1)).toBe("aprendido (1 corrección)");
    expect(sourceLabel("learned", 4)).toBe("aprendido (4 correcciones)");
    expect(sourceLabel("ai")).toBe("IA");
  });
  it("matches names ignoring accents, case and plurals", () => {
    expect(norm("  Ají  Amarillo ")).toBe("aji amarillo");
    const list = [{ name: "Cebolla roja" }, { name: "Limón" }, { name: "Huevo" }];
    expect(findByName(list, "cebolla ROJA")?.name).toBe("Cebolla roja");
    expect(findByName(list, "limon")?.name).toBe("Limón");
    expect(findByName(list, "huevos")?.name).toBe("Huevo");
    expect(findByName(list, "papa")).toBeUndefined();
  });
});
