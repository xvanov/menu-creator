/** Units, buy rounding and text formatting for shopping quantities. Pure: safe for client and tests. */

export const STORE_SECTIONS = ["mercado", "pollería", "carnicería", "pescadería", "abarrotes"] as const;
export type StoreSection = (typeof STORE_SECTIONS)[number];
export const OTHER_SECTION = "otros";

const COUNT_UNITS = new Set(["unidad", "paquete", "bolsa", "tarro", "botella", "atado", "presa", "caja", "lata"]);

/** Rounds up with a small tolerance so 5.02 kg stays 5 kg instead of jumping to 5.5. */
function ceilTo(qty: number, step: number) {
  return Math.ceil(qty / step - 0.1) * step;
}

/**
 * Quantity people actually buy: kg/l in 0.5 (0.1 under half a kilo, 0.25 under 1 kg),
 * g/ml in 50 (10 under 100), countable units in whole numbers.
 */
export function roundBuy(qty: number, unit: string): number {
  if (!(qty > 0)) return 0;
  let r: number;
  if (unit === "kg" || unit === "l") r = qty < 0.5 ? ceilTo(qty, 0.1) : qty < 1 ? ceilTo(qty, 0.25) : ceilTo(qty, 0.5);
  else if (unit === "g" || unit === "ml") r = qty < 100 ? ceilTo(qty, 10) : ceilTo(qty, 50);
  else if (COUNT_UNITS.has(unit)) r = ceilTo(qty, 1);
  else r = ceilTo(qty, 0.5);
  // tolerance could round a tiny need down to 0; always buy at least the smallest step
  if (r <= 0) r = unit === "kg" || unit === "l" ? 0.1 : unit === "g" || unit === "ml" ? 10 : COUNT_UNITS.has(unit) ? 1 : 0.5;
  return Math.round(r * 1000) / 1000;
}

/** Converts between mass/volume units; null when not convertible. */
export function convert(qty: number, from: string, to: string): number | null {
  if (from === to) return qty;
  const f: Record<string, [string, number]> = { kg: ["m", 1000], g: ["m", 1], l: ["v", 1000], ml: ["v", 1] };
  const a = f[from];
  const b = f[to];
  if (!a || !b || a[0] !== b[0]) return null;
  return (qty * a[1]) / b[1];
}

/** Shows at most 3 decimals, trimmed ("0.250" → "0.25"). */
export function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n * 1000) / 1000);
}

const WORDS: Record<string, [string, string]> = {
  kg: ["kilo", "kilos"],
  g: ["gramo", "gramos"],
  l: ["litro", "litros"],
  ml: ["ml", "ml"],
  unidad: ["unidad", "unidades"],
  presa: ["presa", "presas"],
  paquete: ["paquete", "paquetes"],
  bolsa: ["bolsa", "bolsas"],
  tarro: ["tarro", "tarros"],
  botella: ["botella", "botellas"],
  atado: ["atado", "atados"],
  caja: ["caja", "cajas"],
  lata: ["lata", "latas"],
};

export function unitWord(unit: string, qty: number): string {
  const w = WORDS[unit];
  if (!w) return unit;
  return qty === 1 ? w[0] : w[1];
}

/** "15 kilos cebolla roja", like the kitchen writes it in WhatsApp. */
export function whatsappLine(qty: number, unit: string, name: string): string {
  return `${fmtQty(qty).replace(".", ",")} ${unitWord(unit, qty)} ${name.toLocaleLowerCase("es")}`;
}

export function sectionOrder(section: string): number {
  const i = (STORE_SECTIONS as readonly string[]).indexOf(section);
  return i < 0 ? STORE_SECTIONS.length : i;
}

/** Plain WhatsApp text grouped by store section; skips lines with nothing to buy and checked-off lines. */
export function shoppingWhatsapp(
  title: string,
  lines: { name: string; unit: string; quantity: number; section: string; checked?: boolean; note?: string | null }[],
): string {
  const groups = new Map<string, string[]>();
  const sorted = [...lines].sort((a, b) => sectionOrder(a.section) - sectionOrder(b.section) || a.name.localeCompare(b.name, "es"));
  for (const l of sorted) {
    if (!(l.quantity > 0) || l.checked) continue;
    const g = groups.get(l.section) ?? [];
    g.push(whatsappLine(l.quantity, l.unit, l.name));
    groups.set(l.section, g);
  }
  const parts = [title];
  for (const [section, items] of groups) parts.push("", `*${section.toLocaleUpperCase("es")}*`, ...items);
  return parts.join("\n");
}
