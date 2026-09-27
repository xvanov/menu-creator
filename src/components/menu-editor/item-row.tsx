"use client";

import { useState } from "react";
import { Badge, Button, Input, Spinner } from "@/components/ui";
import type { MenuItemView } from "@/lib/types";
import type { DishOption } from "./api";
import { DishPicker } from "./dish-picker";

export interface ItemPatch {
  name?: string;
  dishId?: number;
  price?: number | null;
  portions?: number | null;
  pinned?: boolean;
}

const numOrNull = (s: string) => {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined; // undefined = invalid, ignore
};

/** One editable menu item: rename with autocomplete, badges, reason, pin, swap, delete, portions, price. */
export function ItemRow({
  item,
  portionsPlaceholder,
  pricePlaceholder,
  disabled,
  onPatch,
  onSwap,
  onDelete,
  onApprove,
}: {
  item: MenuItemView;
  portionsPlaceholder: number;
  pricePlaceholder?: number | null;
  disabled?: boolean;
  onPatch: (patch: ItemPatch) => Promise<unknown>;
  onSwap: () => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  onApprove: (dishId: number) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.name);
  const [pending, setPending] = useState<string | null>(null);
  const isExtra = item.course === "extra";
  const busy = disabled || pending !== null;

  async function run(label: string, fn: () => Promise<unknown>) {
    setPending(label);
    try {
      await fn();
    } finally {
      setPending(null);
    }
  }

  function startEdit() {
    if (busy) return;
    setText(item.name);
    setEditing(true);
  }

  function rename(patch: ItemPatch) {
    setEditing(false);
    if (!patch.dishId && patch.name === item.name) return;
    void run(patch.dishId ? "Guardando…" : "Clasificando el plato…", () => onPatch(patch));
  }

  const dish = item.dish;
  return (
    <li className="border-b border-line py-2.5">
      <div className="flex items-start gap-3">
        <span className="diamond mt-2.5" />
        <div className="min-w-0 flex-1">
          {editing ? (
            <DishPicker
              label={`Reemplazar ${item.name}`}
              value={text}
              onChange={setText}
              course={item.course}
              autoFocus
              onPick={(d: DishOption) => rename({ dishId: d.id, name: d.name, ...(isExtra && d.price != null ? { price: d.price } : {}) })}
              onSubmit={(t) => rename({ name: t })}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <button
              type="button"
              onClick={startEdit}
              disabled={busy}
              title="Clic para cambiar el plato"
              className="w-full cursor-text text-left text-lg font-medium leading-tight hover:text-red disabled:cursor-wait"
            >
              {item.name}
            </button>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {dish && <Badge>{dish.category}</Badge>}
            {!dish && <Badge tone="orange">sin plato</Badge>}
            {dish?.status === "nuevo" && (
              <>
                <Badge tone="red">nuevo</Badge>
                <Button variant="ghost" className="px-1.5 py-0.5 text-xs" disabled={busy} onClick={() => run("Aprobando…", () => onApprove(dish.id))}>
                  Aprobar
                </Button>
              </>
            )}
            {item.pinned && <Badge tone="green">fijo</Badge>}
            {pending && <Spinner label={pending} />}
          </div>
          {item.reason && <p className="mt-1 text-xs text-ink-soft">{item.reason}</p>}
          {editing && <p className="mt-1 text-xs text-ink-soft">Elige de la lista o escribe un plato nuevo y presiona Enter. Esc para cancelar.</p>}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 pl-5">
        <label className="flex items-center gap-1 text-xs uppercase tracking-wider text-ink-soft">
          Porciones
          <Input
            key={`p${item.portions}`}
            type="number"
            inputMode="numeric"
            min={0}
            className="w-16 py-1 text-sm"
            defaultValue={item.portions ?? ""}
            placeholder={String(portionsPlaceholder)}
            disabled={busy}
            onBlur={(e) => {
              const v = numOrNull(e.target.value);
              if (v === undefined || v === item.portions) return;
              void run("Guardando…", () => onPatch({ portions: v === null ? null : Math.round(v) }));
            }}
          />
        </label>
        {isExtra && (
          <label className="flex items-center gap-1 text-xs uppercase tracking-wider text-ink-soft">
            S/
            <Input
              key={`$${item.price}`}
              type="number"
              inputMode="decimal"
              step="0.5"
              min={0}
              className="w-20 py-1 text-sm"
              defaultValue={item.price ?? ""}
              placeholder={pricePlaceholder != null ? String(pricePlaceholder) : "precio"}
              disabled={busy}
              onBlur={(e) => {
                const v = numOrNull(e.target.value);
                if (v === undefined || v === item.price) return;
                void run("Guardando…", () => onPatch({ price: v }));
              }}
            />
          </label>
        )}
        <div className="ml-auto flex flex-wrap gap-1">
          <Button
            variant="ghost"
            className="px-2 py-1 text-xs"
            aria-pressed={item.pinned}
            title={item.pinned ? "Soltar: al generar se puede cambiar" : "Fijar: se mantiene al generar"}
            disabled={busy}
            onClick={() => run("Guardando…", () => onPatch({ pinned: !item.pinned }))}
          >
            {item.pinned ? "Soltar" : "Fijar"}
          </Button>
          <Button variant="ghost" className="px-2 py-1 text-xs" disabled={busy} onClick={() => run("Buscando otro plato…", onSwap)}>
            Cambiar
          </Button>
          <Button variant="ghost" className="px-2 py-1 text-xs" disabled={busy} aria-label={`Quitar ${item.name}`} onClick={() => run("Quitando…", onDelete)}>
            Quitar
          </Button>
        </div>
      </div>
    </li>
  );
}
