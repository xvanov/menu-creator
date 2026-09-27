// Shared helpers for the deploy scripts: saved answers (.env.deploy), prompts, Turso database setup.
import { execSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const CONFIG = ".env.deploy";
export const isWin = process.platform === "win32";

export const ok = (m) => console.log(`\x1b[32m[ok]\x1b[0m ${m}`);
export const warn = (m) => console.log(`\x1b[33m[!] ${m}\x1b[0m`);
export const step = (m) => console.log(`\n\x1b[36m== ${m}\x1b[0m`);
export const q = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
export const sh = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", ...opts });
export const out = (cmd) => {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};
export const has = (bin) => spawnSync(isWin ? "where" : "which", [bin], { stdio: "ignore", shell: isWin }).status === 0;

export const cfg = {};
if (existsSync(CONFIG))
  for (const line of readFileSync(CONFIG, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) cfg[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
export function save() {
  writeFileSync(
    CONFIG,
    "# Deploy settings for npm run deploy:* (keep private; git-ignored)\n" +
      Object.entries(cfg)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") +
      "\n",
  );
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
export const closePrompts = () => rl.close();
/** Asks once and remembers the answer in .env.deploy. */
export async function ask(key, question, { def, optional } = {}) {
  if (cfg[key]) return cfg[key];
  const a = (await rl.question(`${question}${def ? ` [${def}]` : ""}${optional ? " (Enter to skip)" : ""}: `)).trim() || def || "";
  if (!a && !optional) return ask(key, question, { def, optional });
  cfg[key] = a;
  save();
  return a;
}

/** Turso database: created via the turso CLI when available, else pasted from the dashboard. Then migrate + seed. */
export async function setupDatabase() {
  step("Database (Turso, free plan)");
  if (!cfg.DATABASE_URL && has("turso")) {
    spawnSync("turso db create menu-del-dia", { shell: true, stdio: "inherit" }); // harmless if it exists
    cfg.DATABASE_URL = out("turso db show menu-del-dia --url") ?? "";
    cfg.DATABASE_AUTH_TOKEN = out("turso db tokens create menu-del-dia") ?? "";
    save();
  }
  if (!cfg.DATABASE_URL)
    console.log(
      "Create a free database at https://app.turso.tech (Create Database → name 'menu-del-dia'),\n" +
        "then copy its URL (libsql://…) and create a token (Generate token → no expiration).",
    );
  await ask("DATABASE_URL", "Turso database URL (libsql://...)");
  await ask("DATABASE_AUTH_TOKEN", "Turso auth token");
  const env = { ...process.env, SKIP_ENV_LOCAL: "1", DATABASE_URL: cfg.DATABASE_URL, DATABASE_AUTH_TOKEN: cfg.DATABASE_AUTH_TOKEN };
  sh("npm run db:push", { env });
  sh("npm run db:seed", { env }); // only adds what's missing
  ok("Database ready");
}

/** PIN, cron secret and optional AI key. Returns the chosen LLM provider. */
export async function appSettings() {
  step("App settings");
  await ask("APP_PIN", "PIN to open the app (shared with the team)");
  if (!cfg.CRON_SECRET) {
    cfg.CRON_SECRET = randomBytes(24).toString("hex");
    save();
  }
  console.log("AI: a Gemini key has a free tier (https://aistudio.google.com/apikey). Free-tier prompts may be reviewed by Google.");
  await ask("GEMINI_API_KEY", "Gemini API key", { optional: true });
  console.log("Backup AI (used when Gemini's free quota runs out): Groq, free at https://console.groq.com/keys");
  await ask("GROQ_API_KEY", "Groq API key", { optional: true });
  if (!cfg.GEMINI_API_KEY && !cfg.GROQ_API_KEY) await ask("ANTHROPIC_API_KEY", "Anthropic API key", { optional: true });
  const chain = [cfg.ANTHROPIC_API_KEY && "anthropic", cfg.GEMINI_API_KEY && "gemini", cfg.GROQ_API_KEY && "groq"].filter(Boolean);
  const provider = cfg.LLM_PROVIDER || chain.join(",") || "none";
  if (provider === "none") warn("No AI key: the app works without AI (rules + history, manual recipes).");
  else ok(`AI: ${provider}`);
  return provider;
}

/** Runtime env for the deployed app. */
export function appEnv(provider) {
  return {
    DATABASE_URL: cfg.DATABASE_URL,
    DATABASE_AUTH_TOKEN: cfg.DATABASE_AUTH_TOKEN,
    APP_PIN: cfg.APP_PIN,
    CRON_SECRET: cfg.CRON_SECRET,
    LLM_PROVIDER: provider,
    GEMINI_API_KEY: cfg.GEMINI_API_KEY || undefined,
    GROQ_API_KEY: cfg.GROQ_API_KEY || undefined,
    ANTHROPIC_API_KEY: cfg.ANTHROPIC_API_KEY || undefined,
  };
}
