"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PosterPreview, posterDateLabel } from "@/components/menu-poster";
import { Badge, Button, Card, Input, SectionHeader, Spinner, Warning } from "@/components/ui";
import type { Course, MenuItemView, MenuPayload } from "@/lib/types";
import { buildWhatsappText } from "@/lib/whatsapp";
import { api, errorText, type DishOption } from "./api";
import { isValidDate, longDate, shiftServiceDay } from "./dates";
import { DishPicker } from "./dish-picker";
import { ItemRow, type ItemPatch } from "./item-row";
import { SortableList } from "./sortable-list";

export interface MenuEditorProps {
  initial: MenuPayload;
  settings: { menuPrice: number; defaultPortions: number; extraPortions: number };
  /** Per-dish defaults for placeholders (portions, extra price). */
  dishDefaults: Record<number, { defaultPortions: number | null; price: number | null }>;
  /** Menus made in the app from yesterday on (not the imported history), to find drafts for other days. */
  upcoming?: { date: string; status: string }[];
}

const SECTIONS: { course: Course; num: string; title: string; note: string }[] = [
  { course: "entrada", num: "01", title: "Entradas", note: "Elige una" },
  { course: "segundo", num: "02", title: "Segundos", note: "Elige uno" },
  { course: "extra", num: "03", title: "Extras", note: "Precio aparte" },
];

