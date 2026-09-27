# Operations & lessons learned

Read this before touching deployments, databases or environment variables. It records how the live app is wired
and the mistakes already made once (incident of 2026-09-27: the owner's custom menu "disappeared").

## How the live app is wired

| Piece | Where |
|---|---|
| Site | https://sazon-de-luis.vercel.app (Vercel team `la-sazon-de-luis`, project `menu-creator`), PIN-protected (`APP_PIN`) |
| Deploys | Every push to `main` on GitHub (`xvanov/menu-creator`) deploys to Production automatically |
| Build | `vercel.json` → `npm run vercel-build` (`scripts/vercel-build.mjs`) |
| Database | Turso database **`sazon-de-luis`**, the one fixed database, via `DATABASE_URL` + `DATABASE_AUTH_TOKEN` (Production) |
| AI | Provider chain from the API keys present (`GEMINI_API_KEY`, `GROQ_API_KEY`, …), see "AI providers" |
| Nightly menu | Vercel Cron → `/api/cron/generate` (22:00 UTC = 17:00 Lima), authorized by `CRON_SECRET` |
| Diagnostics | `/api/admin/status` (behind the PIN): live database host, env flags (booleans), counts, app menus, AI chain |

**Check `/api/admin/status` after any deploy-related change.** `database` must be `libsql://sazon-de-luis-…`.

## Rules that prevent data loss

1. **Never let the app use a per-deployment database.** The Vercel ↔ Turso integration sets `TURSO_DATABASE_URL` /
   `TURSO_AUTH_TOKEN` to a **new database for every deployment** (`dpl-<first 22 chars of the deployment id,
   lowercased>-vercel-icfg-….turso.io`). If the app reads those, every redeploy starts blank: menus vanish and
   deleted rules come back. The app prefers `DATABASE_URL` / `DATABASE_AUTH_TOKEN`, which point at `sazon-de-luis`.
   Keep them set. The integration still creates throwaway `dpl-*` databases on each deploy; they're harmless,
   but the free plan allows 100, so delete them in Turso now and then.
2. **Deploys never change an existing schema.** `vercel-build` creates tables only when the database is empty.
   For a real schema change, add a migration plan first, back up (Turso point-in-time restore keeps 24 h on the
   free plan), then deploy once with `ALLOW_SCHEMA_PUSH=1` and remove it again.
3. **The seed is non-destructive** (`scripts/seed.ts`): it only adds missing settings keys, default rules on an
   *empty* rules table, missing dishes and historical menus for dates without a menu. `--all` wipes everything;
   never run it against the cloud.
4. **Local and cloud are separate databases.** `local.db` on a computer ≠ the live Turso database. Menus made at
   `localhost` are not on the live site. Copy with `npm run push:cloud` (`--list` to compare; it never overwrites
   a cloud menu with dishes unless `--overwrite`). `--recipes-only` shares recipes without touching menus: a
   handy way to draft recipes locally with the Claude subscription when the cloud's free AI quota is used up.
   Test data created locally (dishes, menus) goes up too, so delete test artifacts first.
5. **Never test against real data.** Use a copy or a throwaway database (see "Testing Turso locally"). A reorder test
   once changed the owner's real local menu.
6. **The UI must always show what's saved.** Editors use `useServerSync` (`src/components/use-server-sync.ts`) to
   re-read on mount, back/forward restore and tab focus. Next.js restores old page copies on Back, which looks
   exactly like lost edits. Every write goes to the API immediately (number fields save ~0.8 s after typing).

## Secrets and env vars

- Vercel env vars are **"sensitive"**: they can't be read back (`vercel env pull` writes placeholders, and the
  dashboard hides them). Keep the working values in the git-ignored `.env.deploy`.
- `.env.deploy` (git-ignored) holds `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` for `sazon-de-luis` and `APP_PIN`.
  Scripts read it programmatically. **Never print or echo values**; print names, lengths or masked hosts only.
- Set Vercel env vars from scripts by piping the value on stdin: `vercel env add NAME production`.
- `vercel link` appends `.vercel` and `.env*` to `.gitignore`. A trailing `.env*` overrides `!.env.example`, so fix
  it. Scratch helpers are named `_*.mjs` / `_*.json`, which are git-ignored.
- The Turso token from Vercel Storage is scoped to **one database**. It gives 401 on the `dpl-*` databases.

## Getting data out of an old deployment

Each old deployment keeps running with its own environment, and therefore its own database. Deployment URLs
(`menu-creator-<hash>-la-sazon-de-luis.vercel.app`) sit behind Vercel protection. Use
`npx vercel curl <url>/api/menus/<date> -- -s -H "Cookie: menu_pin=<sha256('menu-del-dia:'+APP_PIN)>"` with the
local Vercel login. List deployments with `npx vercel ls`, and get IDs with `npx vercel inspect <url>` (it prints to stderr).

## AI providers

- `LLM_PROVIDER` is a name or a fallback chain (`gemini,groq`). Unset means every provider with a key, in the order
  anthropic → gemini → groq → openai. With no keys it uses the local Claude Code CLI. Each failure (429 quota,
  outage, invalid JSON) falls through to the next provider.
- **Gemini free tier** runs out quickly on batch recipe drafting (429 "exceeded your current quota"). On a 429 the
  provider drops from `gemini-3.8-flash` to `gemini-3.5-flash-lite` first. Adding `GROQ_API_KEY` (free, no card,
  about 1,000 requests a day, `openai/gpt-oss-120b`) gives a second free provider. Groq's structured outputs use
  non-strict `json_schema`, because strict mode requires every field to be mandatory, which our schemas aren't.
- Free-tier prompts (Gemini) may be used by Google; don't send personal data.

## Testing Turso locally

WSL Ubuntu has the Turso CLI and `sqld`:
`wsl -d Ubuntu -- bash -lc "cd /tmp && exec ~/.turso/sqld --db-path /tmp/t.sqld --http-listen-addr 0.0.0.0:8089"`
(run as a background task). Then point scripts at `http://127.0.0.1:8089` with `SKIP_ENV_LOCAL=1 DATABASE_URL=…`.
This is how the "does a redeploy wipe data" question was answered (it didn't; the per-deployment database did).

## This Windows machine

- The Git Bash tool, and Claude Code's `!` prefix, fail with `add_item … errno 1`. Use PowerShell. `git clone`
  of a local path fails for the same reason; use `git archive` to get a clean copy.
- Don't edit files with PowerShell `Get-Content -Raw` / `Set-Content`: that corrupts UTF-8 (Spanish accents) and adds BOMs.
  Use the Edit/Write tools, or `[IO.File]::ReadAllText(…, UTF8)` with a no-BOM `UTF8Encoding`.
- PowerShell mangles quoted arguments to native tools (commit messages with quotes, JSON). Use `git commit -F file`
  and pass JSON through files or stdin.
- Docker (Rancher Desktop) runs **Windows** containers only, so Linux images can't be built here. Cloud Build does it.
- `node` exiting while HTTP handles are open prints `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`. It's harmless.

## Before saying "done"

`npx tsc --noEmit && npx eslint src scripts && npx vitest run`. For UI changes, run the app and screenshot it
(`msedge --headless=new --screenshot`; its minimum width is about 500 px). For deploys, check `/api/admin/status`
and read back the data you expect.
