"use client";

/**
 * React port of design/menu-del-dia.template.html (post format, 1080×1350). Pure: everything comes
 * from props. Inline styles on purpose, so the PNG export (html-to-image) matches the template exactly.
 */
import { forwardRef, useEffect, useState, type CSSProperties } from "react";

export interface PosterItem {
  name: string;
  price?: number | null;
}

export interface MenuPosterProps {
  dateLabel: string;
  menuPrice: number;
  entradas: PosterItem[];
  segundos: PosterItem[];
  extras: PosterItem[];
  /** Hide the banner block (gives the sections more room). */
  showBanner?: boolean;
}

export const POSTER_WIDTH = 1080;
export const POSTER_HEIGHT = 1350;
const BANNER_SRC = "/assets/banner.png";

const C = {
  page: "#FFF3D6",
  ink: "#3B1D0E",
  red: "#C4201A",
  redStrong: "#D7261E",
  orange: "#F08A12",
  yellow: "#FFC93C",
  gold: "#FFD04A",
  line: "rgba(90,45,20,.18)",
};
const heading = "var(--font-oswald), 'Oswald', 'Arial Narrow', sans-serif";
const body = "var(--font-barlow), 'Barlow', system-ui, sans-serif";

export const posterPrice = (n: number) => `S/ ${n.toFixed(2)}`;

/** "martes 29 de septiembre" (es-PE, like the template). */
export function posterDateLabel(date: string): string {
  return new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "long" })
    .format(new Date(`${date}T12:00:00`))
    .replace(",", "");
}

const capitalize = (s: string) => {
  const t = s.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Port of the template's `need(fs)` loop: the biggest item font size (20–38px) whose rows fit. */
export function fitFontSize(sections: { items: PosterItem[]; cols: number }[], showBanner = true): number {
  const avail = 710 + (showBanner ? 0 : 290);
  const padK = 0.28;
  const secs = sections.filter((s) => s.items.length);
  const need = (size: number) => {
    const pad = Math.round(size * padK);
    let tot = secs.length * 80 + (secs.length - 1) * 24;
    for (const { items, cols } of secs) {
      const colW = 968 / cols - 40;
      const cpl = Math.max(8, Math.floor(colW / (size * 0.5)));
      const lines = items.map((it) => Math.ceil((it.name.length + (it.price != null ? 9 : 0)) / cpl));
      for (let i = 0; i < items.length; i += cols) {
        const l = Math.max(...lines.slice(i, i + cols));
        tot += l * size * 1.15 + pad * 2 + 1;
      }
    }
    return tot;
  };
  let fs = 38;
  while (fs > 20 && need(fs) > avail - 16) fs--;
  return fs;
}

function Corners() {
  const base: CSSProperties = { position: "absolute", width: 10, height: 10, borderColor: C.ink, borderStyle: "solid", borderWidth: 0 };
  return (
    <>
      <i style={{ ...base, top: -5, left: -5, borderTopWidth: 2, borderLeftWidth: 2 }} />
      <i style={{ ...base, top: -5, right: -5, borderTopWidth: 2, borderRightWidth: 2 }} />
      <i style={{ ...base, bottom: -5, left: -5, borderBottomWidth: 2, borderLeftWidth: 2 }} />
      <i style={{ ...base, bottom: -5, right: -5, borderBottomWidth: 2, borderRightWidth: 2 }} />
    </>
  );
}

/** Typographic stand-in for assets/banner.png (same footprint), used until the real banner is added. */
function FallbackBanner() {
  const diamond: CSSProperties = { width: 14, height: 14, background: C.redStrong, transform: "rotate(45deg)", flex: "none" };
  return (
    <div
      style={{
        height: 246,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        fontFamily: heading,
        textTransform: "uppercase",
        color: C.ink,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 34, fontWeight: 600, letterSpacing: ".3em", color: C.red }}>
        <span style={diamond} />
        Restaurant Criollo
        <span style={diamond} />
      </div>
      <div style={{ fontSize: 108, fontWeight: 700, lineHeight: 0.9, letterSpacing: ".01em", whiteSpace: "nowrap" }}>La Sazón de Luis</div>
    </div>
  );
}

function useBannerAvailable() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setOk(img.naturalWidth > 0);
    img.onerror = () => setOk(false);
    img.src = BANNER_SRC;
  }, []);
  return ok;
}

