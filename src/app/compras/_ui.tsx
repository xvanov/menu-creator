"use client";

import { useState, type KeyboardEvent } from "react";
import { fmtQty } from "@/lib/shopping/units";
import { Input } from "@/components/ui";

/** fetch JSON; throws Error(message from API) on failure. */
export async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Error ${res.status}`);
  return data as T;
}

export const parseNum = (s: string): number | null => {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Number input that commits on blur / Enter (only when the value changed). */
export function NumberField({
  value,
  onCommit,
  className,
  disabled,
  label,
  allowEmpty,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  className?: string;
  disabled?: boolean;
  label: string;
  allowEmpty?: boolean;
}) {
  const shown = value == null ? "" : fmtQty(value);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const n = parseNum(draft);
    setDraft(null);
    if (n == null && !allowEmpty) return;
    if (n !== value) onCommit(n);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
    if (e.key === "Escape") setDraft(null);
  };
  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      className={className}
      disabled={disabled}
      value={draft ?? shown}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={onKey}
    />
  );
}

export function Notice({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "ok" }) {
  return <div className={`border-l-4 px-3 py-2 text-sm ${tone === "ok" ? "border-[#2f7d32] bg-[#2f7d32]/10" : "border-orange bg-yellow/30"}`}>{children}</div>;
}
