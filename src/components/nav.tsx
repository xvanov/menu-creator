"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/", label: "Menú", match: (p: string) => p === "/" || p.startsWith("/menu") },
  { href: "/compras", label: "Compras", match: (p: string) => p.startsWith("/compras") },
  { href: "/almacen", label: "Almacén", match: (p: string) => p.startsWith("/almacen") },
  { href: "/platos", label: "Platos", match: (p: string) => p.startsWith("/platos") },
  { href: "/reglas", label: "Reglas", match: (p: string) => p.startsWith("/reglas") },
  { href: "/historial", label: "Historial", match: (p: string) => p.startsWith("/historial") },
  { href: "/ajustes", label: "Ajustes", match: (p: string) => p.startsWith("/ajustes") },
];

/** "Menú" reopens the menu edited last (within 12 h) on this device instead of always tomorrow. */
function lastMenuHref(): string | null {
  try {
    const last = JSON.parse(localStorage.getItem("lastMenu") ?? "null") as { date: string; at: number } | null;
    return last && Date.now() - last.at < 12 * 3_600_000 ? `/menu/${last.date}` : null;
  } catch {
    return null;
  }
}

export function Nav() {
  const path = usePathname();
  const router = useRouter();
  return (
    <nav className="bg-yellow">
      <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            onClick={(e) => {
              const last = l.href === "/" && lastMenuHref();
              if (last) {
                e.preventDefault();
                router.push(last);
              }
            }}
            className={`whitespace-nowrap px-3 py-2 font-heading text-sm font-semibold uppercase tracking-wider no-underline ${
              l.match(path) ? "bg-paper text-red" : "text-ink hover:text-red"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
