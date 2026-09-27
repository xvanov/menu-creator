import "server-only";
import type { z } from "zod";
import { ShoppingError } from "./index";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class HttpError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Parses and validates a JSON body; throws a 400 with a readable message. */
export async function body<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const raw = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    throw new HttpError(msg, 400);
  }
  return parsed.data;
}

export function dateParam(date: string): string {
  if (!DATE.test(date)) throw new HttpError("Fecha inválida (YYYY-MM-DD)", 400);
  return date;
}

export function idParam(id: string): number {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError("Id inválido", 400);
  return n;
}

/** Runs a route body, turning known errors into JSON responses. */
export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    const out = await fn();
    return out instanceof Response ? out : Response.json(out);
  } catch (e) {
    if (e instanceof HttpError || e instanceof ShoppingError) return Response.json({ error: e.message }, { status: e.status });
    const msg = (e as Error).message ?? String(e);
    if (/UNIQUE constraint/i.test(msg)) return Response.json({ error: "Ya existe un registro con ese nombre" }, { status: 409 });
    console.error(e);
    return Response.json({ error: "Error interno" }, { status: 500 });
  }
}
