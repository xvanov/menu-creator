"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DraftJob, DraftOutcome } from "@/lib/recipes";
import { sourceLabel } from "@/lib/recipes/learn";
import type { ConfirmSummary, ShoppingLineView, ShoppingView } from "@/lib/shopping";
import { fmtQty, sectionOrder, shoppingWhatsapp, STORE_SECTIONS } from "@/lib/shopping/units";
import { UNITS } from "@/lib/types";
import { Badge, Button, Card, Input, Label, PageTitle, SectionHeader, Select, Spinner, Textarea, Warning } from "@/components/ui";
import { api, NumberField, Notice, parseNum } from "../_ui";

interface IngredientOption {
  id: number;
  name: string;
  unit: string;
  storeSection: string;
  stockQty: number;
}

const COURSE_LABEL = { entrada: "Entradas", segundo: "Segundos", extra: "Extras" } as const;

function shortDate(date: string) {
  const [, m, d] = date.split("-");
  return `${d}/${m}`;
}

export function ShoppingClient({ initial, ingredients: initialIngredients }: { initial: ShoppingView; ingredients: IngredientOption[] }) {
  const [view, setView] = useState(initial);
  const [ingredients, setIngredients] = useState(initialIngredients);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<React.ReactNode>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [copyText, setCopyText] = useState<string | null>(null);
  const { date, menu } = view;

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  const refresh = useCallback(async () => setView(await api<ShoppingView>(`/api/shopping/${date}`)), [date]);
  const refreshIngredients = useCallback(async () => {
    const r = await api<{ ingredients: IngredientOption[] }>("/api/ingredients");
    setIngredients(r.ingredients);
  }, []);

  // first visit to a menu that never got a list: compute it (deterministic, no LLM)
  const autoComputed = useRef(false);
  useEffect(() => {
    if (autoComputed.current || !menu || view.lines.length || !view.items.length) return;
    autoComputed.current = true;
    void run("recompute", async () => setView(await api<ShoppingView>(`/api/shopping/${date}/recompute`, "POST")));
  }, [menu, view.lines.length, view.items.length, date, run]);

  // recipes being drafted in the background: poll until they're done
  useEffect(() => {
    if (!view.drafting) return;
    const t = setInterval(() => void refresh().catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [view.drafting, refresh]);

  const groups = useMemo(() => {
    const m = new Map<string, ShoppingLineView[]>();
    for (const l of view.lines) m.set(l.section, [...(m.get(l.section) ?? []), l]);
    return [...m.entries()].sort((a, b) => sectionOrder(a[0]) - sectionOrder(b[0]));
  }, [view.lines]);

  const toBuy = view.lines.filter((l) => l.quantity > 0 && !l.checked).length;
  const editedCount = view.lines.filter((l) => l.edited && !l.confirmed).length;

  const patchLine = (id: number, body: Record<string, unknown>) =>
    run(`line-${id}`, async () => setView(await api<ShoppingView>(`/api/shopping/${date}/lines/${id}`, "PATCH", body)));
  const deleteLine = (l: ShoppingLineView) => {
    if (!window.confirm(`¿Quitar "${l.name}" de la lista?`)) return;
    void run(`line-${l.id}`, async () => setView(await api<ShoppingView>(`/api/shopping/${date}/lines/${l.id}`, "DELETE")));
  };

  const recompute = () => run("recompute", async () => setView(await api<ShoppingView>(`/api/shopping/${date}/recompute`, "POST")));

  const confirmQuantities = () =>
    run("confirm", async () => {
      const r = await api<{ view: ShoppingView; summary: ConfirmSummary }>(`/api/shopping/${date}/confirm`, "POST");
      setView(r.view);
      const { learned, portions } = r.summary;
      setNotice(
        learned.length || portions.length ? (
          <div>
            <b>Aprendido.</b> Las próximas listas usarán estas correcciones:
            <ul className="ml-5 list-disc">
              {learned.map((l) => (
                <li key={l.ingredient}>
                  {l.ingredient}: ×{l.ratio.toFixed(2)} {l.dishes.length ? `en ${l.dishes.join(", ")}` : "(sin receta que ajustar)"}
                </li>
              ))}
              {portions.map((p) => (
                <li key={p.dish}>
                  {p.dish}: porciones por defecto {p.before} → {p.after}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          "Cantidades confirmadas. No había correcciones nuevas para aprender."
        ),
      );
    });

  const setPortions = (itemId: number, portions: number | null) =>
    run(`item-${itemId}`, async () => {
      await api(`/api/menus/${date}/items/${itemId}`, "PATCH", { portions: portions == null ? null : Math.round(portions) });
      setView(await api<ShoppingView>(`/api/shopping/${date}/recompute`, "POST"));
    });

  const draftOne = (dishId: number) =>
    run(`draft-${dishId}`, async () => {
      const r = await api<{ outcome: DraftOutcome }>(`/api/recipes/${dishId}/draft`, "POST", {});
      if (r.outcome.status !== "ok") setError(`No se pudo generar la receta: ${r.outcome.message ?? r.outcome.failed[0]?.error ?? "error"}`);
      setView(await api<ShoppingView>(`/api/shopping/${date}/recompute`, "POST"));
      await refreshIngredients();
    });

  const draftMenu = () =>
    run("draft-menu", async () => {
      const r = await api<{ outcome: DraftOutcome | null; view: ShoppingView }>(`/api/shopping/${date}/draft`, "POST");
      setView(r.view);
      if (r.outcome && r.outcome.status !== "ok")
        setError(`Algunas recetas no se pudieron generar (${r.outcome.failed.map((f) => f.name).join(", ")}): ${r.outcome.message ?? ""}`);
      await refreshIngredients();
    });

  const copy = async () => {
    const text = shoppingWhatsapp(
      `*Compras ${view.weekday} ${shortDate(date)}*`,
      view.lines.map((l) => ({ name: l.name, unit: l.unit, quantity: l.quantity, section: l.section, checked: l.checked })),
    );
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Lista copiada. Pégala en el grupo de WhatsApp.");
      setCopyText(null);
    } catch {
      setCopyText(text);
    }
  };

  return (
    <div className="space-y-6">
      <PageTitle
        sub={`${view.weekday} ${shortDate(date)}`}
        actions={
          menu && (
            <>
              <Button onClick={recompute} disabled={!!busy}>
                {busy === "recompute" ? "Calculando…" : "Recalcular"}
              </Button>
              <Button onClick={copy} disabled={!toBuy}>
                Copiar para WhatsApp
              </Button>
              <Button variant="primary" onClick={confirmQuantities} disabled={!!busy} title="Aprende de las cantidades que corregiste">
                {busy === "confirm" ? "Confirmando…" : `Confirmar cantidades${editedCount ? ` (${editedCount})` : ""}`}
              </Button>
            </>
          )
        }
      >
        Compras
      </PageTitle>
      <div className="-mt-4 text-sm">
        <Link href={`/menu/${date}`}>← Ver el menú del {view.weekday}</Link>
      </div>

      {error && <Warning>{error}</Warning>}
      {notice && <Notice tone="ok">{notice}</Notice>}
      {copyText && (
        <Card>
          <Label>No se pudo copiar automáticamente: copia el texto</Label>
          <Textarea rows={10} readOnly value={copyText} onFocus={(e) => e.target.select()} />
        </Card>
      )}

      {!menu ? (
        <Card>
          <p>
            Todavía no hay menú para el {view.weekday} {shortDate(date)}. La lista de compras sale del menú.
          </p>
          <p className="mt-2">
            <Link href={`/menu/${date}`}>Armar el menú del {view.weekday} →</Link>
          </p>
        </Card>
      ) : (
        <>
          <PortionsCard view={view} busy={busy} onPortions={setPortions} onDraft={draftOne} onDraftMenu={draftMenu} />

          <section>
            <SectionHeader num="02" title="Lista de compras" note={`${toBuy} por comprar`} />
            {view.lines.length === 0 && !busy && (
              <p className="text-sm text-ink-soft">No hay nada en la lista todavía. Los platos necesitan receta para calcular las cantidades.</p>
            )}
            <div className="space-y-5">
              {groups.map(([section, lines]) => (
                <div key={section}>
                  <h3 className="mb-1 font-heading text-lg font-semibold uppercase tracking-wide text-red">{section}</h3>
                  <div className="hidden grid-cols-[1.5rem_minmax(0,2fr)_5rem_6rem_6rem_4rem_4.5rem] gap-2 px-1 font-heading text-[11px] font-semibold uppercase tracking-wider text-ink-soft md:grid">
                    <span />
                    <span>Ingrediente</span>
                    <span className="text-right">Necesario</span>
                    <span>En almacén</span>
                    <span>Comprar</span>
                    <span>Unidad</span>
                    <span />
                  </div>
                  {lines.map((l) => (
                    <LineRow
                      key={l.id}
                      line={l}
                      busy={busy === `line-${l.id}`}
                      open={open.has(l.id)}
                      onToggle={() =>
                        setOpen((s) => {
                          const n = new Set(s);
                          if (n.has(l.id)) n.delete(l.id);
                          else n.add(l.id);
                          return n;
                        })
                      }
                      onPatch={(b) => patchLine(l.id, b)}
                      onDelete={() => deleteLine(l)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </section>

          <AddLine
            ingredients={ingredients}
            busy={busy === "add"}
            onAdd={(body) =>
              run("add", async () => {
                setView(await api<ShoppingView>(`/api/shopping/${date}/lines`, "POST", body));
                await refreshIngredients();
              })
            }
            onStock={(item) =>
              run("add", async () => {
                await api("/api/ingredients/stock", "POST", { items: [item] });
                setView(await api<ShoppingView>(`/api/shopping/${date}/recompute`, "POST"));
                await refreshIngredients();
                setNotice(`Anotado en almacén: ${fmtQty(item.qty)} ${item.unit ?? ""} de ${item.name}.`);
              })
            }
          />
        </>
      )}

      <DraftMissingCard onDone={() => void refresh().catch(() => {})} />
    </div>
  );
}

function PortionsCard({
  view,
  busy,
  onPortions,
  onDraft,
  onDraftMenu,
}: {
  view: ShoppingView;
  busy: string | null;
  onPortions: (itemId: number, p: number | null) => void;
  onDraft: (dishId: number) => void;
  onDraftMenu: () => void;
}) {
  const total = view.items.filter((i) => i.course !== "extra").reduce((s, i) => s + i.portions, 0);
  const missing = view.missingRecipes.filter((m) => !m.drafting);
  return (
    <section>
      <SectionHeader num="01" title="Porciones" note={`${total} platos de menú`} />
      <Card className="space-y-3">
        {(["entrada", "segundo", "extra"] as const).map((course) => {
          const items = view.items.filter((i) => i.course === course);
          if (!items.length) return null;
          return (
            <div key={course}>
              <Label>{COURSE_LABEL[course]}</Label>
              {items.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center gap-2 border-b border-line py-1.5">
                  <span className="diamond" />
                  <span className="min-w-0 flex-1">
                    {i.dishId ? <Link href={`/platos/${i.dishId}`} className="text-ink no-underline hover:text-red">{i.name}</Link> : i.name}
                    {!i.dishId && <span className="ml-2 text-xs text-ink-soft">(sin plato en el catálogo)</span>}
                    {i.dishId && !i.hasRecipe && !i.drafting && (
                      <>
                        <Badge tone="red">sin receta</Badge>
                        <Button variant="ghost" className="ml-1 !px-1.5 !py-0.5" onClick={() => onDraft(i.dishId!)} disabled={!!busy}>
                          {busy === `draft-${i.dishId}` ? "Generando…" : "Generar receta"}
                        </Button>
                      </>
                    )}
                    {i.drafting && <Spinner label="generando receta…" />}
                  </span>
                  <span className="flex items-center gap-1 text-sm">
                    <NumberField
                      label={`Porciones de ${i.name}`}
                      className="!w-16 text-right"
                      value={i.portions}
                      allowEmpty
                      disabled={busy === `item-${i.id}`}
                      onCommit={(v) => onPortions(i.id, v == null || v === i.defaultPortions ? null : v)}
                    />
                    <span className="w-16 text-xs text-ink-soft">{i.portionsSet ? `(normal ${i.defaultPortions})` : "porciones"}</span>
                  </span>
                </div>
              ))}
            </div>
          );
        })}
        {view.drafting && (
          <Notice>
            <Spinner label="La IA está escribiendo las recetas que faltan; la lista se completa sola en unos segundos." />
          </Notice>
        )}
        {missing.length > 0 && (
          <Warning>
            Faltan en la lista los ingredientes de {missing.map((m) => m.name).join(", ")} porque no tienen receta.{" "}
            <Button variant="ghost" className="!px-1.5 !py-0.5" onClick={onDraftMenu} disabled={!!busy}>
              {busy === "draft-menu" ? "Generando…" : "Generar recetas de este menú"}
            </Button>
          </Warning>
        )}
        {view.unlinked.length > 0 && (
          <p className="text-xs text-ink-soft">
            Sin plato del catálogo (no suman a la lista): {view.unlinked.map((u) => u.name).join(", ")}. Corrígelos en el menú.
          </p>
        )}
      </Card>
    </section>
  );
}

function LineRow({
  line: l,
  busy,
  open,
  onToggle,
  onPatch,
  onDelete,
}: {
  line: ShoppingLineView;
  busy: boolean;
  open: boolean;
  onToggle: () => void;
  onPatch: (b: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const hasBreakdown = l.contributions.length > 0;
  return (
    <div className={`border-b border-line px-1 py-2 ${l.checked ? "opacity-50" : ""}`}>
      <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 md:grid-cols-[1.5rem_minmax(0,2fr)_5rem_6rem_6rem_4rem_4.5rem]">
        <input type="checkbox" className="h-4 w-4 accent-[var(--red)]" checked={l.checked} onChange={(e) => onPatch({ checked: e.target.checked })} aria-label={`Comprado: ${l.name}`} />
        <div className="min-w-0">
          <button type="button" onClick={onToggle} className="text-left font-semibold hover:text-red" disabled={!hasBreakdown} title={hasBreakdown ? "Ver de qué platos sale" : undefined}>
            {l.name} {hasBreakdown && <span className="text-xs text-orange">{open ? "▾" : "▸"}</span>}
          </button>
          <div className="flex flex-wrap items-center gap-1">
            {l.source === "manual" && <Badge tone="orange">a mano</Badge>}
            {l.source === "regla" && <Badge>regla</Badge>}
            {l.edited && <Badge tone={l.confirmed ? "green" : "orange"}>{l.confirmed ? "confirmado" : `corregido (era ${fmtQty(l.suggested)})`}</Badge>}
            {l.note && <span className="text-xs text-ink-soft">{l.note}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 md:contents">
          <span className="hidden text-right text-sm md:block" title="Lo que piden las recetas">
            {fmtQty(l.needed)}
          </span>
          <span className="hidden md:block">
            <NumberField label={`En almacén: ${l.name}`} className="!py-1 text-right" value={l.inStock} disabled={busy} onCommit={(v) => onPatch({ inStock: v ?? 0 })} />
          </span>
          <NumberField
            label={`Comprar: ${l.name}`}
            className={`!w-20 !py-1 text-right font-semibold md:!w-full ${l.edited ? "!border-orange" : ""}`}
            value={l.quantity}
            disabled={busy}
            onCommit={(v) => onPatch({ quantity: v ?? 0 })}
          />
          <span className="text-sm">{l.unit}</span>
          <Button variant="ghost" className="!px-1.5" onClick={onDelete} disabled={busy} aria-label={`Quitar ${l.name}`}>
            ✕
          </Button>
        </div>
      </div>
      {/* mobile: needed + storage under the name */}
      <div className="mt-1 flex items-center gap-2 pl-8 text-xs text-ink-soft md:hidden">
        <span>Necesario {fmtQty(l.needed)} {l.unit}</span>
        <span>· En almacén</span>
        <NumberField label={`En almacén: ${l.name}`} className="!w-16 !py-0.5 text-right text-xs" value={l.inStock} disabled={busy} onCommit={(v) => onPatch({ inStock: v ?? 0 })} />
      </div>
      {open && hasBreakdown && (
        <ul className="mt-1 space-y-0.5 pl-8 text-xs text-ink-soft">
          {l.contributions.map((c, i) => (
            <li key={i}>
              {c.kind === "regla" ? (
                <>
                  {c.label}: <b>{fmtQty(c.qty)} {l.unit}</b>
                </>
              ) : (
                <>
                  {c.dishId ? <Link href={`/platos/${c.dishId}`}>{c.label}</Link> : c.label}: {c.portions} porc. × {fmtQty(c.qtyPerPortion ?? 0)}
                  {c.fixedQty ? ` + ${fmtQty(c.fixedQty)} fijo` : ""} = <b>{fmtQty(c.qty)} {l.unit}</b> · {sourceLabel(c.source ?? "ai", c.corrections)}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type AddBody = { ingredientId?: number | null; name: string; unit?: string; quantity: number; note?: string | null; storeSection?: string };
type StockBody = { ingredientId?: number | null; name: string; unit?: string; storeSection?: string; qty: number };

function AddLine({ ingredients, busy, onAdd, onStock }: { ingredients: IngredientOption[]; busy: boolean; onAdd: (b: AddBody) => void; onStock: (b: StockBody) => void }) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("kg");
  const [section, setSection] = useState<string>("mercado");
  const [note, setNote] = useState("");
  const match = ingredients.find((i) => i.name.toLocaleLowerCase("es") === name.trim().toLocaleLowerCase("es"));
  const q = parseNum(qty);
  const valid = name.trim().length > 0 && q != null;
  const reset = () => {
    setName("");
    setQty("");
    setNote("");
  };
  const base = { ingredientId: match?.id ?? null, name: name.trim(), unit: match ? undefined : unit, storeSection: match ? undefined : section };
  return (
    <section>
      <SectionHeader num="03" title="+ Agregar" />
      <Card>
        <datalist id="shopping-ingredients">
          {ingredients.map((i) => (
            <option key={i.id} value={i.name} />
          ))}
        </datalist>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,2fr)_6rem_7rem_8rem_minmax(0,1.5fr)]">
          <div className="col-span-2 md:col-span-1">
            <Label>Ingrediente o cosa</Label>
            <Input list="shopping-ingredients" value={name} onChange={(e) => setName(e.target.value)} placeholder="p.ej. Culantro, bolsas…" />
          </div>
          <div>
            <Label>Cantidad</Label>
            <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div>
            <Label>Unidad</Label>
            {match ? (
              <div className="py-1.5 text-sm">
                {match.unit} <span className="text-ink-soft">(hay {fmtQty(match.stockQty)})</span>
              </div>
            ) : (
              <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
                {UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            )}
          </div>
          <div>
            <Label>Dónde</Label>
            {match ? (
              <div className="py-1.5 text-sm">{match.storeSection}</div>
            ) : (
              <Select value={section} onChange={(e) => setSection(e.target.value)}>
                {STORE_SECTIONS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            )}
          </div>
          <div className="col-span-2 md:col-span-1">
            <Label>Nota</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="opcional" />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={!valid || busy}
            onClick={() => {
              onAdd({ ...base, quantity: q!, note: note.trim() || null });
              reset();
            }}
          >
            Agregar a comprar
          </Button>
          <Button
            disabled={!valid || busy}
            title="Anota cuánto hay en el almacén; la lista descuenta eso"
            onClick={() => {
              onStock({ ...base, qty: q! });
              reset();
            }}
          >
            Lo tenemos en almacén
          </Button>
          {busy && <Spinner />}
          {!match && name.trim() && <span className="self-center text-xs text-ink-soft">Ingrediente nuevo: se guardará en el almacén ({section}).</span>}
        </div>
      </Card>
    </section>
  );
}

function DraftMissingCard({ onDone }: { onDone: () => void }) {
  const [job, setJob] = useState<DraftJob | null>(null);
  const [missing, setMissing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    const r = await api<{ job: DraftJob | null; missing: number }>("/api/recipes/draft-missing");
    setJob(r.job);
    setMissing(r.missing);
  }, []);

  useEffect(() => {
    let alive = true;
    api<{ job: DraftJob | null; missing: number }>("/api/recipes/draft-missing")
      .then((r) => {
        if (!alive) return;
        setJob(r.job);
        setMissing(r.missing);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!job?.running) {
      if (wasRunning.current) {
        wasRunning.current = false;
        onDone();
      }
      return;
    }
    wasRunning.current = true;
    const t = setInterval(() => void load().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [job?.running, load, onDone]);

  const start = async () => {
    setError(null);
    try {
      const r = await api<{ job: DraftJob; missing: number }>("/api/recipes/draft-missing", "POST", {});
      setJob(r.job);
      setMissing(r.missing);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section>
      <SectionHeader num="04" title="Recetas del catálogo" note={missing != null ? `${missing} sin receta` : undefined} />
      <Card className="space-y-2 text-sm">
        <p>
          Las cantidades salen de las recetas (ingredientes por porción). La IA escribe un borrador para cada plato, empezando por los que más salen; la cocina
          corrige y el sistema aprende.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={start} disabled={!!job?.running || missing === 0}>
            Generar recetas faltantes
          </Button>
          {job?.running && <Spinner label={`Generando… ${job.done}/${job.total} platos (unos 30–60 s por cada 6)`} />}
        </div>
        {job && !job.running && job.finishedAt && (
          <p>
            Última vez: {job.drafted} recetas generadas{job.failed.length ? `, ${job.failed.length} fallaron` : ""}.
            {job.message && job.status !== "ok" && <span className="text-red"> {job.message}</span>}
          </p>
        )}
        {job?.failed.length ? <p className="text-xs text-ink-soft">Fallaron: {job.failed.slice(0, 12).map((f) => f.name).join(", ")}</p> : null}
        {error && <Warning>{error}</Warning>}
      </Card>
    </section>
  );
}
