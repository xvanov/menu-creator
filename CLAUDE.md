@AGENTS.md

Menu Creator for La Sazón de Luis. Product: `docs/PRD.md`. Architecture, conventions, file ownership and API
contracts: `docs/ARCHITECTURE.md` — read it before changing code. Data provenance: `data/README.md`.
**Deployments, databases, env vars, lessons learned: `docs/OPERATIONS.md` — read it before any deploy/DB work.**
Pushing to `main` deploys the live site immediately.

- Edit files with the Edit/Write tools, not PowerShell `Set-Content` (it breaks UTF-8 accents and adds BOMs).
- UI text is Spanish.
