"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DraftOutcome, RecipeItemView, RecipeView } from "@/lib/recipes";
import { sourceLabel } from "@/lib/recipes/learn";
import { STORE_SECTIONS, fmtQty } from "@/lib/shopping/units";
import { UNITS } from "@/lib/types";
import { Badge, Button, Input, Select, Spinner, Warning } from "./ui";

interface IngredientOption {
  id: number;
  name: string;
  unit: string;
  storeSection: string;
  pricePerUnit: number | null;
}

interface Row {
  key: string;
  ingredientId: number | null;
  name: string;
  unit: string;
  storeSection: string;
  /** Source of truth: quantity per portion (what's saved). */
  perPortion: number;
  /** What the person types: `amount` for `basis` portions (e.g. 2 kg para 40). */
  amount: string;
  basis: string;
  fixedQty: string;
  source: RecipeItemView["source"] | "nuevo";
  corrections: number;
}

const num = (s: string) => {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const money = (n: number) => `S/ ${n.toFixed(2)}`;
let seq = 0;

const amountFor = (perPortion: number, basis: number) => fmtQty(Math.round(perPortion * basis * 1000) / 1000);

function toRows(items: RecipeItemView[], basis: number): Row[] {
  return items.map((i) => ({
    key: `r${i.id}`,
    ingredientId: i.ingredientId,
    name: i.name,
    unit: i.unit,
    storeSection: i.storeSection,
    perPortion: i.qtyPerPortion,
    amount: amountFor(i.qtyPerPortion, basis),
    basis: String(basis),
    fixedQty: fmtQty(i.fixedQty),
    source: i.source,
    corrections: i.corrections,
  }));
}

/**
 * Editable recipe for one dish: ingredients with quantity per portion and fixed batch quantity,
 * add/remove/edit, "Generar con IA", cost per portion and for N portions. Saving marks changed items `manual`.
 */
export function RecipeEditor({ dishId }: { dishId: number }) {
  const [recipe, setRecipe] = useState<RecipeView | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [options, setOptions] = useState<IngredientOption[]>([]);
  const [portions, setPortions] = useState(20);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"" | "load" | "save" | "draft">("load");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  /** `basis` = how many portions the amounts are shown for (keeps the person's choice after saving). */
  const applyRecipe = useCallback((r: RecipeView, basis?: number) => {
    const b = basis ?? r.portions;
    setRecipe(r);
    setRows(toRows(r.items, b));
    setPortions(b);
    setDirty(false);
  }, []);

  /** Changing "Cantidades para N porciones" re-expresses every row for N portions (per-portion values don't change). */
  const changeBasis = (n: number) => {
    setPortions(n);
    setRows((rs) => rs.map((r) => ({ ...r, basis: String(n), amount: amountFor(r.perPortion, n) })));
  };

  const setAmount = (key: string, amount: string, basis?: string) => {
    setDirty(true);
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        const b = basis ?? r.basis;
        const n = num(b);
        return { ...r, amount, basis: b, perPortion: n > 0 ? num(amount) / n : r.perPortion };
      }),
    );
  };

  const loadOptions = useCallback(async () => {
    const res = await fetch("/api/ingredients");
    if (res.ok) setOptions(((await res.json()) as { ingredients: IngredientOption[] }).ingredients);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [r] = await Promise.all([fetch(`/api/recipes/${dishId}`), loadOptions()]);
        const data = await r.json();
        if (!alive) return;
        if (!r.ok) setError(data.error ?? "No se pudo cargar la receta");
        else applyRecipe(data as RecipeView);
      } catch {
        if (alive) setError("No se pudo cargar la receta");
      } finally {
        if (alive) setBusy("");
      }
    })();
    return () => {
      alive = false;
    };
  }, [dishId, applyRecipe, loadOptions]);

  const byName = useMemo(() => new Map(options.map((o) => [o.name.toLocaleLowerCase("es"), o])), [options]);
  const priceOf = (row: Row) => (row.ingredientId != null ? options.find((o) => o.id === row.ingredientId)?.pricePerUnit : byName.get(row.name.toLocaleLowerCase("es"))?.pricePerUnit) ?? null;

  const update = (key: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const setName = (key: string, name: string) => {
    const hit = byName.get(name.trim().toLocaleLowerCase("es"));
    update(key, hit ? { name: hit.name, ingredientId: hit.id, unit: hit.unit, storeSection: hit.storeSection } : { name, ingredientId: null });
  };

  const addRow = () => {
    setRows((rs) => [
      ...rs,
      { key: `n${++seq}`, ingredientId: null, name: "", unit: "kg", storeSection: "mercado", perPortion: 0, amount: "", basis: String(portions), fixedQty: "0", source: "nuevo", corrections: 0 },
    ]);
    setDirty(true);
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    setInfo(null);
    try {
      const items = rows
        .filter((r) => r.name.trim())
        .map((r) => ({
          ingredientId: r.ingredientId,
          name: r.name.trim(),
          unit: r.ingredientId == null ? (r.unit as (typeof UNITS)[number]) : undefined,
          storeSection: r.ingredientId == null ? r.storeSection : undefined,
          qtyPerPortion: Math.round(r.perPortion * 1e6) / 1e6,
          fixedQty: num(r.fixedQty),
        }));
      const res = await fetch(`/api/recipes/${dishId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar");
      applyRecipe(data as RecipeView, portions);
      setInfo("Receta guardada. Las próximas listas de compras usan estas cantidades.");
      void loadOptions();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const draft = async () => {
    const corrected = rows.filter((r) => r.source === "manual" || r.source === "learned").length;
    let overwrite = false;
    if (dirty && !window.confirm("Hay cambios sin guardar que se perderán. ¿Generar con IA igual?")) return;
    if (corrected)
      overwrite = window.confirm(
        `Hay ${corrected} ingrediente(s) corregidos a mano o aprendidos.\n\nAceptar = reemplazar TODA la receta con la IA.\nCancelar = mantener esos y regenerar solo el resto.`,
      );
    setBusy("draft");
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/recipes/${dishId}/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ overwrite }) });
      const data = (await res.json()) as { outcome?: DraftOutcome; recipe?: RecipeView; error?: string };
      if (!res.ok) throw new Error(data.error ?? "No se pudo generar");
      if (data.recipe) applyRecipe(data.recipe, portions);
      if (data.outcome?.status === "ok") setInfo("Receta generada con IA. Revisa las cantidades y corrige lo que haga falta.");
      else setError(`La IA no pudo generar la receta${data.outcome?.message ? `: ${data.outcome.message}` : ""}. Puedes escribirla a mano.`);
      void loadOptions();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const costs = rows.map((r) => {
    const p = priceOf(r);
    if (p == null) return null;
    return p * (r.perPortion + (portions > 0 ? num(r.fixedQty) / portions : 0));
  });
  const perPortion = costs.reduce<number>((s, c) => s + (c ?? 0), 0);
  const missingPrices = costs.filter((c) => c == null).length;

  if (busy === "load") return <Spinner label="Cargando receta…" />;
  if (!recipe) return <Warning>{error ?? "Receta no disponible"}</Warning>;

  return (
    <div className="space-y-3">
      <datalist id={`ingredients-${dishId}`}>
        {options.map((o) => (
          <option key={o.id} value={o.name} />
        ))}
      </datalist>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={save} disabled={!dirty || !!busy}>
          {busy === "save" ? "Guardando…" : "Guardar receta"}
        </Button>
        <Button onClick={addRow} disabled={!!busy}>
          + Ingrediente
        </Button>
        <Button variant="ghost" onClick={draft} disabled={!!busy}>
          {busy === "draft" ? "Generando…" : "Generar con IA"}
        </Button>
        {busy === "draft" && <Spinner label="La IA está escribiendo la receta (10–60 s)…" />}
        {recipe.drafting && busy !== "draft" && <Spinner label="Generando en segundo plano…" />}
      </div>

      {error && <Warning>{error}</Warning>}
      {info && <div className="border-l-4 border-orange bg-yellow/30 px-3 py-2 text-sm">{info}</div>}

      <label className="flex flex-wrap items-center gap-2 bg-yellow/30 px-3 py-2 text-sm">
        <span className="font-heading text-xs font-semibold uppercase tracking-wider">Cantidades para</span>
        <Input
          className="py-1"
          style={{ width: "5rem" }}
          inputMode="numeric"
          value={String(portions)}
          onChange={(e) => changeBasis(Math.max(1, Math.round(num(e.target.value)) || 1))}
          aria-label="Porciones de referencia"
        />
        <span className="font-heading text-xs font-semibold uppercase tracking-wider">porciones</span>
        <span className="text-xs text-ink-soft">Escribe cuánto usas para esa cantidad de porciones (ej. 2 kg de fideo para 40). También puedes cambiar las porciones en una fila.</span>
      </label>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-soft">
          Este plato aún no tiene receta. Usa <b>Generar con IA</b> o agrega los ingredientes a mano.
        </p>
      ) : (
        <div className="divide-y divide-line border-y border-line">
          <div className="hidden grid-cols-[minmax(0,2.2fr)_1.6fr_1fr_0.8fr_1fr_1fr_auto] gap-2 py-1.5 font-heading text-xs font-semibold uppercase tracking-wider text-ink-soft md:grid">
            <span>Ingrediente</span>
            <span>Cantidad · para porciones</span>
            <span>Fijo por olla</span>
            <span>Unidad</span>
            <span>Para {portions}</span>
            <span>Costo/porción</span>
            <span />
          </div>
          {rows.map((r, idx) => {
            const total = r.perPortion * portions + num(r.fixedQty);
            const cost = costs[idx];
            return (
              <div key={r.key} className="grid grid-cols-2 items-center gap-2 py-2 md:grid-cols-[minmax(0,2.2fr)_1.6fr_1fr_0.8fr_1fr_1fr_auto]">
                <div className="col-span-2 md:col-span-1">
                  <Input list={`ingredients-${dishId}`} value={r.name} placeholder="Ingrediente" onChange={(e) => setName(r.key, e.target.value)} aria-label="Ingrediente" />
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <Badge tone={r.source === "learned" ? "green" : r.source === "manual" ? "orange" : "neutral"}>
                      {r.source === "nuevo" ? "nuevo" : sourceLabel(r.source, r.corrections)}
                    </Badge>
                    {r.ingredientId == null && r.name.trim() && <span className="text-xs text-ink-soft">se creará como ingrediente</span>}
                  </div>
                </div>
                <div className="col-span-2 text-xs text-ink-soft md:col-span-1">
                  <span className="md:hidden">Cantidad</span>
                  <div className="flex items-center gap-1">
                    <Input className="min-w-0" inputMode="decimal" value={r.amount} placeholder="0" onChange={(e) => setAmount(r.key, e.target.value)} aria-label={`Cantidad de ${r.name}`} />
                    <span className="whitespace-nowrap">{r.unit} para</span>
                    <Input className="min-w-0" style={{ width: "4rem" }} inputMode="numeric" value={r.basis} onChange={(e) => setAmount(r.key, r.amount, e.target.value)} aria-label={`Porciones para ${r.name}`} />
                  </div>
                  <div className="mt-0.5">= {fmtQty(Math.round(r.perPortion * 10000) / 10000)} {r.unit} por porción</div>
                </div>
                <label className="text-xs text-ink-soft md:text-base md:text-ink">
                  <span className="md:hidden">Fijo por olla</span>
                  <Input inputMode="decimal" value={r.fixedQty} onChange={(e) => update(r.key, { fixedQty: e.target.value })} />
                </label>
                <div>
                  {r.ingredientId == null ? (
                    <div className="flex gap-1">
                      <Select value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} aria-label="Unidad">
                        {UNITS.map((u) => (
                          <option key={u}>{u}</option>
                        ))}
                      </Select>
                      <Select value={r.storeSection} onChange={(e) => update(r.key, { storeSection: e.target.value })} aria-label="Dónde se compra">
                        {STORE_SECTIONS.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </Select>
                    </div>
                  ) : (
                    <span className="text-sm">{r.unit}</span>
                  )}
                </div>
                <div className="text-sm">
                  <span className="md:hidden text-ink-soft">Para {portions}: </span>
                  {fmtQty(total)} {r.unit}
                </div>
                <div className="text-sm">
                  <span className="md:hidden text-ink-soft">Costo: </span>
                  {cost == null ? <span className="text-ink-soft">sin precio</span> : money(cost)}
                </div>
                <Button
                  variant="ghost"
                  aria-label={`Quitar ${r.name}`}
                  onClick={() => {
                    setRows((rs) => rs.filter((x) => x.key !== r.key));
                    setDirty(true);
                  }}
                >
                  ✕
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span>
          Costo por porción: <b className="text-red">{money(perPortion)}</b>
        </span>
        <span>
          Para {portions}: <b className="text-red">{money(perPortion * portions)}</b>
        </span>
        {missingPrices > 0 && (
          <span className="text-ink-soft">
            {missingPrices} ingrediente(s) sin precio — ponlo en <a href="/almacen">Almacén</a>
          </span>
        )}
        {recipe.dish.costPerPortion != null && <span className="text-ink-soft">(costo fijado a mano en el plato: {money(recipe.dish.costPerPortion)})</span>}
      </div>
      <p className="text-xs text-ink-soft">
        Cantidades en peso de compra, en la unidad del ingrediente. &quot;Fijo por olla&quot; no depende de las porciones (condimentos, aceite para freír).
        Lo que corrijas queda como <b>manual</b>; lo que aprende de la lista de compras queda como <b>aprendido</b>.
      </p>
    </div>
  );
}
