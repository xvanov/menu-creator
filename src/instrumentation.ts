/**
 * Local scheduler: while the Node server is up, pings the cron route every few minutes. The route
 * itself checks settings.generateAt (Lima time), skips Sundays and never overwrites an existing
 * menu, so extra pings are harmless. On Vercel, Vercel Cron calls /api/cron/generate instead.
 * Going through HTTP keeps the generator inside the normal route runtime (server-only modules).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL || process.env.DISABLE_MENU_SCHEDULER) return;
  const g = globalThis as unknown as { __menuScheduler?: ReturnType<typeof setInterval> };
  if (g.__menuScheduler) return; // dev server hot reloads

  const base = process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
  const tick = async () => {
    try {
      const headers: Record<string, string> = process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {};
      const res = await fetch(`${base}/api/cron/generate?auto=1`, { headers });
      const body = (await res.json().catch(() => null)) as { status?: string; date?: string; note?: string } | null;
      if (body?.status === "generated") console.log(`[scheduler] menú del ${body.date} generado${body.note ? ` (${body.note})` : ""}`);
    } catch (e) {
      console.warn("[scheduler] no se pudo llamar a /api/cron/generate:", (e as Error).message);
    }
  };
  g.__menuScheduler = setInterval(tick, 5 * 60_000);
  setTimeout(tick, 30_000);
}
