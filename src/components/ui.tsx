/**
 * Shared UI primitives styled after the menu template. Use these instead of ad-hoc styles so all
 * screens look the same: paper cards, orange-ruled section headers, red accents, Oswald headings.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function PageTitle({ children, sub, actions }: { children: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {sub && <div className="font-heading text-sm font-semibold uppercase tracking-[.12em] text-red">{sub}</div>}
        <h1 className="font-heading text-4xl font-bold uppercase leading-none">{children}</h1>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Section header like the template: number, uppercase title, note on the right, orange rule. */
export function SectionHeader({ num, title, note }: { num?: string; title: ReactNode; note?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline gap-3 border-b-[3px] border-orange pb-1.5">
      {num && <span className="font-heading text-lg font-semibold text-orange">{num}</span>}
      <h2 className="font-heading text-2xl font-bold uppercase leading-none tracking-wide">{title}</h2>
      {note && <span className="ml-auto font-heading text-sm uppercase tracking-widest text-red">{note}</span>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("bg-paper p-4 shadow-[0_1px_0_var(--line)]", className)}>{children}</div>;
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
export function Button({ variant = "secondary", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 px-3 py-2 font-heading text-sm font-semibold uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-red-strong text-paper hover:bg-red",
        variant === "secondary" && "border-2 border-ink bg-paper text-ink hover:bg-yellow",
        variant === "ghost" && "text-red hover:bg-yellow/40",
        variant === "danger" && "border-2 border-red text-red hover:bg-red hover:text-paper",
        className,
      )}
    />
  );
}

const field = "w-full border-2 border-line bg-white/70 px-2 py-1.5 text-ink outline-none focus:border-orange";
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(field, className)} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(field, className)} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(field, className)} />;

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <label className={cx("mb-1 block font-heading text-xs font-semibold uppercase tracking-wider text-ink-soft", className)}>{children}</label>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "red" | "orange" | "green" }) {
  return (
    <span
      className={cx(
        "inline-block px-1.5 py-0.5 font-heading text-[11px] font-semibold uppercase tracking-wider",
        tone === "neutral" && "bg-page text-ink",
        tone === "red" && "bg-red text-paper",
        tone === "orange" && "bg-orange text-paper",
        tone === "green" && "bg-[#2f7d32] text-paper",
      )}
    >
      {children}
    </span>
  );
}

/** Menu-style row: diamond bullet, name, optional right side (price, actions). */
export function Row({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-center gap-3 border-b border-line px-1 py-2", className)}>
      <span className="diamond" />
      <div className="min-w-0 flex-1">{children}</div>
      {right}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-soft">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-orange border-t-transparent" />
      {label}
    </span>
  );
}

export function Warning({ children }: { children: ReactNode }) {
  return <div className="border-l-4 border-red bg-red/10 px-3 py-2 text-sm">{children}</div>;
}
