# PRD — Menu Creator for La Sazón de Luis

Status: v0.2 (2026-09-26), with decisions in §11 · Owner: Kalin Ivanov · Restaurant: La Sazón de Luis (Restaurant Criollo, 2do Piso · Stand 1148–1149)

## 1. Problem

Every day the restaurant decides a new *menú del día* (entradas + segundos at a fixed S/13, plus extras
with their own prices), writes it up for WhatsApp, and works out what to buy for the next day. Today this
happens in a WhatsApp group by memory. The results:

- Combinations sometimes break the kitchen's own rules. The owner's example is "crema de arveja + frijoles is
  too heavy", yet the history shows it happened 5 times (e.g. 2026‑03‑19: crema de arveja + arvejita partida).
- Shopping quantities are guessed and corrected by chat ("Cebolla solo te traes 4 kilos", "Yungay solo traer 5 kilos").
- The daily menu image/post is built by hand.

## 2. Goal (MVP)

A simple web app, running on localhost first and deployable to Vercel later, that each day:

1. **Proposes the next day's menu.** It follows the restaurant's structure and combination rules, reuses
   dishes from the history, and can invent new dishes that are similar to past ones.
   It is generated automatically the evening before, and a **"Regenerar"** button can rebuild it at any time.
2. **Lets a person edit it** by swapping, adding or removing dishes and editing extras and prices.
3. **Renders the menu** in the provided design (1080×1350 post) and as WhatsApp-ready
   text in the same format they post today.
4. **Produces a shopping list** with quantities per ingredient, taking stock on hand into account.
5. **Learns from corrections.** When someone fixes a quantity, or later confirms what was actually used, the
   next estimate for that dish/ingredient gets better.

Non-goals for MVP: **dinner service (cena) and the second stall** (MVP plans lunch only, with one shopping list), the story format, taking orders, POS or payments, multi-restaurant support, user accounts beyond a simple
shared login, publishing to WhatsApp or Instagram automatically, cost accounting, or pricing optimization.

## 3. Users

| User | Needs |
|---|---|
| Owner / admin | Approve the menu, set rules and extras, see costs later |
| Menu poster (front of house) | Final menu text and image to post each morning |
| Cooks / buyers | Tomorrow's shopping list; report stock on hand and leftovers; correct quantities |

All UI is in **Spanish**. Mobile-first: the team lives on their phones.

## 4. What the data tells us (history: 2025‑12‑29 → 2026‑09‑26, 209 service days, Mon–Sat)

Source: `data/menus.json` (normalized), `data/dishes.json` (171 canonical dishes), `data/shopping_notes.json`.

- **Structure in practice:** usually 3 entradas + 4 segundos (136 of 209 days). 4 + 5 happened only 11 times.
  The owner described 4 + 5, so this is an open question (see Q1).
- **Entradas:** there is always one soup (209/209). The other slots are usually a cold dish (papa a la huancaína,
  ocopa, causa, ceviche), a salad, a fried item (tequeños, wantán, yuca frita, salchipapa) or tamal/humita.
- **Segundos:** a menestra on 131/209 days, never more than one. It is always there on Monday, Tuesday and Friday,
  about 40% of the time on Wednesday and Thursday, and rarely on Saturday.
  - Strong weekday habits: **Monday = lentejas** (37/37), **Friday = frijoles** (33/34), Tuesday = garbanzo /
    panamito / pallares, Wednesday and Thursday = arvejita partida.
  - The rest is 1–2 guisos plus one of: arroz dish, pasta, fritura, saltado, verduras con pollo, segundo frío.
- **Extras:** Pollo broaster S/15 (almost always), Trucha frita S/20, occasionally Churrasco/Bistec a lo pobre
  S/17–20, Arroz chaufa S/15, and specials (Pachamanca 3 sabores S/35, Cuy chactado S/60).
- **Repetition:** a dish comes back after about 9 days (median).
- **Shopping knowledge in the chat** (`data/shopping_notes.json`, 316 notes, 313 tied to a menu date):
  141 stock reports ("hay…"), 70 "no traer", 57 buy orders, 25 missing-for-dish, 15 leftovers, 8 rules.
  - Rules found:
    - Rice: 3 kg of white rice when the menu has tallarín, arroz con pollo, chaufa or jardinera; otherwise 5 kg.
    - Chuleta and churrasco are held in reserve for when chicken pieces run out.
    - Papa para freír: "preferible que sobre a que falte".
    - Onion, ají and rocoto should be cut back because they are expensive (2026‑09‑25).
  - Items most often "don't bring" (overstocked): azúcar (16), limón (12), cebolla (10). The app should check stock before listing these.
  - Rice stock on hand ranges 1–13 kg, median 6 kg. Potato top-ups come in 3–5 kg.
  - Only one full buy list exists (2026‑01‑06: 15 kg cebolla, 20 kg papa yungay, 10 kg papa canchán, 6 kg zanahoria,
    3 kg limón, 3 kg ají amarillo). The rest are partial orders, so quantity data from the chat is thin and recipes plus corrections have to do the work.
