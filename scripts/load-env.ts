// Import first in scripts so .env.local (e.g. a Turso DATABASE_URL) applies before the db client is created.
// SKIP_ENV_LOCAL=1 (set by the deploy script) uses only the environment given.
import { existsSync } from "node:fs";

if (existsSync(".env.local") && process.env.SKIP_ENV_LOCAL !== "1") process.loadEnvFile(".env.local");
