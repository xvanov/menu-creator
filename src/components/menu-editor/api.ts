/** fetch + JSON with the server's `{ error }` message surfaced as the thrown Error's message. */
export async function api<T>(url: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init?.signal,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Error ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Shape of GET /api/dishes rows used by pickers. */
export interface DishOption {
  id: number;
  name: string;
  course: "entrada" | "segundo" | "extra";
  category: string;
  status: string;
  price: number | null;
  defaultPortions: number | null;
}
