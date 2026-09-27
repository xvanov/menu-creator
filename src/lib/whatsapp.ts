/** WhatsApp message in the exact format the team posts every day. Pure; usable on client and server. */

export interface WhatsappMenu {
  menuPrice: number;
  entradas: string[];
  segundos: string[];
  extras: { name: string; price?: number | null }[];
}

/** "S/13.00" (no space, like the posts). */
export const solesCompact = (n: number) => `S/${n.toFixed(2)}`;

export function buildWhatsappText({ menuPrice, entradas, segundos, extras }: WhatsappMenu): string {
  const pin = (s: string) => `📌${s.trim()}`;
  const lines = [
    "Hola buenos días😊⛅️",
    "Hoy en la Sazón de Luis tenemos para degustar:",
    "",
    ` *MENU*: 🍽️ ${solesCompact(menuPrice)}`,
    "",
    "*ENTRADA*:",
    ...entradas.map(pin),
    "",
    "*SEGUNDO*:",
    ...segundos.map(pin),
  ];
  if (extras.length) {
    lines.push("*EXTRA*");
    for (const e of extras) lines.push(pin(e.price != null ? `${e.name.trim()} ${solesCompact(e.price)}` : e.name));
  }
  return lines.join("\n");
}
