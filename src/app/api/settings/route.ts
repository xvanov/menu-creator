import { z } from "zod";
import { getSettings, saveSettings } from "@/lib/settings";
import { WEEKDAYS } from "@/lib/types";

const count = z.number().int().min(0).max(20);
const settingsPatchSchema = z
  .object({
    menuPrice: z.number().positive(),
    structure: z.record(z.enum(WEEKDAYS), z.object({ entradas: count, segundos: count })),
    defaultPortions: z.number().int().min(0),
    extraPortions: z.number().int().min(0),
    extrasPerDay: z.number().int().min(0).max(20),
    defaultExtras: z.array(z.string().trim().min(1)),
    generateAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora en formato HH:MM"),
    newDishesPerWeek: z.number().int().min(0).max(20),
  })
  .partial(); // unknown keys are stripped (other areas may store their own settings)

export async function GET() {
  return Response.json({ settings: await getSettings() });
}

export async function PATCH(req: Request) {
  const parsed = settingsPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const error = parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
    return Response.json({ error }, { status: 400 });
  }
  return Response.json({ settings: await saveSettings(parsed.data) });
}
