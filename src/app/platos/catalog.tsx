"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, errorText } from "@/components/menu-editor";
import { Badge, Button, Card, Input, Label, Select, SectionHeader, Spinner } from "@/components/ui";
import type { Course } from "@/lib/types";
import type { DishWithStats } from "./_lib/dishes";
import { COURSE_LABELS, dmy, normalizeText, STATUS_LABELS } from "./format";

type Sort = "nombre" | "veces" | "ultima";

export function Catalog({ dishes, categories, initialStatus }: { dishes: DishWithStats[]; categories: string[]; initialStatus: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [course, setCourse] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [sort, setSort] = useState<Sort>("nombre");
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nq = normalizeText(q);
  const shown = dishes
    .filter((d) => !nq || normalizeText(d.name).includes(nq))
    .filter((d) => !course || d.course === course)
    .filter((d) => !category || d.category === category)
    .filter((d) => (status ? d.status === status : d.status !== "archivado"))
    .sort((a, b) =>
      sort === "veces"
        ? b.timesServed - a.timesServed
        : sort === "ultima"
          ? (b.lastServed ?? "").localeCompare(a.lastServed ?? "")
          : a.name.localeCompare(b.name, "es"),
    );
  const nuevos = dishes.filter((d) => d.status === "nuevo").length;

  async function approve(id: number) {
    setPending(id);
    setError(null);
    try {
      await api(`/api/dishes/${id}`, { method: "PATCH", body: { status: "activo" } });
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6">
      {nuevos > 0 && status !== "nuevo" && (
        <button type="button" onClick={() => setStatus("nuevo")} className="w-full border-l-4 border-orange bg-yellow/40 px-3 py-2 text-left text-sm">
          Hay <strong>{nuevos}</strong> plato(s) nuevo(s) por aprobar. Ver →
        </button>
      )}

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="sm:col-span-2 lg:col-span-2">
            <Label>Buscar</Label>
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre del plato" aria-label="Buscar plato" />
          </div>
          <div>
            <Label>Tiempo</Label>
            <Select value={course} onChange={(e) => setCourse(e.target.value)} aria-label="Filtrar por tiempo">
              <option value="">Todos</option>
              {Object.entries(COURSE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Categoría</Label>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filtrar por categoría">
              <option value="">Todas</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Estado</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar por estado">
              <option value="">Activos y nuevos</option>
              {Object.entries(STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-soft">{shown.length} platos · ordenar por</span>
          {(["nombre", "veces", "ultima"] as Sort[]).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={sort === s}
              onClick={() => setSort(s)}
              className={`px-2 py-0.5 font-heading text-xs uppercase tracking-wider ${sort === s ? "bg-ink text-paper" : "bg-page"}`}
            >
              {s === "nombre" ? "nombre" : s === "veces" ? "veces servido" : "última vez"}
            </button>
          ))}
        </div>
      </Card>

      {error && (
        <div role="alert" className="border-l-4 border-red bg-red/15 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <Card>
        <SectionHeader num="01" title="Catálogo" note={`${shown.length}`} />
        <ul>
          {shown.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-1 py-2">
              <span className="diamond" />
              <Link href={`/platos/${d.id}`} className="min-w-0 flex-1 font-medium text-ink no-underline hover:text-red">
                {d.name}
              </Link>
              <span className="flex flex-wrap items-center gap-1">
                <Badge>{COURSE_LABELS[d.course]}</Badge>
                <Badge>{d.category}</Badge>
                {d.status === "nuevo" && <Badge tone="red">nuevo</Badge>}
                {d.status === "archivado" && <Badge tone="orange">archivado</Badge>}
                {d.price != null && d.course === "extra" && <span className="font-heading text-sm text-red">S/ {d.price.toFixed(2)}</span>}
              </span>
              <span className="w-full pl-5 text-xs text-ink-soft sm:w-auto sm:pl-0">
                {d.timesServed}× · última {dmy(d.lastServed)}
              </span>
              {d.status === "nuevo" && (
                <Button variant="ghost" className="px-2 py-1 text-xs" disabled={pending === d.id} onClick={() => approve(d.id)}>
                  {pending === d.id ? <Spinner /> : "Aprobar"}
                </Button>
              )}
            </li>
          ))}
          {shown.length === 0 && <li className="py-3 text-sm text-ink-soft">No hay platos con esos filtros.</li>}
        </ul>
      </Card>

      <NewDish categories={categories} initialName={q} />
    </div>
  );
}

function NewDish({ categories, initialName }: { categories: string[]; initialName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [course, setCourse] = useState<Course>("segundo");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { dish } = await api<{ dish: { id: number } }>("/api/dishes", { method: "POST", body: { name, course, category } });
      router.push(`/platos/${dish.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  if (!open)
    return (
      <Button
        variant="primary"
        onClick={() => {
          setName(initialName);
          setOpen(true);
        }}
      >
        + Nuevo plato
      </Button>
    );
  return (
    <Card>
      <SectionHeader title="Nuevo plato" />
      <form onSubmit={create} className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label>Nombre</Label>
          <Input required value={name} onChange={(e) => setName(e.target.value)} aria-label="Nombre del plato" autoFocus />
        </div>
        <div>
          <Label>Tiempo</Label>
          <Select value={course} onChange={(e) => setCourse(e.target.value as Course)} aria-label="Tiempo">
            {Object.entries(COURSE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Categoría</Label>
          <Input required list="new-dish-categories" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoría" />
          <datalist id="new-dish-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy && <Spinner />}
            Crear
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          {error && <span className="text-sm text-red">{error}</span>}
        </div>
      </form>
    </Card>
  );
}
