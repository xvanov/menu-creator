"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps an editor showing what is saved on the server. Next.js can restore an old copy of a page on back/forward
 * navigation (and phones restore tabs), which looks like lost edits. This re-reads on mount, on back/forward restore,
 * and when the tab or window becomes visible again. Skipped while `busy` (a save is in flight).
 */
export function useServerSync<T>(load: () => Promise<T>, apply: (data: T) => void, busy: boolean, deps: unknown[]) {
  const busyRef = useRef(busy);
  const fns = useRef({ load, apply });
  useEffect(() => {
    busyRef.current = busy;
    fns.current = { load, apply };
  });
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      if (busyRef.current || document.visibilityState !== "visible") return;
      try {
        const data = await fns.current.load();
        if (!cancelled && !busyRef.current) fns.current.apply(data);
      } catch {
        /* offline: keep what is on screen */
      }
    };
    void sync();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
