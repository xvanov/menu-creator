// Vercel runs `npm run vercel-build` (see vercel.json). On an empty database it creates the tables and loads the
// history; on an existing database it never changes the schema (a schema sync must not risk data), unless
// ALLOW_SCHEMA_PUSH=1 is set for a deliberate schema change. Then it loads missing history (non-destructive) and builds.
import { execSync } from "node:child_process";
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL ?? "";
const authToken = process.env.DATABASE_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN;
if (!/^(libsql|https?|wss?):\/\//.test(url)) {
  console.error(
    "\n✖ No database configured.\n" +
      "  In Vercel: Project → Storage → connect a Turso database (it sets TURSO_DATABASE_URL / TURSO_AUTH_TOKEN),\n" +
      "  or add DATABASE_URL (libsql://…) and DATABASE_AUTH_TOKEN in Settings → Environment Variables. Then redeploy.\n",
  );
  process.exit(1);
}
if (!process.env.APP_PIN) console.warn("\n⚠ APP_PIN is not set: anyone with the URL can open the app. Add it in Settings → Environment Variables.\n");
if (!process.env.CRON_SECRET) console.warn("⚠ CRON_SECRET is not set: /api/cron/generate can be triggered by anyone.\n");

const client = createClient({ url, authToken });
const tables = (await client.execute("select name from sqlite_master where type = 'table' and name = 'menus'")).rows.length;
client.close();

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
if (!tables) {
  console.log("Empty database: creating tables.");
  run("npx drizzle-kit push --force");
} else if (process.env.ALLOW_SCHEMA_PUSH === "1") {
  console.log("ALLOW_SCHEMA_PUSH=1: syncing the schema.");
  run("npx drizzle-kit push --force");
} else {
  console.log("Existing database: schema left untouched.");
}
run("npx tsx scripts/seed.ts");
run("npx next build");
