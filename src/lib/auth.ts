import { createHash } from "node:crypto";

export const PIN_COOKIE = "menu_pin";

/** Only enforced when APP_PIN is set (cloud deploys). Locally there is no login. */
export const pinRequired = () => !!process.env.APP_PIN;

export function pinToken(pin = process.env.APP_PIN ?? ""): string {
  return createHash("sha256").update(`menu-del-dia:${pin}`).digest("hex");
}
