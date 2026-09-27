import type { Metadata } from "next";
import Link from "next/link";
import { Barlow, Oswald } from "next/font/google";
import { AiStatus } from "@/components/ai-status";
import { Nav } from "@/components/nav";
import "./globals.css";

const oswald = Oswald({ variable: "--font-oswald", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const barlow = Barlow({ variable: "--font-barlow", subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "Menú del día · La Sazón de Luis",
  description: "Arma el menú del día, las compras y el diseño.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${oswald.variable} ${barlow.variable}`}>
      <body className="min-h-dvh antialiased">
        <header className="bg-red-strong text-paper">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="font-heading text-xl font-bold uppercase tracking-wide text-paper no-underline">
              La Sazón de Luis
              <span className="ml-2 text-sm font-medium tracking-[.14em] text-gold">Restaurant Criollo</span>
            </Link>
            <AiStatus />
          </div>
          <Nav />
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
