"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, errorText } from "@/components/menu-editor";
import { Button, Card, Input, Label, SectionHeader, Select, Spinner, Textarea } from "@/components/ui";
import { TAGS, type Course } from "@/lib/types";
import type { Dish } from "../_lib/dishes";
import { COURSE_LABELS, STATUS_LABELS } from "../format";

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

export function DishForm({
  dish,
  categories,
  computedCost,
  costNote,
  portionsFallback,
}: {
  dish: Dish;
  categories: string[];
  computedCost: number | null;
  costNote: string;
  portionsFallback: number;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    name: dish.name,
    course: dish.course,
    category: dish.category,
    base: dish.base ?? "",
    protein: dish.protein ?? "",
    status: dish.status,
    price: dish.price?.toString() ?? "",
    costPerPortion: dish.costPerPortion?.toString() ?? "",
    defaultPortions: dish.defaultPortions?.toString() ?? "",
    notes: dish.notes ?? "",
  });
  const [tags, setTags] = useState<string[]>(dish.tags);
  const [extraTag, setExtraTag] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const toggleTag = (t: string) => setTags((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));
  const customTags = tags.filter((t) => !(TAGS as readonly string[]).includes(t));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy("Guardando…");
    setMsg(null);
    try {
      const body = {
        name: f.name,
        course: f.course,
        category: f.category,
        base: f.base,
        protein: f.protein,
        status: f.status,
        tags,
        price: numOrNull(f.price),
        costPerPortion: numOrNull(f.costPerPortion),
        defaultPortions: f.defaultPortions.trim() ? Math.round(Number(f.defaultPortions)) : null,
        notes: f.notes,
      };
      await api(`/api/dishes/${dish.id}`, { method: "PATCH", body });
      setMsg({ ok: true, text: "Guardado." });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm(`¿Eliminar "${dish.name}"? Si ya salió en algún menú, solo se archiva.`)) return;
    setBusy("Eliminando…");
    setMsg(null);
    try {
      const { result } = await api<{ result: "eliminado" | "archivado" }>(`/api/dishes/${dish.id}`, { method: "DELETE" });
      if (result === "eliminado") return router.push("/platos");
      setF((p) => ({ ...p, status: "archivado" }));
      setMsg({ ok: true, text: "Se archivó (ya salió en menús; el historial se conserva)." });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  const override = numOrNull(f.costPerPortion);
  return (
    <form onSubmit={save}>
      <Card>
        <SectionHeader num="01" title="Datos del plato" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Nombre</Label>
            <Input required value={f.name} onChange={set("name")} aria-label="Nombre" />
          </div>
          <div>
            <Label>Tiempo</Label>
            <Select value={f.course} onChange={(e) => setF((p) => ({ ...p, course: e.target.value as Course }))} aria-label="Tiempo">
              {Object.entries(COURSE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Categoría</Label>
            <Input required list="dish-categories" value={f.category} onChange={set("category")} aria-label="Categoría" />
            <datalist id="dish-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <Label>Base</Label>
            <Input value={f.base} onChange={set("base")} placeholder="p. ej. Guiso de quinua" aria-label="Base" />
          </div>
          <div>
            <Label>Proteína</Label>
            <Input value={f.protein} onChange={set("protein")} placeholder="p. ej. Pollo" aria-label="Proteína" />
          </div>
          <div className="sm:col-span-2">
            <Label>Etiquetas</Label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Etiquetas">
              {[...TAGS, ...customTags].map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tags.includes(t)}
                  onClick={() => toggleTag(t)}
                  className={`px-2 py-1 font-heading text-xs uppercase tracking-wider ${tags.includes(t) ? "bg-orange text-paper" : "bg-page text-ink"}`}
                >
                  {t}
                </button>
              ))}
              <Input
                value={extraTag}
                onChange={(e) => setExtraTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && extraTag.trim()) {
                    e.preventDefault();
                    const t = extraTag.trim().toLowerCase();
                    if (!tags.includes(t)) setTags([...tags, t]);
                    setExtraTag("");
                  }
                }}
                placeholder="otra + Enter"
                aria-label="Agregar etiqueta"
                className="w-32 py-1 text-sm"
              />
            </div>
          </div>
          <div>
            <Label>Estado</Label>
            <Select value={f.status} onChange={(e) => setF((p) => ({ ...p, status: e.target.value as Dish["status"] }))} aria-label="Estado">
              {Object.entries(STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Precio como extra (S/)</Label>
            <Input type="number" inputMode="decimal" step="0.5" min={0} value={f.price} onChange={set("price")} placeholder="—" aria-label="Precio como extra" />
          </div>
          <div>
            <Label>Porciones por defecto</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={f.defaultPortions}
              onChange={set("defaultPortions")}
              placeholder={String(portionsFallback)}
              aria-label="Porciones por defecto"
            />
          </div>
          <div>
            <Label>Costo por porción (S/)</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              value={f.costPerPortion}
              onChange={set("costPerPortion")}
              placeholder={computedCost != null ? computedCost.toFixed(2) : "—"}
              aria-label="Costo por porción (manual)"
            />
            <p className="mt-1 text-xs text-ink-soft">
              Según receta: {computedCost != null ? <strong>S/ {computedCost.toFixed(2)}</strong> : "—"} ({costNote})
              {override != null && " · usando el valor manual"}
            </p>
          </div>
          <div className="sm:col-span-2">
            <Label>Notas</Label>
            <Textarea rows={3} value={f.notes} onChange={set("notes")} aria-label="Notas" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={!!busy}>
            Guardar
          </Button>
          <Button type="button" variant="danger" disabled={!!busy} onClick={remove}>
            Eliminar
          </Button>
          {busy && <Spinner label={busy} />}
          {msg && (
            <span role="status" className={`text-sm ${msg.ok ? "text-[#2f7d32]" : "text-red"}`}>
              {msg.text}
            </span>
          )}
        </div>
      </Card>
    </form>
  );
}
