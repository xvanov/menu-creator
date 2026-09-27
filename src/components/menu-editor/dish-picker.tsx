"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Input, Spinner } from "@/components/ui";
import { api, type DishOption } from "./api";

const COURSE_LABEL = { entrada: "entrada", segundo: "segundo", extra: "extra" } as const;

/**
 * Text input with dish autocomplete (GET /api/dishes?q=). Enter on a highlighted suggestion picks it;
 * Enter with no highlight submits the free text (the server resolves or creates the dish).
 */
export function DishPicker({
  value,
  onChange,
  onPick,
  onSubmit,
  onCancel,
  course,
  placeholder = "Escribe un plato…",
  label,
  autoFocus,
  disabled,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (d: DishOption) => void;
  onSubmit?: (text: string) => void;
  onCancel?: () => void;
  /** Suggestions of this course are listed first. */
  course?: DishOption["course"];
  placeholder?: string;
  label: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [options, setOptions] = useState<DishOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const listId = useId();
  const skipNext = useRef(false);

  useEffect(() => {
    const q = value.trim();
    if (skipNext.current || q.length < 2) {
      skipNext.current = false;
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const { dishes } = await api<{ dishes: DishOption[] }>(`/api/dishes?q=${encodeURIComponent(q)}&limit=12`, { signal: ctrl.signal });
        const sorted = course ? [...dishes].sort((a, b) => Number(b.course === course) - Number(a.course === course)) : dishes;
        setOptions(sorted.slice(0, 8));
        setActive(-1);
        setOpen(true);
      } catch {
        /* aborted or offline: keep free text */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [value, course]);

  const shown = open && value.trim().length >= 2 ? options : [];

  function pick(d: DishOption) {
    skipNext.current = true;
    setOpen(false);
    onPick(d);
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <div className="flex items-center gap-2">
        <Input
          aria-label={label}
          role="combobox"
          aria-expanded={shown.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && shown.length) {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, shown.length - 1));
            } else if (e.key === "ArrowUp" && shown.length) {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, -1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (active >= 0 && shown[active]) pick(shown[active]);
              else if (value.trim()) {
                setOpen(false);
                onSubmit?.(value.trim());
              }
            } else if (e.key === "Escape") {
              if (shown.length) setOpen(false);
              else onCancel?.();
            }
          }}
        />
        {loading && <Spinner />}
      </div>
      {shown.length > 0 && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-auto border-2 border-ink bg-paper shadow-lg">
          {shown.map((d, i) => (
            <li
              key={d.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(d);
              }}
              className={`flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm ${i === active ? "bg-yellow" : "hover:bg-yellow/50"}`}
            >
              <span className="diamond" />
              <span className="flex-1">{d.name}</span>
              <span className="text-xs uppercase text-ink-soft">
                {COURSE_LABEL[d.course]} · {d.category}
                {d.status === "nuevo" && " · nuevo"}
              </span>
              {d.price != null && d.course === "extra" && <span className="font-heading text-red">S/ {d.price.toFixed(2)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
