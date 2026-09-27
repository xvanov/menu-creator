"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { MenuPoster, POSTER_HEIGHT, POSTER_WIDTH, type MenuPosterProps } from "./menu-poster";

/** Renders the full-size poster node to a PNG and downloads it. */
export async function downloadPosterPng(node: HTMLElement, filename: string) {
  const { toPng } = await import("html-to-image");
  await document.fonts.ready;
  const opts = { width: POSTER_WIDTH, height: POSTER_HEIGHT, pixelRatio: 1, cacheBust: true, style: { transform: "none", margin: "0" } };
  await toPng(node, opts); // first pass warms up font/image embedding (Safari often drops them otherwise)
  const url = await toPng(node, opts);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

/** Poster scaled to the container width, with a "Descargar PNG" button that exports it at 1080×1350. */
export function PosterPreview({ filename, ...poster }: MenuPosterProps & { filename: string }) {
  const box = useRef<HTMLDivElement>(null);
  const node = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / POSTER_WIDTH));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  async function download() {
    if (!node.current) return;
    setBusy(true);
    setError(null);
    try {
      await downloadPosterPng(node.current, filename);
    } catch (e) {
      setError(`No se pudo generar la imagen: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div ref={box} className="relative w-full overflow-hidden shadow-[0_2px_10px_rgba(59,29,14,.18)]" style={{ height: POSTER_HEIGHT * scale }}>
        <div style={{ position: "absolute", top: 0, left: 0, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <MenuPoster ref={node} {...poster} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={download} disabled={busy}>
          {busy ? <Spinner /> : null}
          Descargar PNG
        </Button>
        {error && <span className="text-sm text-red">{error}</span>}
      </div>
    </div>
  );
}