- **Portion plans** (`data/portion_plans.json`): the owner rarely posts them. The single lunch plan (2026‑03‑18)
  is 30 / 30 / 20 / 20, about 100 lunches; dinner plans are 10–20 per dish.

## 5. Functional requirements

### 5.1 Dish catalog
- The catalog is seeded from `data/dishes.json`. Each dish has a name, course (entrada/segundo/extra), category,
  base and protein (for combo dishes), and tags (`legumbre`, `pesado`, `frito`, `picante`, `cerdo`, `pescado`, `menudencia`).
- CRUD: add, edit or archive dishes. New dishes created by the AI are marked `nuevo` until someone approves them.
- Each dish has a **recipe**: ingredients with quantity *per portion* plus fixed amounts per batch. Recipes start
  out AI-drafted and are corrected by the team (see 5.5).

### 5.2 Menu generation
- Input: target date, optional "must include" / "exclude" dishes, optional stock on hand ("hay…").
- Output: N entradas, M segundos, and extras, each with a short reason ("lentejas: lunes", "no repetido en 12 días").
- **Structure is set per weekday**: the number of entradas and segundos can differ by day. Default is 3 + 4 on
  every day, which matches the history, and the owner can change any day (e.g. Saturday 4 + 5).
- **Hard rules** (a validator enforces these; the menu is rejected if broken):
  1. Exactly one soup or crema among the entradas.
  2. **Exactly one menestra every day except one day a week** (default Saturday, configurable). Never more than one.
  3. **Soup vs. menestra ("cae pesado")**: when there is a menestra, the soup/crema can't be the same legume or a
     similar one. Concretely:
     - it can't carry the `legumbre` tag (crema de arveja, menestrón, shambar…);
     - it can't share the menestra's main ingredient (arveja ↔ arvejita partida, frijol ↔ frijoles, pallar ↔ pallares).
  4. **At most 1 fried segundo** (category `fritura`, or tag `frito` as the main item). Saturday allows 2.
  5. **At most 1 chancho (pork) dish per week**, counted Mon–Sat across both published and draft menus.
  6. No dish repeats within X days (default 7), except staples that are allowed to repeat (Papa a la huancaína,
     Tamal criollo, Pollo broaster).
  7. The mix of categories follows the configured slots (e.g. menestra + guiso + guiso + one of
     arroz/pasta/fritura/saltado/verduras/frío).
- **Soft preferences** (scored, not enforced): weekday habits (Monday lentejas, Friday frijoles, Tuesday
  garbanzo/panamito/pallares, Wednesday/Thursday arvejita partida), no more than two chicken guisos, seasonality, balance of fried and non-fried,
  "pesado" count ≤ 2, using stock on hand and leftovers, cost.
- **Rules are data, managed in the app** (`/reglas`): add, edit, disable and delete. Rules can be structured
  (counts per day/week, forbidden pairs, no-repeat) or free text that the LLM applies during generation. A rule
  can also be written in words and turned into a structured rule by the LLM, then reviewed before saving.
  The "pesado" rule covers the beans + heavy soup combination: a menestra never goes with a legume or heavy soup
  (crema de arveja, menestrón, shambar, patasca, sancochado, caldo de mote, sopa de morón…).
- **Every item is editable.** Any dish on the menu can be removed, and a replacement can be typed as free text.
  If the name isn't in the catalog, the LLM classifies it as a new dish and drafts its recipe, and the shopping
  list updates automatically.
- **Novelty: about one new dish per week**, built from known parts, for example a known base with a different
  protein ("Guiso de quinua con churrasco"). It is marked `nuevo` and **must be approved** before the menu can be published.
- **Timing:** tomorrow's menu is auto-generated every evening (default 17:00). "Regenerar" works **any time**: it
  swaps one dish or rebuilds the whole menu, keeping pinned dishes. The auto-generation runs only while the app or
  PC is on (locally) or as a Vercel cron job once deployed.
- **Prices:** entrada + segundo always cost S/13 together. That is a single setting, not a per-dish price.
  Only extras have their own prices. Those start from the history and the owner's list and can be edited per
  dish and per day.
- **Costs:** each dish's cost per portion is computed from its recipe and ingredient prices, and the owner can
  override it on the dish.
- **Extras:** there is a fixed list of extras, and 2–3 are picked each day. The default list is Trucha frita S/20,
  Arroz chaufa S/15, Pollo broaster S/15, Lomo saltado S/17 and Churrasco a lo pobre S/20. Names, prices and the
  per-day count are editable. The menu price defaults to S/13.

