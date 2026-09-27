import { z } from "zod";

const optText = z
  .string()
  .trim()
  .transform((s) => s || null)
  .nullable()
  .optional();
const optNum = z.number().nonnegative().nullable().optional();

export const dishCreateSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio"),
  course: z.enum(["entrada", "segundo", "extra"]),
  category: z.string().trim().min(1, "La categoría es obligatoria"),
  base: optText,
  protein: optText,
  tags: z.array(z.string().trim().min(1)).optional(),
  status: z.enum(["activo", "nuevo", "archivado"]).optional(),
  price: optNum,
  costPerPortion: optNum,
  defaultPortions: z.number().int().positive().nullable().optional(),
  notes: optText,
});

export const dishPatchSchema = dishCreateSchema.partial();

export function zodMessage(e: z.ZodError) {
  return e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
}

export const isUniqueViolation = (e: unknown) => /UNIQUE constraint failed/i.test(String((e as { message?: string })?.message ?? e) + String((e as { cause?: unknown })?.cause ?? ""));
