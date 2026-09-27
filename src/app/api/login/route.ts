import { PIN_COOKIE, pinRequired, pinToken } from "@/lib/auth";

export async function POST(req: Request) {
  const { pin } = (await req.json().catch(() => ({}))) as { pin?: string };
  if (pinRequired() && pinToken(String(pin ?? "")) !== pinToken()) return Response.json({ error: "PIN incorrecto." }, { status: 401 });
  const res = Response.json({ ok: true });
  res.headers.append(
    "set-cookie",
    `${PIN_COOKIE}=${pinToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 180}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
  return res;
}