### 5.3 Menu output
- A **design render** that ports `design/menu-del-dia.template.html` into a React component with the same layout:
  banner, date, price box, and the Entrada / Segundo / Extras sections with auto-fit font size.
  Format: post (1080×1350) only, with the story format left for later. "Descargar PNG" exports the image in the browser.
- **WhatsApp text** in the exact format they post today, with a "Copiar" button:
  ```
  Hola buenos días😊⛅️
  Hoy en la Sazón de Luis tenemos para degustar:
   *MENU*: 🍽️ S/13.00
  *ENTRADA*:
  📌…
  *SEGUNDO*:
  📌…
  *EXTRA*
  📌Pollo broaster S/15.00
  ```
- Publishing a menu saves it to history. Generation reads that history, so published menus feed back in.

### 5.4 Shopping list
- **Portions: default 20 per dish per day**, for every entrada and segundo. Extras get their own default
  (configurable, start at 10). The owner can override the number per dish on the menu screen before the list is
  computed. Portion plans in the chat (`portion_plans.json`) are only used to seed per-dish defaults
  (e.g. carapulcra 30). Over time the default for each dish follows what the owner sets and the close-of-day numbers.
- **Recipes:** Claude drafts ingredients per portion for all 171 catalog dishes as a one-time seed job. The cook
  corrects them, starting with the ~20 most frequent dishes. Every correction feeds the learning in 5.5.
- **Known rules are encoded as config** (from `shopping_notes.json`):
  - Rice: 3 kg if the menu has tallarín, arroz con pollo, chaufa or jardinera; otherwise 5 kg (adjustable).
  - Chuleta and churrasco appear as a reserve line ("reserva por si faltan presas"), not as full portions.
  - Papa para freír rounds up.
  - Azúcar, limón and cebolla are only listed when stock is below a threshold.
- For the published (or draft) menu, the app computes
  **quantity per ingredient = Σ over dishes (per‑portion qty × expected portions) + fixed batch amounts − stock on hand**.
  The result is rounded to the unit people actually buy in (kg, atado, unidad, paquete).
- The list is grouped by where things are bought (mercado/verdura, pollería, carnicería, abarrotes).
- Stock on hand: a quick "Hay…" screen, which can be pre-filled from the last report.
  It accepts free text, and the LLM parses it into items.
- Output: an editable list with a "Copiar para WhatsApp" button.

### 5.5 Learning from corrections
Two feedback signals:
1. **Plan correction.** Someone edits a quantity on the list before buying ("15 kg cebolla → 10 kg").
2. **Actual outcome, after service.** How many portions were sold per dish and what was left over
   ("sobró 2 kg de arroz", "se acabó el asado a la 1 pm").

Model (simple, explainable, and it works without an LLM):
- For each dish, *expected portions* starts at 20 (or its chat seed). It then follows the owner's overrides and
  close-of-day actuals as an exponentially weighted average by weekday.
- For each (dish, ingredient) pair, *per-portion quantity* is updated after each correction with an
  exponential moving average (α≈0.3), weighted by how certain the correction is (plan edit < confirmed actual).
- Every correction is stored as an event (who, when, before → after, reason) so it can be audited and undone.
- Recent corrections are included as context whenever the LLM drafts recipes for new dishes.
- The UI shows a confidence indicator per line (for example "estimado", "aprendido (8 correcciones)").

### 5.6 History and insights (small)
- A calendar of past menus and a "last served" date on every dish. Useful for the no-repeat rule and for staff.

## 6. AI / LLM approach

**MVP: no API keys.** LLM calls go through the locally installed **Claude Code CLI**, on the owner's subscription,
invoked as a subprocess: `claude -p "<prompt>" --output-format json`. The output is validated against a JSON schema.

LLM calls sit behind a single interface, so switching to the API later is a config change:

```ts
interface LlmProvider {
  complete<T>(req: { system: string; prompt: string; schema: JsonSchema }): Promise<T>;
}
// Implementations:
//   ClaudeCodeCliProvider  — MVP, local only (spawns `claude -p`)
//   AnthropicApiProvider   — future: ANTHROPIC_API_KEY, needed for Vercel
//   NoLlmProvider          — deterministic fallback: rules + scoring only
// Selected by env: LLM_PROVIDER=claude-cli | anthropic | none
```

The LLM is used for:
- Picking and explaining the final menu from rule-valid candidates, and proposing new dishes.
  The validator re-checks everything the LLM returns.
- Drafting recipes (ingredients per portion) for new or unknown dishes.
- Parsing free-text "hay…" and leftover messages into structured items.

The LLM is **not** used for the quantity math or for rule enforcement. Both are deterministic code, so the
app stays correct and testable when the LLM is unavailable, and on Vercel before an API key exists.

