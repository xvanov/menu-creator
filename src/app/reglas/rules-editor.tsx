"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Input, Label, SectionHeader, Select, Spinner, Textarea, Warning } from "@/components/ui";
import { describeRule, RULE_TYPE_LABELS } from "@/lib/rules/describe";
import { ENTRADA_CATEGORIES, SEGUNDO_CATEGORIES, TAGS, WEEKDAYS, type Course, type DishFilter, type RuleParams, type Weekday } from "@/lib/types";
import type { RuleView } from "@/lib/rules/repo";

interface Draft {
  id?: number;
  name: string;
  description: string;
  hard: boolean;
  enabled: boolean;
  params: RuleParams;
}

const SERVICE_DAYS = WEEKDAYS.filter((d) => d !== "domingo");

const DEFAULT_PARAMS: Record<RuleParams["type"], RuleParams> = {
  count_per_day: { type: "count_per_day", filter: {}, max: 1 },
  count_per_week: { type: "count_per_week", filter: {}, max: 1 },
  forbid_pair: { type: "forbid_pair", a: {}, b: {} },
  no_repeat: { type: "no_repeat", days: 7, exceptNames: [] },
  text: { type: "text", text: "" },
};

const emptyDraft = (): Draft => ({ name: "", description: "", hard: true, enabled: true, params: DEFAULT_PARAMS.count_per_day });

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
  return body as T;
}

