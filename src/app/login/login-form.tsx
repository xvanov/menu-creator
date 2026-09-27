"use client";

import { useState } from "react";
import { Button, Card, Input, Label, SectionHeader } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }) });
    if (res.ok) window.location.href = next;
    else {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo entrar.");
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionHeader title="Entrar" />
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label>PIN</Label>
          <Input type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus />
        </div>
        {error && <p className="text-sm text-red">{error}</p>}
        <Button variant="primary" type="submit" disabled={busy || !pin}>
          {busy ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </Card>
  );
}
