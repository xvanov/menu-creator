import { redirect } from "next/navigation";
import { tomorrow } from "@/lib/menus";

export const dynamic = "force-dynamic";

export default function Home() {
  redirect(`/menu/${tomorrow()}`);
}
