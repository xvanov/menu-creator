# Architecture

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind v4 · Drizzle ORM on libSQL (SQLite file locally, Turso later) · zod.
Next 16 is new: read `node_modules/next/dist/docs/` before using an API (async `params`, `proxy.ts` instead of middleware, etc.).

```
npm run db:push     # create/alter tables from src/db/schema.ts
npm run db:seed     # load data/*.json (keeps recipes & app-made menus); db:reset wipes everything
npm run dev         # http://localhost:3000
npm run typecheck && npm run lint && npm test
```

## Conventions

- **UI in Spanish**, mobile-first. Use the primitives in `src/components/ui.tsx` and the template palette
  (`bg-page`, `bg-paper`, `text-ink`, `text-red`, `bg-red-strong`, `border-orange`, `bg-yellow`, `font-heading`).
  Section headers look like the menu: number + uppercase title + orange rule (`SectionHeader`).
- **Reads:** pages are Server Components that call `src/lib/*` directly. **Writes:** Client Components call
  Route Handlers under `src/app/api/**` with `fetch`, then `router.refresh()` (or update local state from the response).
- Route handlers validate bodies with zod and return JSON. `params` is a Promise in Next 16: `const { date } = await params`.
- Server-only modules start with `import "server-only"`. Scripts in `scripts/` must not import them.
- **LLM:** only through `getLlm()` from `src/lib/llm` (`complete({ system, prompt, schema, tier })`, zod schema →
  structured output). Calls take 10–60 s. Every LLM feature must degrade gracefully when it throws
  (`LlmUnavailableError`, timeout): show a message and keep the deterministic path working. Never call the LLM
  during page render; only from explicit actions (buttons) or background work.
- Every user-facing value is editable: dishes, prices, costs, portions, ingredients, quantities, rules, settings.
- Dates are `YYYY-MM-DD` service dates. `weekdayOf(date)` gives the Spanish weekday. The restaurant is closed on Sunday.

## Data model (`src/db/schema.ts`)

`dishes` (catalog: course, category, tags, status activo/nuevo/archivado, `price` for extras, `costPerPortion`
override, `defaultPortions`) · `ingredients` (unit, store section, price per unit, **stockQty = storage**) ·
`recipeItems` (dish × ingredient: `qtyPerPortion`, `fixedQty`, source ai/manual/learned) · `menus` (one per date,
borrador/publicado, `menuPrice` fixed at 13 for entrada+segundo) · `menuItems` (display `name`, optional `dishId`,
course, `price` for extras, `portions`, pinned) · `shoppingLines` (per menu; `needed`, `inStock`, `quantity`,
`suggested`, `edited`) · `corrections` (learning log) · `rules` (params: `RuleParams` in `src/lib/types.ts`) ·
`settings` (key → JSON, typed as `Settings`) · `shoppingNotes` (chat knowledge, read-only).

## Ownership (parallel build)

| Area | Owner | Files |
|---|---|---|
| Foundation | lead | `src/db/**`, `src/lib/{types,settings,menus}.ts`, `src/lib/llm/**`, `src/components/{ui,nav}.tsx`, `src/app/{layout,page}.tsx`, `globals.css`, `scripts/seed.ts` |
| **A. Menu engine** | agent A | `src/lib/rules/**`, `src/lib/generator/**`, `src/lib/dishes.ts`, `src/app/api/menus/**`, `src/app/api/rules/**`, `src/app/api/cron/**`, `src/app/reglas/**`, `src/instrumentation.ts`, tests `src/lib/rules/*.test.ts` |
| **B. Menu UI & design** | agent B | `src/app/menu/**`, `src/components/menu-poster/**`, `src/components/menu-editor/**`, `src/lib/whatsapp.ts`, `src/app/historial/**`, `src/app/platos/**`, `src/app/api/dishes/**`, `src/app/ajustes/**`, `src/app/api/settings/**`, `public/assets/**` |
| **C. Recipes, shopping, storage** | agent C | `src/lib/recipes/**`, `src/lib/shopping/**`, `src/app/api/recipes/**`, `src/app/api/shopping/**`, `src/app/api/ingredients/**`, `src/app/compras/**`, `src/app/almacen/**`, `src/components/recipe-editor.tsx` |

Touch only your files. If you need a change in a shared/foundation file, keep it minimal and additive (e.g. a new
type export) and mention it in your final report.

## Cross-area contracts

### Menu API (A implements, B consumes). All return `MenuPayload` (`src/lib/types.ts`) unless noted.
- `GET  /api/menus/[date]` → payload (`menu: null` if not created yet)
- `POST /api/menus/[date]/generate` `{ useLlm?: boolean }` → builds the whole menu (keeps pinned items), validates, saves as borrador
- `PATCH /api/menus/[date]` `{ status?, menuPrice? }` → publish/unpublish, price
- `POST /api/menus/[date]/items` `{ course, name, dishId?, price?, portions? }` → add an item
- `PATCH /api/menus/[date]/items/[id]` `{ name?, dishId?, price?, portions?, pinned? }` → edit. **Typing a new name
  with no `dishId`** resolves to an existing dish by (normalized) name, or creates a `nuevo` dish classified by the LLM
  (category/tags/protein), falling back to a heuristic.
- `DELETE /api/menus/[date]/items/[id]`
- `POST /api/menus/[date]/items/[id]/swap` `{ useLlm?: boolean }` → replace one item with another valid dish
- Payload `menu.warnings` = current rule violations (validated after every mutation).
- After every item mutation A calls `onMenuItemsChanged(menuId)` from `src/lib/shopping` (C implements).

### Rules API (A)
- `GET/POST /api/rules`, `PATCH/DELETE /api/rules/[id]`. Params shape is `RuleParams`. A `text` rule is free text
  passed to the LLM during generation.
- The `/reglas` UI lets people add/edit/delete/enable rules with a form per type (filters pick courses,
  categories, tags and dish names). It also offers a "describe the rule in words" box that the LLM turns into `RuleParams`.

### Dishes & settings API (B)
- `GET /api/dishes?q=&course=&status=` (search/autocomplete), `POST /api/dishes`, `PATCH/DELETE /api/dishes/[id]`
- `GET/PATCH /api/settings` (`Settings`)

### Shopping & recipes (C)
- `onMenuItemsChanged(menuId)` in `src/lib/shopping/index.ts` (see stub).
- `GET /api/shopping/[date]`, `POST /api/shopping/[date]/recompute`, `POST /api/shopping/[date]/lines`,
  `PATCH/DELETE /api/shopping/[date]/lines/[id]`
- `GET/PUT /api/recipes/[dishId]`, `POST /api/recipes/[dishId]/draft` (LLM)
- `GET/POST /api/ingredients`, `PATCH/DELETE /api/ingredients/[id]` (incl. `stockQty` = storage)
- `<RecipeEditor dishId />` from `src/components/recipe-editor.tsx` (B embeds it in `/platos/[id]`).
