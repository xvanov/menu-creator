import type { NextRequest } from "next/server";
import { db, schema } from "@/db";
import { listDishes, type DishStatus } from "@/app/platos/_lib/dishes";
import type { Course } from "@/lib/types";
import { dishCreateSchema, isUniqueViolation, zodMessage } from "./schema";

const COURSES = ["entrada", "segundo", "extra"];
const STATUSES = ["activo", "nuevo", "archivado", "all"];

/** GET /api/dishes?q=&course=&status=&limit= — accent/case-insensitive search (archived excluded unless status given). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const course = p.get("course");
  const status = p.get("status");
  const limit = Number(p.get("limit")) || undefined;
  const dishes = await listDishes({
    q: p.get("q") ?? undefined,
    course: course && COURSES.includes(course) ? (course as Course) : undefined,
    status: status && STATUSES.includes(status) ? (status as DishStatus | "all") : undefined,
    limit,
  });
  return Response.json({ dishes });
}

export async function POST(req: Request) {
  const parsed = dishCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: zodMessage(parsed.error) }, { status: 400 });
  try {
    const [dish] = await db
      .insert(schema.dishes)
      .values({ ...parsed.data, tags: parsed.data.tags ?? [] })
      .returning();
    return Response.json({ dish }, { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e)) return Response.json({ error: `Ya existe un plato llamado "${parsed.data.name}"` }, { status: 409 });
    throw e;
  }
}
