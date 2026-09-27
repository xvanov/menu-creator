# Deploying to the internet ($0)

Two supported setups. Both are free at this size, and both use **Turso** (free plan) as the database, with the
same code as the local SQLite file. Checked 2026-09-26.

| | **A. Vercel Hobby** (simplest) | **B. Google Cloud Run** |
|---|---|---|
| Command | `npm run deploy:vercel` | `npm run deploy:gcp` |
| Cost | $0 | $0 (free tier: 2M requests, 180k vCPU-s / month) |
| Allowed use | **Personal, non-commercial only** (Vercel fair-use terms) | Commercial OK |
| Card needed | No | Yes (Google billing account; set a $1 budget alert) |
| Nightly generation | Vercel Cron from `vercel.json` (runs within ~1 h after 17:00 Lima) | Cloud Scheduler at exactly 17:00 Lima |
| Background work | Works normally (`after()`) | Runs inside the request (`BACKGROUND_INLINE=1`): saving a new dish can take 10–60 s |
| Function time limit | 300 s | 600 s (configurable) |

Database: **Turso free** (5 GB, 500M row reads, 10M writes per month).
AI (optional): **Gemini** free tier (`GEMINI_API_KEY`; Google may use free-tier prompts to improve products, so
don't send personal data) or the Anthropic API (~$0.05–0.15/day). The Claude Code CLI isn't available in the cloud.
Without a key the app runs without AI and shows a warning.

Not chosen: Render's free tier sleeps and isn't meant for production. Fly.io and Railway have no free allowance for this.

## Deploy

Do the local install first (`install.ps1` / `install.sh`), then run one of the commands above from the app folder.
Both are safe to run again, and running again updates the deployment. They ask once and save the answers in
`.env.deploy` (git-ignored, keep it private). Edit that file and re-run to change something.

Both commands:
1. **Database:** if the `turso` CLI is installed, it creates the database. Otherwise it asks you to create one at
   https://app.turso.tech and paste its URL (`libsql://…`) and a token. It then creates the tables and loads the
   history. Only missing data is added, so re-running never overwrites edits.
2. **Settings:** asks for the app **PIN** and an optional Gemini or Anthropic key, and generates `CRON_SECRET`.

`deploy:vercel` then logs in to Vercel (via `npx vercel`, no global install), links the project `menu-del-dia`,
sets the production env vars and deploys.

`deploy:gcp` also:
- installs the Google Cloud CLI if missing, and logs in;
- creates the project and links billing;
- enables the APIs;
- builds the `Dockerfile` with Cloud Build and deploys to Cloud Run;
- creates or updates the 17:00 Cloud Scheduler job.

## How the cloud instance differs from a local install

- **PIN login** (`APP_PIN`): everyone who opens the URL enters the shared PIN once per device.
- **AI** comes from an API key, not your Claude subscription.
- **Data is separate** from any local install. The cloud database starts from the history in `data/`.

## Useful commands

```
npx vercel logs <deployment-url>                                           # Vercel logs
gcloud run services logs read menu-del-dia --region us-east1 --limit 50    # Cloud Run logs
gcloud scheduler jobs run menu-del-dia-generate --location us-east1        # generate tomorrow now (Cloud Run)
```
