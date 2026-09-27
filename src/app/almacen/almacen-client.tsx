"use client";

import { useMemo, useState } from "react";
import type { IngredientView, ParsedStockItem } from "@/lib/recipes/ingredients";
import { norm } from "@/lib/recipes/text";
import { fmtQty, sectionOrder, STORE_SECTIONS } from "@/lib/shopping/units";
import { UNITS } from "@/lib/types";
import { Badge, Button, Card, Input, Label, PageTitle, SectionHeader, Select, Spinner, Textarea, Warning } from "@/components/ui";
import { api, NumberField, Notice, parseNum } from "../compras/_ui";

function ago(iso: string | null): string {
  if (!iso) return "nunca";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return `hoy ${d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}`;
  if (days === 1) return "ayer";
  return `hace ${days} días`;
}

type PreviewRow = ParsedStockItem & { include: boolean; qtyText: string };

export function AlmacenClient({ initial }: { initial: IngredientView[] }) {
  const [list, setList] = useState(initial);
  const [q, setQ] = useState("");
  const [section, setSection] = useState("");
  const [onlyStock, setOnlyStock] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = async () => setList((await api<{ ingredients: IngredientView[] }>("/api/ingredients")).ingredients);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const patch = (id: number, body: Record<string, unknown>) =>
    run(`i-${id}`, async () => {
      const r = await api<{ ingredient: IngredientView }>(`/api/ingredients/${id}`, "PATCH", body);
      setList((l) => l.map((x) => (x.id === id ? { ...x, ...r.ingredient } : x)));
    });

  const remove = (i: IngredientView) => {
    const msg = i.recipes ? `"${i.name}" se usa en ${i.recipes} receta(s). ¿Borrarlo y quitarlo de esas recetas?` : `¿Borrar "${i.name}"?`;
    if (!window.confirm(msg)) return;
    void run(`i-${i.id}`, async () => {
      await api(`/api/ingredients/${i.id}${i.recipes ? "?force=1" : ""}`, "DELETE");
      setList((l) => l.filter((x) => x.id !== i.id));
    });
  };

  const resetAll = () => {
    if (!window.confirm("¿Poner TODO el almacén en 0? Úsalo cuando vas a anotar el inventario desde cero.")) return;
    void run("reset", async () => {
      const r = await api<{ reset: number }>("/api/ingredients/stock", "POST", { resetAll: true, items: [] });
      await reload();
      setNotice(`${r.reset} ingredientes puestos en 0.`);
    });
  };

  const shown = useMemo(() => {
    const nq = norm(q);
    return list
      .filter((i) => (!nq || norm(i.name).includes(nq)) && (!section || i.storeSection === section) && (!onlyStock || i.stockQty > 0))
      .sort((a, b) => sectionOrder(a.storeSection) - sectionOrder(b.storeSection) || a.name.localeCompare(b.name, "es"));
  }, [list, q, section, onlyStock]);
  const withStock = list.filter((i) => i.stockQty > 0).length;

  return (
    <div className="space-y-6">
      <PageTitle
        sub={`${list.length} ingredientes · ${withStock} con stock`}
        actions={
          <Button variant="danger" onClick={resetAll} disabled={!!busy}>
            Poner todo en 0
          </Button>
        }
      >
        Almacén
      </PageTitle>
      {error && <Warning>{error}</Warning>}
      {notice && <Notice tone="ok">{notice}</Notice>}

      <PasteStock
        busy={busy}
        setBusy={setBusy}
        onApplied={async (msg) => {
          await reload();
          setNotice(msg);
        }}
        onError={setError}
      />

      <section>
        <SectionHeader num="02" title="Lo que hay" note="se descuenta de las compras" />
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <Label>Buscar</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="cebolla, arroz…" />
          </div>
          <div>
            <Label>Sección</Label>
            <Select value={section} onChange={(e) => setSection(e.target.value)}>
              <option value="">todas</option>
              {STORE_SECTIONS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" className="accent-[var(--red)]" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} />
            solo con stock
          </label>
        </div>
        <Card className="!p-0">
          <div className="hidden grid-cols-[minmax(0,2fr)_6rem_6rem_7rem_8rem_5.5rem_2rem] gap-2 border-b border-line px-3 py-2 font-heading text-[11px] font-semibold uppercase tracking-wider text-ink-soft md:grid">
            <span>Ingrediente</span>
            <span>Hay</span>
            <span>Unidad</span>
            <span>Precio S/ x unidad</span>
            <span>Sección</span>
            <span title="Solo se lista si falta">Revisar</span>
            <span />
          </div>
          {shown.map((i) => (
            <IngredientRow key={i.id} i={i} busy={busy === `i-${i.id}`} onPatch={(b) => patch(i.id, b)} onDelete={() => remove(i)} />
          ))}
          {!shown.length && <p className="p-3 text-sm text-ink-soft">No hay ingredientes con ese filtro.</p>}
        </Card>
      </section>

      <AddIngredient
        busy={busy === "add"}
        onAdd={(body) =>
          run("add", async () => {
            await api("/api/ingredients", "POST", body);
            await reload();
            setNotice(`Agregado: ${body.name}`);
          })
        }
      />
    </div>
  );
}

function IngredientRow({ i, busy, onPatch, onDelete }: { i: IngredientView; busy: boolean; onPatch: (b: Record<string, unknown>) => void; onDelete: () => void }) {
  const [name, setName] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-2 items-center gap-2 border-b border-line px-3 py-2 md:grid-cols-[minmax(0,2fr)_6rem_6rem_7rem_8rem_5.5rem_2rem]">
      <div className="col-span-2 min-w-0 md:col-span-1">
        <Input
          aria-label="Nombre"
          className="!border-transparent !bg-transparent font-semibold hover:!border-line focus:!border-orange"
          value={name ?? i.name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name != null && name.trim() && name.trim() !== i.name) onPatch({ name: name.trim() });
            setName(null);
          }}
        />
        <div className="px-2 text-xs text-ink-soft">
          {i.recipes ? `${i.recipes} receta(s)` : "sin recetas"} · stock {ago(i.stockUpdatedAt)}
          {busy && <Spinner />}
        </div>
      </div>
      <label className="text-xs text-ink-soft md:text-base">
        <span className="md:hidden">Hay</span>
        <NumberField label={`Hay de ${i.name}`} className={`text-right ${i.stockQty > 0 ? "font-semibold" : ""}`} value={i.stockQty} onCommit={(v) => onPatch({ stockQty: v ?? 0 })} />
      </label>
      <label className="text-xs text-ink-soft md:text-base">
        <span className="md:hidden">Unidad</span>
        <Select value={i.unit} onChange={(e) => onPatch({ unit: e.target.value })}>
          {(UNITS as readonly string[]).includes(i.unit) ? null : <option>{i.unit}</option>}
          {UNITS.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </Select>
      </label>
      <label className="text-xs text-ink-soft md:text-base">
        <span className="md:hidden">Precio S/</span>
        <NumberField label={`Precio de ${i.name}`} className="text-right" value={i.pricePerUnit} allowEmpty onCommit={(v) => onPatch({ pricePerUnit: v })} />
      </label>
      <label className="text-xs text-ink-soft md:text-base">
        <span className="md:hidden">Sección</span>
        <Select value={i.storeSection} onChange={(e) => onPatch({ storeSection: e.target.value })}>
          {(STORE_SECTIONS as readonly string[]).includes(i.storeSection) ? null : <option>{i.storeSection}</option>}
          {STORE_SECTIONS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
      </label>
      <label className="flex items-center gap-1 text-xs" title="Suele sobrar: solo aparece en la lista si falta">
        <input type="checkbox" className="accent-[var(--red)]" checked={i.alwaysCheckStock} onChange={(e) => onPatch({ alwaysCheckStock: e.target.checked })} />
        solo si falta
      </label>
      <Button variant="ghost" className="!px-1.5 justify-self-end" onClick={onDelete} aria-label={`Borrar ${i.name}`}>
        ✕
      </Button>
    </div>
  );
}