export function RulesEditor({ initialRules, dishNames }: { initialRules: RuleView[]; dishNames: string[] }) {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      if (!draft) return;
      const body = JSON.stringify({ name: draft.name, description: draft.description || null, hard: draft.hard, enabled: draft.enabled, params: draft.params });
      if (draft.id) {
        const r = await api<RuleView>(`/api/rules/${draft.id}`, { method: "PATCH", body });
        setRules((rs) => rs.map((x) => (x.id === r.id ? r : x)));
      } else {
        const r = await api<RuleView>("/api/rules", { method: "POST", body });
        setRules((rs) => [...rs, r]);
      }
      setDraft(null);
    });

  const toggle = (r: RuleView) =>
    run(async () => {
      const u = await api<RuleView>(`/api/rules/${r.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !r.enabled }) });
      setRules((rs) => rs.map((x) => (x.id === u.id ? u : x)));
    });

  const remove = (r: RuleView) =>
    run(async () => {
      if (!confirm(`¿Borrar la regla “${r.name}”?`)) return;
      await api(`/api/rules/${r.id}`, { method: "DELETE" });
      setRules((rs) => rs.filter((x) => x.id !== r.id));
      if (draft?.id === r.id) setDraft(null);
    });

  async function parse() {
    setParsing(true);
    setParseError(null);
    try {
      const out = await api<{ name: string; description: string; hard: boolean; params: RuleParams }>("/api/rules/parse", { method: "POST", body: JSON.stringify({ text }) });
      setDraft({ name: out.name, description: out.description, hard: out.hard, enabled: true, params: out.params });
    } catch (e) {
      setParseError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  return (
    <div className="space-y-8">
      <datalist id="dish-names">
        {dishNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <section>
        <SectionHeader num="01" title="Escribir la regla en palabras" note="con IA" />
        <Card>
          <Label>Regla</Label>
          <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ej.: no poner chancho los lunes · máximo dos cremas por semana" />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={parsing || text.trim().length < 3} onClick={parse}>
              Interpretar
            </Button>
            {parsing && <Spinner label="La IA está leyendo la regla… puede tardar un minuto" />}
            {!parsing && (
              <button
                className="text-sm text-red underline"
                disabled={text.trim().length < 3}
                onClick={() => setDraft({ name: text.slice(0, 60), description: "", hard: false, enabled: true, params: { type: "text", text } })}
              >
                o guardarla como texto libre
              </button>
            )}
          </div>
          {parseError && (
            <div className="mt-3">
              <Warning>{parseError}</Warning>
            </div>
          )}
          <p className="mt-2 text-xs text-ink-soft">La propuesta se abre en el formulario de abajo para que la revises antes de guardar.</p>
        </Card>
      </section>

      {draft && (
        <section>
          <SectionHeader num="02" title={draft.id ? "Editar regla" : "Nueva regla"} />
          <RuleForm draft={draft} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} busy={busy} />
        </section>
      )}

      <section>
        <SectionHeader num={draft ? "03" : "02"} title="Reglas" note={`${rules.filter((r) => r.enabled).length} activas`} />
        {error && (
          <div className="mb-3">
            <Warning>{error}</Warning>
          </div>
        )}
        <div className="space-y-3">
          {rules.map((r) => (
            <Card key={r.id} className={r.enabled ? "" : "opacity-60"}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-heading text-lg font-semibold uppercase leading-tight">{r.name}</span>
                    <Badge tone={r.hard ? "red" : "orange"}>{r.hard ? "Obligatoria" : "Preferencia"}</Badge>
                    <Badge>{RULE_TYPE_LABELS[r.params.type]}</Badge>
                    {!r.enabled && <Badge>Desactivada</Badge>}
                  </div>
                  <p className="mt-1 text-sm">{describeRule(r.params)}</p>
                  {r.description && <p className="mt-0.5 text-sm text-ink-soft">{r.description}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" className="accent-[var(--red)]" checked={r.enabled} disabled={busy} onChange={() => toggle(r)} />
                    Activa
                  </label>
                  <Button variant="ghost" disabled={busy} onClick={() => setDraft({ id: r.id, name: r.name, description: r.description ?? "", hard: r.hard, enabled: r.enabled, params: r.params })}>
                    Editar
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => remove(r)}>
                    Borrar
                  </Button>
                </div>
              </div>
            </Card>
          ))}
          {!rules.length && <p className="text-sm text-ink-soft">No hay reglas todavía.</p>}
        </div>
        {!draft && (
          <div className="mt-4">
            <Button variant="primary" onClick={() => setDraft(emptyDraft())}>
              + Nueva regla
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function RuleForm({ draft, onChange, onSave, onCancel, busy }: { draft: Draft; onChange: (d: Draft) => void; onSave: () => void; onCancel: () => void; busy: boolean }) {
  const p = draft.params;
  const setParams = (params: RuleParams) => onChange({ ...draft, params });
  const invalid = !draft.name.trim() || (p.type === "text" && !p.text.trim()) || (p.type === "no_repeat" && !(p.days > 0));

  return (
    <Card className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Nombre</Label>
          <Input value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder="Ej.: Sin chancho los lunes" />
        </div>
        <div>
          <Label>Tipo</Label>
          <Select
            value={p.type}
            onChange={(e) => {
              const type = e.target.value as RuleParams["type"];
              if (type !== p.type) setParams(DEFAULT_PARAMS[type]);
            }}
          >
            {Object.entries(RULE_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label>Descripción (opcional)</Label>
        <Input value={draft.description} onChange={(e) => onChange({ ...draft, description: e.target.value })} />
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" className="accent-[var(--red)]" checked={draft.hard} onChange={() => onChange({ ...draft, hard: true })} />
          Obligatoria
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" className="accent-[var(--red)]" checked={!draft.hard} onChange={() => onChange({ ...draft, hard: false })} />
          Preferencia (solo aviso)
        </label>
      </div>

      <div className="border-t border-line pt-4">
        {p.type === "count_per_day" && (
          <div className="space-y-4">
            <FilterBuilder title="Qué platos cuentan" filter={p.filter} onChange={(filter) => setParams({ ...p, filter })} />
            <div className="grid max-w-sm grid-cols-2 gap-3">
              <NumberField label="Mínimo por día" value={p.min} onChange={(min) => setParams({ ...p, min })} />
              <NumberField label="Máximo por día" value={p.max} onChange={(max) => setParams({ ...p, max })} />
            </div>
            <WeekdayOverrides value={p.weekdayOverrides ?? {}} onChange={(weekdayOverrides) => setParams({ ...p, weekdayOverrides })} />
          </div>
        )}
        {p.type === "count_per_week" && (
          <div className="space-y-4">
            <FilterBuilder title="Qué platos cuentan" filter={p.filter} onChange={(filter) => setParams({ ...p, filter })} />
            <div className="max-w-[12rem]">
              <NumberField label="Máximo por semana (lun–sáb)" value={p.max} onChange={(max) => setParams({ ...p, max: max ?? 0 })} />
            </div>
          </div>
        )}
        {p.type === "forbid_pair" && (
          <div className="grid gap-4 md:grid-cols-2">
            <FilterBuilder title="Si hay…" filter={p.a} onChange={(a) => setParams({ ...p, a })} />
            <FilterBuilder title="…no puede haber" filter={p.b} onChange={(b) => setParams({ ...p, b })} />
          </div>
        )}
        {p.type === "no_repeat" && (
          <div className="space-y-4">
            <div className="max-w-[12rem]">
              <NumberField label="Días sin repetir" value={p.days} onChange={(days) => setParams({ ...p, days: days ?? 1 })} />
            </div>
            <NamePicker label="Excepto (pueden repetirse)" names={p.exceptNames ?? []} onChange={(exceptNames) => setParams({ ...p, exceptNames })} />
          </div>
        )}
        {p.type === "text" && (
          <div>
            <Label>Regla para la IA</Label>
            <Textarea rows={3} value={p.text} onChange={(e) => setParams({ ...p, text: e.target.value })} />
            <p className="mt-1 text-xs text-ink-soft">No se revisa automáticamente: la IA la tiene en cuenta al armar el menú.</p>
          </div>
        )}
      </div>

      <div className="rounded-sm bg-page px-3 py-2 text-sm">
        <span className="font-heading text-xs font-semibold uppercase tracking-wider text-ink-soft">Resumen: </span>
        {describeRule(p) || "—"}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy || invalid} onClick={onSave}>
          {busy ? "Guardando…" : "Guardar regla"}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </Card>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        type="number"
        min={0}
        inputMode="numeric"
        value={value ?? ""}
        placeholder="—"
        onChange={(e) => onChange(e.target.value === "" ? undefined : Math.max(0, Math.round(Number(e.target.value))))}
      />
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-2 px-2 py-0.5 font-heading text-xs font-semibold uppercase tracking-wider ${active ? "border-red bg-red text-paper" : "border-line bg-white/60 text-ink hover:border-orange"}`}
    >
      {children}
    </button>
  );
}

