import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

// Local: file:local.db. Deployed: Turso (DATABASE_URL/DATABASE_AUTH_TOKEN, or the TURSO_* names the
// Vercel Turso integration sets).
const url = process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL ?? "file:local.db";
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN });

// Background work (recipe drafting, recompute) writes while requests write: wait instead of SQLITE_BUSY.
if (url.startsWith("file:")) {
  void client.execute("PRAGMA busy_timeout = 10000").catch(() => {});
  void client.execute("PRAGMA journal_mode = WAL").catch(() => {});
}

export const db = drizzle(client, { schema });
export { schema };