export const MenuPoster = forwardRef<HTMLDivElement, MenuPosterProps>(function MenuPoster(
  { dateLabel, menuPrice, entradas, segundos, extras, showBanner = true },
  ref,
) {
  const bannerOk = useBannerAvailable();
  const sections = [
    { num: "01", title: "Entrada", note: "Elige una", items: entradas, cols: 2 },
    { num: "02", title: "Segundo", note: "Elige uno", items: segundos, cols: 1 },
    { num: "03", title: "Extras", note: "Precio aparte", items: extras, cols: 2 },
  ].filter((s) => s.items.length);
  const fs = fitFontSize(sections, showBanner);
  const rowPad = Math.round(fs * 0.28);

  return (
    <div
      ref={ref}
      style={{
        width: POSTER_WIDTH,
        height: POSTER_HEIGHT,
        boxSizing: "border-box",
        background: C.page,
        color: C.ink,
        fontFamily: body,
        padding: "44px 56px 36px",
        display: "flex",
        flexDirection: "column",
        gap: 28,
        overflow: "hidden",
      }}
    >
      {showBanner && (
        <div style={{ position: "relative", border: `2px solid ${C.orange}`, padding: 6, background: C.yellow, flex: "none" }}>
          <Corners />
          {bannerOk ? (
            // eslint-disable-next-line @next/next/no-img-element -- exported with html-to-image; must be a plain <img>
            <img src={BANNER_SRC} alt="Restaurant Criollo La Sazón de Luis" style={{ display: "block", width: "100%", height: "auto" }} />
          ) : (
            <FallbackBanner />
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "stretch", gap: 24, flex: "none" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
          <div style={{ fontFamily: heading, fontWeight: 600, fontSize: 30, letterSpacing: ".12em", textTransform: "uppercase", color: C.red }}>
            {dateLabel}
          </div>
          <div style={{ fontFamily: heading, fontWeight: 700, fontSize: 96, lineHeight: 0.9, textTransform: "uppercase", letterSpacing: "-.01em" }}>
            Menú del día
          </div>
        </div>
        <div
          style={{
            position: "relative",
            background: C.redStrong,
            color: C.page,
            padding: "18px 36px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            minWidth: 250,
          }}
        >
          <Corners />
          <div style={{ fontFamily: heading, fontSize: 24, letterSpacing: ".14em", textTransform: "uppercase", color: C.gold }}>Entrada + Segundo</div>
          <div style={{ fontFamily: heading, fontWeight: 700, fontSize: 88, lineHeight: 0.95, marginTop: 6, whiteSpace: "nowrap" }}>
            {posterPrice(menuPrice)}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 24, minHeight: 0, overflow: "hidden" }}>
        {sections.map((sec) => (
          <section key={sec.num} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 14, borderBottom: `3px solid ${C.orange}`, paddingBottom: 8 }}>
              <span style={{ fontFamily: heading, fontSize: 28, fontWeight: 600, color: C.orange }}>{sec.num}</span>
              <h2 style={{ margin: 0, fontFamily: heading, fontWeight: 700, fontSize: 48, lineHeight: 1, textTransform: "uppercase", letterSpacing: ".02em" }}>
                {sec.title}
              </h2>
              <span style={{ marginLeft: "auto", fontFamily: heading, fontSize: 24, letterSpacing: ".1em", textTransform: "uppercase", color: C.red }}>
                {sec.note}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: sec.cols === 2 ? "repeat(2, minmax(0,1fr))" : "minmax(0,1fr)" }}>
              {sec.items.map((it, i) => (
                <div
                  key={i}
                  style={{ display: "flex", alignItems: "baseline", gap: 16, padding: `${rowPad}px 4px`, borderBottom: `1px solid ${C.line}` }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      flex: "none",
                      background: C.orange,
                      border: `1.5px solid ${C.orange}`,
                      transform: "translateY(-4px) rotate(45deg)",
                    }}
                  />
                  <span style={{ flex: 1, fontSize: fs, fontWeight: 500, lineHeight: 1.15, textWrap: "pretty" }}>{capitalize(it.name)}</span>
                  {it.price != null && (
                    <span style={{ fontFamily: heading, fontWeight: 700, fontSize: fs, color: C.red, whiteSpace: "nowrap" }}>{posterPrice(it.price)}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: heading,
          fontSize: 26,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: C.red,
          flex: "none",
        }}
      >
        <span>La Sazón de Luis · Restaurant Criollo</span>
        <span style={{ color: C.ink, fontWeight: 600 }}>2do Piso · Stand 1148 – 1149</span>
      </div>
    </div>
  );
});
