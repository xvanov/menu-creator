import { redirect } from "next/navigation";
import { tomorrow } from "@/lib/menus";

export const dynamic = "force-dynamic";

export default function ComprasIndex() {
  redirect(`/compras/${tomorrow()}`);
}
