"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, DishPicker, errorText } from "@/components/menu-editor";
import { Button, Card, Input, Label, SectionHeader, Spinner } from "@/components/ui";
import { WEEKDAYS, type Settings, type Weekday } from "@/lib/types";

type ExtraRow = { name: string; id: number | null; price: string; originalPrice: number | null };

const OPEN_DAYS = WEEKDAYS.filter((d) => d !== "domingo");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function SettingsForm({ initial, extraDishes }: { initial: Settings; extraDishes: { id: number; name: string; price: number | null }[] }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [extras, setExtras] = useState<ExtraRow[]>(() =>
    initial.defaultExtras.map((name) => {
      const d = extraDishes.find((x) => x.name === name);
      return { name, id: d?.id ?? null, price: d?.price?.toString() ?? "", originalPrice: d?.price ?? null };
    }),
  );
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const num = (k: "menuPrice" | "defaultPortions" | "extraPortions" | "extrasPerDay" | "newDishesPerWeek") => ({
    value: String(s[k]),
    onChange: (e: { target: { value: string } }) => setS((p) => ({ ...p, [k]: Number(e.target.value.replace(",", ".")) || 0 })),
  });
  const setStructure = (day: Weekday, k: "entradas" | "segundos", v: string) =>
    setS((p) => ({ ...p, structure: { ...p.structure, [day]: { ...p.structure[day], [k]: Math.max(0, Math.round(Number(v) || 0)) } } }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/settings", { method: "PATCH", body: { ...s, defaultExtras: extras.map((x) => x.name) } });
      for (const x of extras) {
        const price = x.price.trim() === "" ? null : Number(x.price.replace(",", "."));
        if (x.id != null && price !== x.originalPrice) await api(`/api/dishes/${x.id}`, { method: "PATCH", body: { price } });
      }
      setExtras((xs) => xs.map((x) => ({ ...x, originalPrice: x.price.trim() === "" ? null : Number(x.price.replace(",", ".")) })));
      setMsg({ ok: true, text: "Ajustes guardados." });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <Card>
        <SectionHeader num="01" title="Precio y porciones" />
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label>Menú (entrada + segundo) S/</Label>
            <Input type="number" inputMode="decimal" step="0.5" min={0} aria-label="Precio del menú" {...num("menuPrice")} />
          </div>
          <div>
            <Label>Porciones por plato</Label>
            <Input type="number" inputMode="numeric" min={0} aria-label="Porciones por plato" {...num("defaultPortions")} />
          </div>
          <div>
            <Label>Porciones por extra</Label>
            <Input type="number" inputMode="numeric" min={0} aria-label="Porciones por extra" {...num("extraPortions")} />
          </div>
        </div>
      </Card>

      <Card>
        <SectionHeader num="02" title="Estructura por día" note="Domingo cerrado" />
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left font-heading text-xs uppercase tracking-wider text-ink-soft">
              <th className="py-1 font-semibold">Día</th>
              <th className="py-1 font-semibold">Entradas</th>
              <th className="py-1 font-semibold">Segundos</th>
            </tr>
          </thead>
          <tbody>
            {OPEN_DAYS.map((day) => (
              <tr key={day} className="border-b border-line">
                <td className="py-1.5 font-heading uppercase">{day}</td>
                {(["entradas", "segundos"] as const).map((k) => (
                  <td key={k} className="py-1.5 pr-2">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={20}
                      className="w-20"
                      aria-label={`${cap(k)} el ${day}`}
                      value={String(s.structure[day]?.[k] ?? 0)}
                      onChange={(e) => setStructure(day, k, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <SectionHeader num="03" title="Extras" note="Precio aparte" />
        <div className="mb-4 max-w-xs">
          <Label>Extras por día</Label>
          <Input type="number" inputMode="numeric" min={0} max={20} aria-label="Extras por día" {...num("extrasPerDay")} />
        </div>
        <Label>Lista de extras</Label>
        <ul className="mb-3">
          {extras.map((x, i) => (
            <li key={x.name} className="flex items-center gap-3 border-b border-line py-2">
              <span className="diamond" />
              <span className="flex-1">{x.name}</span>
              {x.id != null ? (
                <label className="flex items-center gap-1 text-xs uppercase text-ink-soft">
                  S/
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min={0}
                    className="w-20 py-1 text-sm"
                    aria-label={`Precio de ${x.name}`}
                    value={x.price}
                    onChange={(e) => setExtras((xs) => xs.map((y, j) => (j === i ? { ...y, price: e.target.value } : y)))}
                  />
                </label>
              ) : (
                <span className="text-xs text-red">no está en el catálogo</span>
              )}
              <Button type="button" variant="ghost" className="px-2 py-1 text-xs" aria-label={`Quitar ${x.name}`} onClick={() => setExtras((xs) => xs.filter((_, j) => j !== i))}>
                Quitar
              </Button>
            </li>
          ))}
        </ul>
        <DishPicker
          label="Agregar extra"
          placeholder="Agregar un extra del catálogo…"
          value={pick}
          onChange={setPick}
          course="extra"
          onPick={(d) => {
            setPick("");
            if (extras.some((x) => x.name === d.name)) return;
            setExtras((xs) => [...xs, { name: d.name, id: d.id, price: d.price?.toString() ?? "", originalPrice: d.price }]);
          }}
        />
        <p className="mt-1 text-xs text-ink-soft">Los precios se guardan en cada plato y se usan al armar el menú.</p>
      </Card>

      <Card>
        <SectionHeader num="04" title="Generación" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Hora de generar el menú de mañana</Label>
            <Input type="time" aria-label="Hora de generación" value={s.generateAt} onChange={(e) => setS((p) => ({ ...p, generateAt: e.target.value }))} />
          </div>
          <div>
            <Label>Platos nuevos por semana</Label>
            <Input type="number" inputMode="numeric" min={0} max={20} aria-label="Platos nuevos por semana" {...num("newDishesPerWeek")} />
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy && <Spinner />}
          Guardar ajustes
        </Button>
        {msg && (
          <span role="status" className={`text-sm ${msg.ok ? "text-[#2f7d32]" : "text-red"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </form>
  );
}
