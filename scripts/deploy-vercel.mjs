// Deploys the app to Vercel (Hobby = free, personal non-commercial use) + Turso (free). Safe to run again.
//
//   npm run deploy:vercel
//
// Uses the Vercel CLI through npx (no global install). Answers are saved in .env.deploy (git-ignored).
// The daily 17:00 Lima generation comes from vercel.json (Vercel Cron sends CRON_SECRET automatically).
import { spawnSync } from "node:child_process";
import { appEnv, appSettings, closePrompts, ok, out, setupDatabase, sh, step, warn } from "./deploy-common.mjs";

const PROJECT = "menu-del-dia";
const vercel = "npx --yes vercel@latest";

try {
  step("Vercel CLI");
  if (!out(`${vercel} whoami`)) sh(`${vercel} login`);
  ok(`Logged in as ${out(`${vercel} whoami`)}`);
  sh(`${vercel} link --yes --project ${PROJECT}`);

  await setupDatabase();
  const provider = await appSettings();

  step("Environment variables (production)");
  for (const [key, value] of Object.entries(appEnv(provider))) {
    spawnSync(`${vercel} env rm ${key} production --yes`, { shell: true, stdio: "ignore" }); // replace if present
    if (!value) continue;
    const r = spawnSync(`${vercel} env add ${key} production`, { shell: true, input: value, stdio: ["pipe", "ignore", "inherit"] });
    if (r.status !== 0) throw new Error(`could not set ${key}`);
  }
  ok("Set");

  step("Deploy (build runs on Vercel, ~2 min)");
  const url = out(`${vercel} deploy --prod --yes`);
  if (!url) throw new Error("vercel deploy failed (run it again to see the output)");
  ok(`Deployed: ${url}`);
  warn("Vercel Hobby is for personal, non-commercial use. The daily cron may run up to ~1 hour after 17:00.");
} catch (e) {
  console.error(`\n\x1b[31mDeploy stopped:\x1b[0m ${e.message}`);
  process.exitCode = 1;
} finally {
  closePrompts();
}
