# Menú del día · La Sazón de Luis

Plans the daily menu (entradas + segundos together at S/13, extras priced separately), renders the menu image and
the WhatsApp text, and builds the shopping list with quantities that learn from corrections. The app UI is in Spanish.

## Install on a computer (Windows or Linux/macOS)

The installers are safe to run again at any time. Running one again **updates** the app (`git pull`, new packages,
database changes, rebuild) and keeps your data and settings.

**Windows.** In PowerShell:
```
irm https://raw.githubusercontent.com/xvanov/menu-creator/main/install.ps1 | iex
```
Or, if you already have the folder, double-click **`Instalar.cmd`**. Options:
`install.ps1 -Dir C:\menu -NoAI -Autostart -NoStart`.

**Linux / macOS:**
```
curl -fsSL https://raw.githubusercontent.com/xvanov/menu-creator/main/install.sh | bash
```
Or run `./install.sh` inside the folder. Options: `--dir PATH --no-ai --service --no-start`.
`--service` runs it as a systemd service that starts on boot.

What the installer does:
1. Installs **Node.js LTS** and **Git** if they're missing: winget on Windows; nvm (no sudo) plus the package manager on Linux.
2. Clones the repo into `~/menu-creator`, or updates it if it's already there.
3. Installs **Claude Code** for the AI features if it's missing. Run `claude` once afterwards to log in with your
   Claude account; the AI then uses your subscription and needs no API key. This step is optional: without it the
   app works and shows a warning.
4. Runs `npm run setup`: packages, `.env.local`, database, history data, production build.
5. Windows: creates a **"Menu del dia"** desktop shortcut (plus a Startup shortcut with `-Autostart`) and opens
   http://localhost:3000.

After installing: open the desktop shortcut, **`Iniciar.cmd`** (Windows) or **`./iniciar.sh`**. Manual
equivalent: `npm run setup` then `npm start`.

The database is the local file `local.db` (not in git). Each computer starts from the history in `data/`.
To wipe it and start over: `npm run db:reset`.

## Put it on the internet (≈ $0)

- **Vercel Hobby** (free, personal use): `npm run deploy:vercel`
- **Google Cloud Run** (free tier, commercial OK, needs a card): `npm run deploy:gcp`

Both use a free Turso database and optional Gemini free-tier AI, and add a PIN login. See **`docs/DEPLOY.md`**.

## AI: optional, with a choice of provider

| Provider | How | Cost |
|---|---|---|
| Claude Code CLI (default locally) | Installed by the installer, log in once | Included in your Claude subscription |
| Gemini API | `GEMINI_API_KEY` in `.env.local` ([get a key](https://aistudio.google.com/apikey)) | Free tier (Google may use free-tier prompts to improve products) |
| Groq | `GROQ_API_KEY` ([get a key](https://console.groq.com/keys)) | Free tier, no card (~1,000 requests/day) |
| Anthropic API | `ANTHROPIC_API_KEY` | ≈ $0.05–0.15 / day at this usage |

Several keys = automatic fallback: when one provider hits its quota (e.g. Gemini `429`), the next one is used.
| None | `LLM_PROVIDER=none` | $0; everything manual |

With no working AI, the header shows "IA no disponible" and a yellow note explains why. AI buttons fall back:

| Feature | Without AI | With AI |
|---|---|---|
| **Generar** (menu) | Rules + history: weekday habits, days since last served, popularity, plus randomness, so repeated runs differ | — |
| **Generar con IA** | Falls back to Generar, with a note | Picks and explains the menu, can suggest one new dish a week |
| Typing a new dish | Keyword classification | AI refines the category and tags |
| Recipes / quantities | Type them in on the dish page | AI drafts them |
| Storage "Pegar lo que hay" | Edit stock by hand | AI reads the pasted WhatsApp message |
| Rules "en palabras" | Use the rule form | AI turns the sentence into a rule |

Usage is light. After the one-time recipe drafting (about 30 calls for the whole catalog), a normal day is 0–5 calls.

## Screens

- **Menú** (`/`): tomorrow by default. Every item can be edited: swap, pin, remove, type a replacement, change portions and extra prices. Menu image 1080×1350 (PNG) and WhatsApp text.
- **Compras**: recipes × portions (20 per dish by default) − storage. Editable. "Confirmar cantidades" makes the system learn.
- **Almacén**: what's in storage, and prices per unit (used for dish costs).
- **Platos**: dish catalog, recipes, costs. **Reglas**: add, edit or delete rules. **Historial**. **Ajustes**: menu price, structure per weekday, extras, portions, generation time.

Tomorrow's menu is generated automatically at 17:00 Lima time while the app is running (in the cloud: Cloud Scheduler).

## Configuration

`.env.local`, created from `.env.example` and documented there: AI provider and keys, database, `APP_PIN`,
`CRON_SECRET`, `DISABLE_MENU_SCHEDULER`, `BACKGROUND_INLINE`.

## Developers

`docs/PRD.md` (product), `docs/ARCHITECTURE.md` (architecture and contracts), `docs/DEPLOY.md` (cloud),
`data/README.md` (data provenance). Checks: `npm run typecheck && npm run lint && npm test`.