const shortDate = (d: string) =>
  new Intl.DateTimeFormat("es-PE", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

export function MenuEditor({ initial, settings, dishDefaults, upcoming = [] }: MenuEditorProps) {
  const router = useRouter();
  const [payload, setPayload] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { date, menu, items } = payload;
  const base = `/api/menus/${date}`;
  const menuPrice = menu?.menuPrice ?? settings.menuPrice;
  const published = menu?.status === "publicado";
  const byCourse = (c: Course) => items.filter((i) => i.course === c);
  const unapproved = items.filter((i) => i.dish?.status === "nuevo");

  /** Runs a menu mutation; the response (MenuPayload) replaces local state. Errors are shown, not thrown. */
  async function mutate(fn: () => Promise<MenuPayload>) {
    setError(null);
    try {
      setPayload(await fn());
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function action(label: string, fn: () => Promise<MenuPayload>) {
    setBusy(label);
    await mutate(fn);
    setBusy(null);
  }

  const generate = (useLlm: boolean) =>
    action(useLlm ? "Generando con IA… puede tardar hasta un minuto" : "Generando…", () =>
      api<MenuPayload>(`${base}/generate`, { method: "POST", body: { useLlm } }),
    );
  const setStatus = (status: "borrador" | "publicado") =>
    action(status === "publicado" ? "Publicando…" : "Guardando…", () => api<MenuPayload>(base, { method: "PATCH", body: { status } }));

  const patchItem = (id: number, body: ItemPatch) => mutate(() => api<MenuPayload>(`${base}/items/${id}`, { method: "PATCH", body }));
  const swapItem = (id: number) => mutate(() => api<MenuPayload>(`${base}/items/${id}/swap`, { method: "POST", body: {} }));
  const deleteItem = (id: number) => mutate(() => api<MenuPayload>(`${base}/items/${id}`, { method: "DELETE" }));
  const addItem = (body: { course: Course; name: string; dishId?: number; price?: number | null }) =>
    mutate(() => api<MenuPayload>(`${base}/items`, { method: "POST", body }));
  /** Drag & drop: show the new order at once, save it, and re-sync from the server if saving fails. */
  async function reorder(course: Course, next: MenuItemView[]) {
    const queue = [...next];
    const all = items.map((i) => (i.course === course ? queue.shift()! : i));
    setPayload({ ...payload, items: all });
    setError(null);
    try {
      setPayload(await api<MenuPayload>(`${base}/items`, { method: "PATCH", body: { order: all.map((i) => i.id) } }));
    } catch (e) {
      setError(`No se pudo guardar el orden: ${errorText(e)}`);
      await mutate(() => api<MenuPayload>(base));
    }
  }
  const approve = (dishId: number) =>
    mutate(async () => {
      await api(`/api/dishes/${dishId}`, { method: "PATCH", body: { status: "activo" } });
      return api<MenuPayload>(base);
    });

  // Always show what's saved: the router can restore an old copy of this page (back/forward), so re-read the
  // menu from the server when the editor mounts and whenever the tab or page becomes visible again.
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      if (busyRef.current || document.visibilityState !== "visible") return;
      try {
        const fresh = await api<MenuPayload>(base);
        if (!cancelled && !busyRef.current) setPayload(fresh);
      } catch {
        /* offline: keep what we have */
      }
    };
    void sync();
    try {
      localStorage.setItem("lastMenu", JSON.stringify({ date, at: Date.now() }));
    } catch {
      /* storage unavailable */
    }
    const onShow = () => void sync();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [base, date]);

  const names = (c: Course) => byCourse(c).map((i) => i.name);
  const extras = byCourse("extra").map((i) => ({ name: i.name, price: i.price }));
  const whatsapp = buildWhatsappText({ menuPrice, entradas: names("entrada"), segundos: names("segundo"), extras });

  const prev = shiftServiceDay(date, -1);
  const next = shiftServiceDay(date, 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-heading text-sm font-semibold uppercase tracking-[.12em] text-red">
            Menú del día
            {menu ? <Badge tone={published ? "green" : "orange"}>{menu.status}</Badge> : <Badge>sin menú</Badge>}
          </div>
          <h1 className="font-heading text-3xl font-bold uppercase leading-none sm:text-4xl">{longDate(date)}</h1>
        </div>
        <nav aria-label="Cambiar de día" className="flex flex-wrap items-center gap-2">
          <Link href={`/menu/${prev}`} className="border-2 border-ink bg-paper px-3 py-1.5 font-heading text-sm font-semibold uppercase text-ink no-underline hover:bg-yellow">
            ← Anterior
          </Link>
          <Input
            type="date"
            aria-label="Ir a la fecha"
            className="w-auto py-1"
            value={date}
            onChange={(e) => isValidDate(e.target.value) && router.push(`/menu/${e.target.value}`)}
          />
          <Link href={`/menu/${next}`} className="border-2 border-ink bg-paper px-3 py-1.5 font-heading text-sm font-semibold uppercase text-ink no-underline hover:bg-yellow">
            Siguiente →
          </Link>
        </nav>
      </div>

      {upcoming.length > 0 && (
        <nav aria-label="Menús guardados" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-heading text-xs font-semibold uppercase tracking-wider text-ink-soft">Tus menús:</span>
          {upcoming.map((u) => (
            <Link
              key={u.date}
              href={`/menu/${u.date}`}
              aria-current={u.date === date ? "page" : undefined}
              className={`border px-2 py-0.5 no-underline ${u.date === date ? "border-red bg-red text-paper" : "border-line bg-paper text-ink hover:border-red"}`}
            >
              {shortDate(u.date)} · {u.status === "publicado" ? "publicado" : "borrador"}
            </Link>
          ))}
        </nav>
      )}

      <Card className="flex flex-wrap items-center gap-3">
        <div className="bg-red-strong px-4 py-2 text-center text-paper">
          <div className="font-heading text-xs uppercase tracking-[.14em] text-gold">Entrada + Segundo</div>
          <div className="font-heading text-2xl font-bold leading-none">S/ {menuPrice.toFixed(2)}</div>
        </div>
        <div className="flex flex-1 flex-wrap justify-end gap-2">
          <Button onClick={() => generate(false)} disabled={!!busy || published} title="Arma el menú solo con las reglas (rápido)">
            Generar
          </Button>
          <Button onClick={() => generate(true)} disabled={!!busy || published} title="Usa IA para elegir y explicar (hasta 1 minuto)">
            Generar con IA
          </Button>
          {menu &&
            (published ? (
              <Button variant="danger" onClick={() => setStatus("borrador")} disabled={!!busy}>
                Volver a borrador
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setStatus("publicado")} disabled={!!busy || items.length === 0}>
                Publicar
              </Button>
            ))}
        </div>
        {busy && (
          <div className="w-full" role="status">
            <Spinner label={busy} />
          </div>
        )}
        {published && <p className="w-full text-xs text-ink-soft">Publicado. Para regenerar, vuelve a borrador.</p>}
        {!published && unapproved.length > 0 && (
          <p className="w-full text-xs text-ink-soft">Hay {unapproved.length} plato(s) nuevo(s): apruébalos antes de publicar.</p>
        )}
      </Card>

      {error && (
        <div role="alert" className="flex items-start gap-2 border-l-4 border-red bg-red/15 px-3 py-2 text-sm">
          <span className="flex-1">{error}</span>
          <button type="button" className="font-heading text-xs uppercase text-red" onClick={() => setError(null)}>
            Cerrar
          </button>
        </div>
      )}

      {!menu && (
        <Card>
          <p className="font-heading text-lg font-semibold uppercase">Todavía no hay menú para este día</p>
          <p className="mt-1 text-sm">
            Usa <strong>Generar</strong> para armarlo con las reglas, o <strong>Generar con IA</strong> para que la IA elija y explique. También
            puedes agregar los platos a mano con <strong>+ Agregar</strong> en cada sección.
          </p>
        </Card>
      )}

      {menu && menu.warnings.length > 0 && (
        <div className="space-y-1.5" aria-label="Reglas no cumplidas">
          <div className="font-heading text-sm font-semibold uppercase tracking-wider text-red">Reglas no cumplidas ({menu.warnings.length})</div>
          {menu.warnings.map((w, i) => (
            <Warning key={i}>{w}</Warning>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* Editor */}
        <div className="space-y-6">
          {SECTIONS.map((s) => (
            <Card key={s.course}>
              <SectionHeader num={s.num} title={s.title} note={s.note} />
              <ul>
                <SortableList items={byCourse(s.course)} disabled={!!busy} onReorder={(next) => reorder(s.course, next)}>
                  {(item, handle) => (
                    <ItemRow
                      key={`${item.id}-${item.dishId}-${item.name}`}
                      item={item}
                      handle={handle}
                      disabled={!!busy}
                      portionsPlaceholder={placeholderPortions(item, dishDefaults, settings)}
                      pricePlaceholder={item.dishId ? dishDefaults[item.dishId]?.price : null}
                      onPatch={(p) => patchItem(item.id, p)}
                      onSwap={() => swapItem(item.id)}
                      onDelete={() => deleteItem(item.id)}
                      onApprove={approve}
                    />
                  )}
                </SortableList>
                {byCourse(s.course).length === 0 && <li className="py-2 text-sm text-ink-soft">Sin platos.</li>}
              </ul>
              <AddItem course={s.course} disabled={!!busy} onAdd={addItem} />
            </Card>
          ))}
          {menu?.reasoning && (
            <details className="bg-paper p-4 text-sm">
              <summary className="cursor-pointer font-heading font-semibold uppercase tracking-wider">Por qué este menú</summary>
              <p className="mt-2 whitespace-pre-line">{menu.reasoning}</p>
            </details>
          )}
        </div>

        {/* Output */}
        <div className="space-y-6">
          <Card>
            <SectionHeader title="Diseño" note="1080 × 1350" />
            <PosterPreview
              filename={`menu-${date}.png`}
              dateLabel={posterDateLabel(date)}
              menuPrice={menuPrice}
              entradas={byCourse("entrada").map((i) => ({ name: i.name }))}
              segundos={byCourse("segundo").map((i) => ({ name: i.name }))}
              extras={extras}
            />
          </Card>
          <Card>
            <SectionHeader title="WhatsApp" />
            <WhatsappBox text={whatsapp} />
          </Card>
          <Link href={`/compras/${date}`} className="block font-heading text-lg font-semibold uppercase tracking-wider">
            Ver compras →
          </Link>
        </div>
      </div>
    </div>
  );
}

function placeholderPortions(item: MenuItemView, defaults: MenuEditorProps["dishDefaults"], s: MenuEditorProps["settings"]) {
  const d = item.dishId ? defaults[item.dishId]?.defaultPortions : null;
  return d ?? (item.course === "extra" ? s.extraPortions : s.defaultPortions);
}

function AddItem({
  course,
  disabled,
  onAdd,
}: {
  course: Course;
  disabled?: boolean;
  onAdd: (body: { course: Course; name: string; dishId?: number; price?: number | null }) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);

  async function add(body: { name: string; dishId?: number; price?: number | null }) {
    setPending(true);
    await onAdd({ course, ...body });
    setPending(false);
    setText("");
    setOpen(false);
  }

  if (!open)
    return (
      <Button variant="ghost" className="mt-2" disabled={disabled} onClick={() => setOpen(true)}>
        + Agregar
      </Button>
    );
  return (
    <div className="mt-3 space-y-1">
      <DishPicker
        label={`Agregar ${course}`}
        value={text}
        onChange={setText}
        course={course}
        autoFocus
        disabled={pending}
        onPick={(d: DishOption) => add({ name: d.name, dishId: d.id, ...(course === "extra" && d.price != null ? { price: d.price } : {}) })}
        onSubmit={(t) => add({ name: t })}
        onCancel={() => setOpen(false)}
      />
      <div className="flex items-center gap-2">
        {pending ? (
          <Spinner label="Agregando… (un plato nuevo se clasifica, puede tardar)" />
        ) : (
          <>
            <Button variant="ghost" className="px-2 py-1 text-xs" disabled={!text.trim()} onClick={() => add({ name: text.trim() })}>
              Agregar
            </Button>
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function WhatsappBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-2 border-line bg-white/60 p-3 font-body text-sm">{text}</pre>
      <Button variant="primary" className="mt-3" onClick={copy}>
        {copied ? "¡Copiado!" : "Copiar"}
      </Button>
    </div>
  );
}
