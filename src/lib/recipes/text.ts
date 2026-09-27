/** Lowercase, no accents, single spaces: for matching dish/ingredient names typed by people or the LLM. */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** First letter uppercase, rest as typed ("ají amarillo" → "Ají amarillo"). */
export function capitalize(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.charAt(0).toLocaleUpperCase("es") + t.slice(1);
}

/** Finds an item by normalized name, also tolerating a trailing plural "s"/"es". */
export function findByName<T extends { name: string }>(list: T[], name: string): T | undefined {
  const n = norm(name);
  const exact = list.find((x) => norm(x.name) === n);
  if (exact) return exact;
  const sing = (s: string) => s.replace(/(es|s)$/, "");
  return list.find((x) => sing(norm(x.name)) === sing(n));
}
