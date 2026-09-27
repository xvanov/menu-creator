// Deploys the app to Google Cloud Run + Turso (free tiers, commercial use OK). Safe to run again: it creates
// what's missing and updates what exists. Answers are saved in .env.deploy (git-ignored).
//
//   npm run deploy:gcp
//
// Needs a Google account with a billing account (free tier; Google requires a card) and a Turso account (free).
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appEnv, appSettings, ask, cfg, closePrompts, has, isWin, ok, out, q, setupDatabase, sh, step, warn } from "./deploy-common.mjs";

const SERVICE = "menu-del-dia";
const JOB = "menu-del-dia-generate";

try {
  step("Google Cloud CLI");
  if (!has("gcloud")) {
    warn("gcloud not found; installing the Google Cloud CLI…");
    if (isWin) sh("winget install --id Google.CloudSDK -e --silent --accept-package-agreements --accept-source-agreements");
    else sh("curl -fsSL https://sdk.cloud.google.com | bash -s -- --disable-prompts --install-dir=$HOME");
    console.log("\nInstalled. Open a NEW terminal (so gcloud is on PATH) and run `npm run deploy:gcp` again.");
    process.exit(0);
  }
  ok(out("gcloud --version")?.split("\n")[0] ?? "gcloud");
  const account = () => out('gcloud auth list --filter=status:ACTIVE --format="value(account)"');
  if (!account()) sh("gcloud auth login");
  ok(`Logged in as ${account()}`);

  step("Project");
  const project = await ask("GCP_PROJECT", "Google Cloud project id (lowercase, e.g. sazon-de-luis-menu)");
  const region = await ask("GCP_REGION", "Region", { def: "us-east1" });
  if (!out(`gcloud projects describe ${project} --format="value(projectId)"`)) {
    sh(`gcloud projects create ${project} --name=${q("Menu del dia")}`);
    ok(`Created project ${project}`);
  } else ok(`Project ${project}`);
  sh(`gcloud config set project ${project}`, { stdio: "ignore" });
  if (out(`gcloud billing projects describe ${project} --format="value(billingEnabled)"`)?.toLowerCase() !== "true") {
    const accounts = (out('gcloud billing accounts list --filter=open=true --format="value(name)"') ?? "").split(/\s+/).filter(Boolean);
    if (accounts.length !== 1) {
      warn(
        accounts.length
          ? `Several billing accounts found; link one: gcloud billing projects link ${project} --billing-account=<ID>`
          : "No billing account. Create one (free tier, card required) at https://console.cloud.google.com/billing",
      );
      throw new Error("Billing is required by Cloud Run. Fix it and run this again.");
    }
    sh(`gcloud billing projects link ${project} --billing-account=${accounts[0].replace("billingAccounts/", "")}`);
    ok("Linked billing account (the free tier still applies; set a budget alert)");
  } else ok("Billing enabled");
  sh("gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com cloudscheduler.googleapis.com");
  ok("APIs enabled");

  await setupDatabase();
  const provider = await appSettings();

  step("Deploy to Cloud Run (build takes a few minutes)");
  const env = {
    ...appEnv(provider),
    BACKGROUND_INLINE: "1", // request-based billing: no CPU after the response
    DISABLE_MENU_SCHEDULER: "1", // Cloud Scheduler triggers generation instead
  };
  const envFile = join(tmpdir(), `menu-env-${Date.now()}.yaml`);
  writeFileSync(envFile, Object.entries(env).filter(([, v]) => v).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n") + "\n");
  try {
    sh(
      `gcloud run deploy ${SERVICE} --source . --region ${region} --allow-unauthenticated --timeout 600 ` +
        `--cpu-throttling --cpu 1 --memory 512Mi --min-instances 0 --max-instances 2 --env-vars-file ${q(envFile)} --quiet`,
    );
  } finally {
    rmSync(envFile, { force: true });
  }
  const url = out(`gcloud run services describe ${SERVICE} --region ${region} --format="value(status.url)"`);
  ok(`Deployed: ${url}`);

  step("Nightly menu generation (17:00 Lima)");
  const args = `--location ${region} --schedule ${q("0 17 * * *")} --time-zone ${q("America/Lima")} --uri ${q(`${url}/api/cron/generate`)} --http-method GET --attempt-deadline 600s`;
  const auth = q(`Authorization=Bearer ${cfg.CRON_SECRET}`);
  if (out(`gcloud scheduler jobs describe ${JOB} --location ${region} --format="value(name)"`))
    sh(`gcloud scheduler jobs update http ${JOB} ${args} --update-headers ${auth} --quiet`);
  else sh(`gcloud scheduler jobs create http ${JOB} ${args} --headers ${auth} --quiet`);
  ok("Scheduler job ready");

  console.log(`\n\x1b[32mListo.\x1b[0m Open ${url} and enter the PIN.`);
  console.log("Recommended: set a $1 budget alert at https://console.cloud.google.com/billing/budgets");
} catch (e) {
  console.error(`\n\x1b[31mDeploy stopped:\x1b[0m ${e.message}`);
  process.exitCode = 1;
} finally {
  closePrompts();
}
