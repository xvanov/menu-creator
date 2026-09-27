import { z } from "zod";
import { UNITS } from "../types";

export const ingredientFields = {
  unit: z.enum(UNITS),
  storeSection: z.string().trim().min(1).max(30),
  pricePerUnit: z.number().min(0).nullable(),
  stockQty: z.number().min(0),
  alwaysCheckStock: z.boolean(),
};

const name = z.string().trim().min(1).max(80);
export const ingredientCreateSchema = z.object({ name, ...ingredientFields }).partial().required({ name: true });
export const ingredientPatchSchema = z.object({ name, ...ingredientFields }).partial();