## 7. Architecture

- **Next.js (App Router) + TypeScript + Tailwind.** One codebase for UI and API routes, and it deploys to Vercel without extra setup.
- **Database: SQLite via Drizzle ORM and libSQL.** Locally it is a file (`local.db`). On Vercel the same code
  points at Turso (hosted libSQL), or it can move to Vercel Postgres.
- **Seed:** a script imports `data/menus.json`, `data/dishes.json`, `data/shopping_notes.json` and `data/portion_plans.json`.
- **Image export:** client-side `html-to-image` on the ported template component. No server rendering needed.
- **Auth:** none on localhost. Once deployed, one shared PIN set by env var (`APP_PIN`) and checked in middleware.
- **Scheduling:** locally, a small in-process scheduler runs the 17:00 generation while the dev server is up.
  On Vercel, a Vercel Cron job does it.
- **Deployment note:** the Claude Code CLI provider can't run on Vercel. Once the app is deployed, it needs either
  `LLM_PROVIDER=anthropic` with an API key, or `none` (rules only), or it keeps generating locally.

Core tables: `dish`, `recipe_item` (dish, ingredient, qty_per_portion, fixed_qty, unit), `ingredient`
(name, buy_unit, store_section), `menu` (date, status), `menu_item` (menu, dish, course, price, position),
`portion_forecast`, `stock_report`, `correction_event`, `rule` (type, params, enabled), `setting`.

## 8. Screens

1. **Hoy / Mañana:** the proposed menu with dish cards (swap, pin, remove) and rule warnings, plus buttons for
   Generar, Aprobar y publicar, Copiar WhatsApp and Descargar imagen.
2. **Compras:** the shopping list for tomorrow, with editable quantities, a "Hay…" stock input and a Copiar button.
3. **Cierre del día:** portions sold and leftovers per dish (optional, 1 minute to fill in).
4. **Platos:** the catalog and recipes.
5. **Reglas y ajustes:** menu structure, extras and prices, weekday menestras, no-repeat window, novelty.
6. **Historial:** a calendar of past menus.

## 9. Milestones

1. **M0 — Data (done):** the WhatsApp export is cleaned into `data/`, the dish catalog is normalized, and shopping notes are extracted.
2. **M1 — Skeleton:** Next.js app, DB schema, seed from `data/`, dish catalog and history screens.
3. **M2 — Generator:** rules engine, scoring and "Generar" with no LLM, plus the template render and WhatsApp text.
4. **M3 — LLM:** the `LlmProvider` abstraction, the Claude Code CLI provider, new-dish proposals and recipe drafting.
5. **M4 — Shopping and learning:** recipes, portion forecast, shopping list, corrections and close-of-day entry.
6. **M5 — Deploy:** Turso + Vercel, the PIN login, and the API provider if they want it.

## 10. Success metrics

- The menu for the next day is ready and approved in under 5 minutes, with zero hard-rule violations.
- The share of shopping-list quantities edited by a person drops week over week.
- Leftovers and "se acabó" events drop compared with the first two weeks.

## 11. Decisions (2026-09-26)

| Topic | Decision |
|---|---|
| Structure | Set per weekday; default 3 entradas + 4 segundos |
| Menestra | Every day except one per week (default Saturday) |
| Combination rules | Soup can't be the same or a similar legume as the menestra; max 1 fried segundo (2 on Saturday); max 1 chancho dish per week |
| Scope | Lunch only, one shopping list |
| Portions | 20 per dish per day by default, seeded from chat, owner overrides |
| Recipes | AI drafts all dishes, the cook corrects them |
| Novelty | About 1 new dish per week, needs approval |
| Extras | Owner's 5 (Trucha S/20, Chaufa S/15, Broaster S/15, Lomo S/17, Churrasco a lo pobre S/20) |
| Timing | Auto-generated the evening before, plus a "Regenerar" button any time |
| Outputs | Post 1080×1350 and WhatsApp text |
| Auth | None locally; PIN once deployed |
| LLM | Claude Code CLI (subscription) behind `LlmProvider`; Anthropic API later via env |

## 12. Still open (not blocking M1–M3)

From `docs/OPEN_QUESTIONS.md`:
- **Template assets.** `assets/banner.png`, fonts and `_ds` styles are needed for a pixel-faithful render.
  M2 can start with fallbacks and a placeholder banner.
- **Weekly menestra habits.** Confirm them as soft preferences, not rules (Q3).
- **"Pesado" tag list.** Confirm which dishes count as heavy (Q10).
- **Other quantity rules** the cooks use (Q18).
- **Dish spellings.** Confirm the standard spellings (Q24).

Resolved: the chat photos will not be read (Q19). Costs per dish are in scope and editable (Q26).
- **Extras per day.** Confirm the default of 2–3.
