"use client";

import { useMemo, useState } from "react";
import type { IngredientView, ParsedStockItem } from "@/lib/recipes/ingredients";
import { norm } from "@/lib/recipes/text";
import { compareSections, fmtQty, UNASSIGNED_VENDOR } from "@/lib/shopping/units";
import type { VendorsView } from "@/lib/shopping/vendors";
import { UNITS } from "@/lib/types";
import { Badge, Button, Card, Input, Label, PageTitle, SectionHeader, Select, Spinner, Textarea, Warning } from "@/components/ui";
import { VendorSelect } from "@/components/vendor-select";
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

export function AlmacenClient({ initial, initialVendors }: { initial: IngredientView[]; initialVendors: VendorsView }) {
  const [list, setList] = useState(initial);
  const [vendorsView, setVendorsView] = useState(initialVendors);
  const vendors = vendorsView.vendors;
  const [q, setQ] = useState("");
  const [section, setSection] = useState("");
  const [onlyStock, setOnlyStock] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = async () => {
    const [i, v] = await Promise.all([api<{ ingredients: IngredientView[] }>("/api/ingredients"), api<VendorsView>("/api/ingredients/vendors")]);
    setList(i.ingredients);
    setVendorsView(v);
  };

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
      if (body.storeSection !== undefined) setVendorsView(await api<VendorsView>("/api/ingredients/vendors"));
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
      .sort((a, b) => compareSections(vendors)(a.storeSection, b.storeSection) || a.name.localeCompare(b.name, "es"));
  }, [list, q, section, onlyStock, vendors]);
  const sectionsInUse = Object.keys(vendorsView.usage).sort(compareSections(vendors));
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
            <Label>Proveedor</Label>
            <Select value={section} onChange={(e) => setSection(e.target.value)}>
              <option value="">todos</option>
              {[...new Set([...vendors, ...sectionsInUse])].map((s) => (
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
            <span>Proveedor</span>
            <span title="Solo se lista si falta">Revisar</span>
            <span />
          </div>
          {shown.map((i) => (
            <IngredientRow key={i.id} i={i} vendors={vendors} busy={busy === `i-${i.id}`} onPatch={(b) => patch(i.id, b)} onDelete={() => remove(i)} />
          ))}
          {!shown.length && <p className="p-3 text-sm text-ink-soft">No hay ingredientes con ese filtro.</p>}
        </Card>
      </section>

      <AddIngredient
        vendors={vendors}
        busy={busy === "add"}
        onAdd={(body) =>
          run("add", async () => {
            await api("/api/ingredients", "POST", body);
            await reload();
            setNotice(`Agregado: ${body.name}`);
          })
        }
      />

      <VendorsEditor
        view={vendorsView}
        busy={busy === "vendors"}
        onSave={(vendors, moves, msg) =>
          run("vendors", async () => {
            await api<VendorsView>("/api/ingredients/vendors", "PUT", { vendors, moves });
            await reload();
            setNotice(msg);
          })
        }
      />
    </div>
  );
}

type VendorRow = { key: string; orig: string | null; name: string };
let vendorSeq = 0;

/** Edit the vendor list: rename (moves its ingredients), add, remove (ingredients go to "sin proveedor"), reorder. Old sections still in use can be moved to a vendor. */
function VendorsEditor({ view, busy, onSave }: { view: VendorsView; busy: boolean; onSave: (vendors: string[], moves: { from: string; to: string }[], msg: string) => void }) {
  const toRows = (v: string[]): VendorRow[] => v.map((name) => ({ key: `v${++vendorSeq}`, orig: name, name }));
  const [rows, setRows] = useState(() => toRows(view.vendors));
  const [synced, setSynced] = useState(view.vendors.join("\n"));
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});
  if (synced !== view.vendors.join("\n")) {
    // the saved list changed: start over from it
    setSynced(view.vendors.join("\n"));
    setRows(toRows(view.vendors));
  }

  const count = (name: string | null) => (name ? (view.usage[name] ?? 0) : 0);
  const dirty = rows.length !== view.vendors.length || rows.some((r, i) => r.name.trim() !== view.vendors[i]);
  const legacy = Object.keys(view.usage)
    .filter((s) => s !== UNASSIGNED_VENDOR && !view.vendors.includes(s))
    .sort((a, b) => a.localeCompare(b, "es"));
  const set = (key: string, patch: Partial<VendorRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (idx: number, d: -1 | 1) =>
    setRows((rs) => {
      const j = idx + d;
      if (j < 0 || j >= rs.length) return rs;
      const n = [...rs];
      [n[idx], n[j]] = [n[j], n[idx]];
      return n;
    });

  const save = () => {
    const kept = rows.filter((r) => r.name.trim());
    const moves = [
      ...kept.filter((r) => r.orig && r.orig !== r.name.trim()).map((r) => ({ from: r.orig!, to: r.name.trim() })),
      ...view.vendors.filter((v) => !kept.some((r) => r.orig === v)).map((v) => ({ from: v, to: UNASSIGNED_VENDOR })),
    ];
    const removedWithItems = moves.filter((m) => m.to === UNASSIGNED_VENDOR && count(m.from) > 0);
    if (removedWithItems.length && !window.confirm(`${removedWithItems.map((m) => `${m.from} (${count(m.from)})`).join(", ")}: sus ingredientes quedarán "${UNASSIGNED_VENDOR}". ¿Seguir?`))
      return;
    onSave(
      kept.map((r) => r.name.trim()),
      moves,
      "Proveedores guardados.",
    );
  };

  return (
    <section>
      <SectionHeader num="04" title="Proveedores" note="a quién se le compra cada cosa" />
      <Card className="space-y-3">
        <p className="text-sm text-ink-soft">La lista de compras se agrupa por proveedor, en este orden. Si cambias un nombre, sus ingredientes lo siguen.</p>
        <div className="divide-y divide-line border-y border-line">
          {rows.map((r, idx) => (
            <div key={r.key} className="flex items-center gap-2 py-1.5">
              <Input className="min-w-0 flex-1" value={r.name} placeholder="Nombre" onChange={(e) => set(r.key, { name: e.target.value })} aria-label="Proveedor" />
              <span className="w-24 text-xs text-ink-soft">{r.orig ? `${count(r.orig)} ingred.` : "nuevo"}</span>
              <Button variant="ghost" className="!px-1.5" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label={`Subir ${r.name}`}>
                ↑
              </Button>
              <Button variant="ghost" className="!px-1.5" onClick={() => move(idx, 1)} disabled={idx === rows.length - 1} aria-label={`Bajar ${r.name}`}>
                ↓
              </Button>
              <Button variant="ghost" className="!px-1.5" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Quitar ${r.name}`}>
                ✕
              </Button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setRows((rs) => [...rs, { key: `v${++vendorSeq}`, orig: null, name: "" }])} disabled={busy}>
            + Proveedor
          </Button>
          <Button variant="primary" onClick={save} disabled={!dirty || busy}>
            {busy ? "Guardando…" : "Guardar proveedores"}
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setRows(toRows(view.vendors))} disabled={busy}>
              Deshacer
            </Button>
          )}
          {count(UNASSIGNED_VENDOR) > 0 && <span className="text-xs text-ink-soft">{count(UNASSIGNED_VENDOR)} ingredientes sin proveedor: asígnalos en la tabla de arriba.</span>}
        </div>

        {legacy.length > 0 && (
          <div className="space-y-2 bg-yellow/30 p-3">
            <Label>Secciones antiguas en uso</Label>
            <p className="text-xs text-ink-soft">Pasa todos sus ingredientes a un proveedor de una vez (o cámbialos uno por uno en la tabla).</p>
            {legacy.map((s) => (
              <div key={s} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-32 font-semibold">{s}</span>
                <span className="w-24 text-xs text-ink-soft">{count(s)} ingred.</span>
                <span className="text-xs">pasar a</span>
                <VendorSelect className="!w-40" value={moveTo[s] ?? view.vendors[0] ?? UNASSIGNED_VENDOR} vendors={view.vendors} onChange={(e) => setMoveTo((m) => ({ ...m, [s]: e.target.value }))} aria-label={`Pasar ${s} a`} />
                <Button
                  disabled={busy || dirty}
                  title={dirty ? "Guarda primero los cambios de la lista" : undefined}
                  onClick={() => {
                    const to = moveTo[s] ?? view.vendors[0] ?? UNASSIGNED_VENDOR;
                    onSave(view.vendors, [{ from: s, to }], `${count(s)} ingredientes de "${s}" pasados a ${to}.`);
                  }}
                >
                  Pasar
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}

function IngredientRow({
  i,
  vendors,
  busy,
  onPatch,
  onDelete,
}: {
  i: IngredientView;
  vendors: string[];
  busy: boolean;
  onPatch: (b: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
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
        <span className="md:hidden">Proveedor</span>
        <VendorSelect value={i.storeSection} vendors={vendors} onChange={(e) => onPatch({ storeSection: e.target.value })} />
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

function AddIngredient({
  vendors,
  busy,
  onAdd,
}: {
  vendors: string[];
  busy: boolean;
  onAdd: (b: { name: string; unit: string; storeSection: string; stockQty: number; pricePerUnit: number | null }) => void;
}) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("kg");
  const [section, setSection] = useState(UNASSIGNED_VENDOR);
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
            <Label>Proveedor</Label>
            <VendorSelect value={section} vendors={vendors} onChange={(e) => setSection(e.target.value)} />
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
