import { describe, expect, it } from "vitest";
import { buildWhatsappText } from "./whatsapp";

describe("buildWhatsappText", () => {
  it("matches the format the team posts", () => {
    const text = buildWhatsappText({
      menuPrice: 13,
      entradas: ["Sopa de verduras", "Papa a la huancaína"],
      segundos: ["Lentejas con pollo"],
      extras: [{ name: "Pollo broaster", price: 15 }],
    });
    expect(text).toBe(
      [
        "Hola buenos días😊⛅️",
        "Hoy en la Sazón de Luis tenemos para degustar:",
        "",
        " *MENU*: 🍽️ S/13.00",
        "",
        "*ENTRADA*:",
        "📌Sopa de verduras",
        "📌Papa a la huancaína",
        "",
        "*SEGUNDO*:",
        "📌Lentejas con pollo",
        "*EXTRA*",
        "📌Pollo broaster S/15.00",
      ].join("\n"),
    );
  });

  it("omits the extras block when there are none", () => {
    expect(buildWhatsappText({ menuPrice: 13, entradas: [], segundos: ["A"], extras: [] })).not.toContain("*EXTRA*");
  });
});