function FilterBuilder({ title, filter, onChange }: { title: string; filter: DishFilter; onChange: (f: DishFilter) => void }) {
  const cats = filter.course === "entrada" ? ENTRADA_CATEGORIES : filter.course === "segundo" || filter.course === "extra" ? SEGUNDO_CATEGORIES : [...new Set([...ENTRADA_CATEGORIES, ...SEGUNDO_CATEGORIES])];
  const toggle = (list: string[] | undefined, v: string) => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v]);
  return (
    <div className="space-y-3 border-l-4 border-orange pl-3">
      <div className="font-heading text-sm font-semibold uppercase tracking-wider">{title}</div>
      <div className="max-w-[14rem]">
        <Label>Plato</Label>
        <Select value={filter.course ?? ""} onChange={(e) => onChange({ ...filter, course: (e.target.value || undefined) as Course | undefined, categories: [] })}>
          <option value="">Entradas o segundos</option>
          <option value="entrada">Entradas</option>
          <option value="segundo">Segundos</option>
          <option value="extra">Extras</option>
        </Select>
      </div>
      <div>
        <Label>Categorías (cualquiera)</Label>
        <div className="flex flex-wrap gap-1.5">
          {cats.map((c) => (
            <Chip key={c} active={!!filter.categories?.includes(c)} onClick={() => onChange({ ...filter, categories: toggle(filter.categories, c) })}>
              {c}
            </Chip>
          ))}
        </div>
      </div>
      <div>
        <Label>Etiquetas (cualquiera)</Label>
        <div className="flex flex-wrap gap-1.5">
          {TAGS.map((t) => (
            <Chip key={t} active={!!filter.tagsAny?.includes(t)} onClick={() => onChange({ ...filter, tagsAny: toggle(filter.tagsAny, t) })}>
              {t}
            </Chip>
          ))}
        </div>
      </div>
      <NamePicker label="Platos concretos (opcional)" names={filter.names ?? []} onChange={(names) => onChange({ ...filter, names })} />
    </div>
  );
}

function NamePicker({ label, names, onChange }: { label: string; names: string[]; onChange: (n: string[]) => void }) {
  const [value, setValue] = useState("");
  const add = () => {
    const v = value.trim();
    if (v && !names.some((n) => n.toLowerCase() === v.toLowerCase())) onChange([...names, v]);
    setValue("");
  };
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex max-w-md gap-2">
        <Input
          list="dish-names"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Busca un plato…"
        />
        <Button type="button" onClick={add} disabled={!value.trim()}>
          Añadir
        </Button>
      </div>
      {names.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {names.map((n) => (
            <span key={n} className="inline-flex items-center gap-1 bg-yellow px-2 py-0.5 text-sm">
              {n}
              <button type="button" aria-label={`Quitar ${n}`} className="font-bold text-red" onClick={() => onChange(names.filter((x) => x !== n))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function WeekdayOverrides({
  value,
  onChange,
}: {
  value: Partial<Record<Weekday, { min?: number; max?: number }>>;
  onChange: (v: Partial<Record<Weekday, { min?: number; max?: number }>>) => void;
}) {
  const set = (day: Weekday, key: "min" | "max", v: number | undefined) => {
    const cur = { ...value[day], [key]: v };
    if (v === undefined) delete cur[key];
    const next = { ...value, [day]: cur };
    if (cur.min === undefined && cur.max === undefined) delete next[day];
    onChange(next);
  };
  return (
    <div>
      <Label>Días con otra cantidad (vacío = igual que siempre)</Label>
      <div className="grid max-w-xl grid-cols-3 gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr_1fr]">
        <span />
        <span className="font-heading text-xs uppercase text-ink-soft">Mín.</span>
        <span className="font-heading text-xs uppercase text-ink-soft">Máx.</span>
        {SERVICE_DAYS.map((d) => (
          <DayRow key={d} day={d} value={value[d]} onSet={set} />
        ))}
      </div>
    </div>
  );
}

function DayRow({ day, value, onSet }: { day: Weekday; value?: { min?: number; max?: number }; onSet: (d: Weekday, k: "min" | "max", v: number | undefined) => void }) {
  const num = (k: "min" | "max") => (
    <Input
      type="number"
      min={0}
      className="py-1"
      value={value?.[k] ?? ""}
      placeholder="—"
      onChange={(e) => onSet(day, k, e.target.value === "" ? undefined : Math.max(0, Math.round(Number(e.target.value))))}
    />
  );
  return (
    <>
      <span className="self-center capitalize">{day}</span>
      {num("min")}
      {num("max")}
    </>
  );
}
