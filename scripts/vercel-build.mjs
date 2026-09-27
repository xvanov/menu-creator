// Vercel runs `npm run vercel-build` instead of `build` when it exists. Before building it creates/updates
// the tables and loads missing history (idempotent), so deploying from the Vercel UI needs no local step.
import { execSync } from "node:child_process";

const url = process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL ?? "";
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

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
run("npx drizzle-kit push --force");
run("npx tsx scripts/seed.ts");
run("npx next build");