function PasteStock({
  busy,
  setBusy,
  onApplied,
  onError,
}: {
  busy: string | null;
  setBusy: (b: string | null) => void;
  onApplied: (msg: string) => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [resetFirst, setResetFirst] = useState(false);

  const parse = async () => {
    setBusy("parse");
    onError(null);
    try {
      const r = await api<{ ok: true; items: ParsedStockItem[] }>("/api/ingredients/parse", "POST", { text });
      setRows(r.items.map((i) => ({ ...i, include: i.qty != null, qtyText: i.qty == null ? "" : fmtQty(i.qty) })));
    } catch (e) {
      onError(`${(e as Error).message}. Puedes anotar las cantidades a mano en la tabla de abajo.`);
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!rows) return;
    const items = rows
      .filter((r) => r.include && parseNum(r.qtyText) != null)
      .map((r) => ({ ingredientId: r.ingredientId, name: r.name, unit: r.unit, storeSection: r.storeSection, qty: parseNum(r.qtyText)! }));
    if (!items.length) return;
    if (resetFirst && !window.confirm("Se pondrá todo el almacén en 0 antes de anotar esto. ¿Seguir?")) return;
    setBusy("apply");
    onError(null);
    try {
      const r = await api<{ updated: number; created: string[]; reset: number }>("/api/ingredients/stock", "POST", { items, resetAll: resetFirst });
      setRows(null);
      setText("");
      await onApplied(`Almacén actualizado: ${r.updated} ingredientes${r.created.length ? ` (nuevos: ${r.created.join(", ")})` : ""}.`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const set = (idx: number, patch: Partial<PreviewRow>) => setRows((rs) => rs && rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  return (
    <section>
      <SectionHeader num="01" title="Pegar lo que hay" note="del WhatsApp" />
      <Card className="space-y-3">
        <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Hay 7 kilos de arroz, 3 aceites, cebolla bastante, 2 bolsas de azúcar…" />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={parse} disabled={!text.trim() || !!busy}>
            {busy === "parse" ? "Leyendo…" : "Leer mensaje"}
          </Button>
          {busy === "parse" && <Spinner label="La IA está leyendo el mensaje…" />}
        </div>
        {rows && (
          <div className="space-y-2">
            {rows.length === 0 && <p className="text-sm text-ink-soft">No se encontraron ingredientes en el mensaje.</p>}
            {rows.map((r, idx) => (
              <div key={idx} className="flex flex-wrap items-center gap-2 border-b border-line py-1.5">
                <input type="checkbox" className="accent-[var(--red)]" checked={r.include} onChange={(e) => set(idx, { include: e.target.checked })} aria-label="Incluir" />
                <Input className="!w-44" value={r.name} onChange={(e) => set(idx, { name: e.target.value, ingredientId: null })} aria-label="Ingrediente" />
                <Input
                  className="!w-20 text-right"
                  inputMode="decimal"
                  value={r.qtyText}
                  placeholder="¿cuánto?"
                  onChange={(e) => set(idx, { qtyText: e.target.value, include: e.target.value.trim() !== "" || r.include })}
                  aria-label="Cantidad"
                />
                {r.ingredientId ? (
                  <span className="text-sm">{r.unit}</span>
                ) : (
                  <Select className="!w-28" value={r.unit} onChange={(e) => set(idx, { unit: e.target.value })} aria-label="Unidad">
                    {UNITS.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </Select>
                )}
                {r.ingredientId ? (
                  <span className="text-xs text-ink-soft">antes: {fmtQty(r.currentStock ?? 0)}</span>
                ) : (
                  <Badge tone="orange">nuevo</Badge>
                )}
                {r.note && <span className="text-xs text-ink-soft">“{r.note}”</span>}
              </div>
            ))}
            {rows.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" onClick={apply} disabled={!!busy || !rows.some((r) => r.include && parseNum(r.qtyText) != null)}>
                  {busy === "apply" ? "Guardando…" : "Anotar en almacén"}
                </Button>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="accent-[var(--red)]" checked={resetFirst} onChange={(e) => setResetFirst(e.target.checked)} />
                  es el inventario completo (poner lo demás en 0)
                </label>
                <Button variant="ghost" onClick={() => setRows(null)}>
                  Cancelar
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}

function AddIngredient({ busy, onAdd }: { busy: boolean; onAdd: (b: { name: string; unit: string; storeSection: string; stockQty: number; pricePerUnit: number | null }) => void }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("kg");
  const [section, setSection] = useState("mercado");
  const [stock, setStock] = useState("");
  const [price, setPrice] = useState("");
  return (
    <section>
      <SectionHeader num="03" title="Nuevo ingrediente" />
      <Card>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,2fr)_7rem_8rem_6rem_6rem_auto] md:items-end">
          <div className="col-span-2 md:col-span-1">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Unidad</Label>
            <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Sección</Label>
            <Select value={section} onChange={(e) => setSection(e.target.value)}>
              {STORE_SECTIONS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Hay</Label>
            <Input inputMode="decimal" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="0" />
          </div>
          <div>
            <Label>Precio S/</Label>
            <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <Button
            variant="primary"
            disabled={!name.trim() || busy}
            onClick={() => {
              onAdd({ name: name.trim(), unit, storeSection: section, stockQty: parseNum(stock) ?? 0, pricePerUnit: parseNum(price) });
              setName("");
              setStock("");
              setPrice("");
            }}
          >
            Agregar
          </Button>
        </div>
      </Card>
    </section>
  );
}
