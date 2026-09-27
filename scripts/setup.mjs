// App setup, safe to run again at any time (after `git pull`, too):  npm run setup [-- --no-build]
// Installs packages, creates .env.local, creates/migrates the database, loads missing seed data,
// builds the production app. Warns (never fails) when the AI provider isn't available.
import { execSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";

const ok = (m) => console.log(`\x1b[32m✔\x1b[0m ${m}`);
const warn = (m) => console.log(`\x1b[33m! ${m}\x1b[0m`);
const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit", env: process.env });
};

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 12)) {
  console.error(`Node ${process.versions.node} is too old. Install Node LTS (22+) from https://nodejs.org and run this again.`);
  process.exit(1);
}
ok(`Node ${process.versions.node}`);

if (!existsSync(".env.local")) {
  copyFileSync(".env.example", ".env.local");
  ok("Created .env.local from .env.example");
} else ok(".env.local exists (kept)");
process.loadEnvFile(".env.local");

// AI provider check: warn only
const provider =
  (process.env.LLM_PROVIDER || "").split(",")[0].trim() ||
  (process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.GEMINI_API_KEY ? "gemini" : process.env.GROQ_API_KEY ? "groq" : "claude-cli");
if (provider === "none") warn("AI is off (LLM_PROVIDER=none). Everything works manually; \"Generar\" uses rules + history.");
else if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) warn("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty: AI features will show a warning and fall back.");
else if (provider === "gemini" && !process.env.GEMINI_API_KEY) warn("LLM_PROVIDER=gemini but GEMINI_API_KEY is empty: AI features will show a warning and fall back.");
else if (provider === "claude-cli") {
  const claude = spawnSync("claude", ["--version"], { encoding: "utf8", shell: true });
  if (claude.status === 0) ok(`AI: Claude Code ${claude.stdout.trim()} (your Claude subscription). If it's not logged in yet, run \`claude\` once.`);
  else
    warn(
      "AI: Claude Code CLI not found. The app works without it (AI buttons fall back with a warning).\n" +
        "  To enable AI: install Claude Code (https://claude.com/claude-code) and run `claude` once to log in,\n" +
        "  or put GEMINI_API_KEY / ANTHROPIC_API_KEY in .env.local.",
    );
} else ok(`AI: ${provider}`);

run("npm install --no-audit --no-fund");
run("npm run db:push");
run("npm run db:seed");
if (!process.argv.includes("--no-build")) run("npm run build");

console.log(`\n\x1b[32mListo.\x1b[0m Start with \x1b[1mnpm start\x1b[0m (Windows: Iniciar.cmd, Linux/macOS: ./iniciar.sh) and open http://localhost:${process.env.PORT || 3000}`);
