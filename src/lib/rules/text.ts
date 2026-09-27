/** Case/accent/punctuation-insensitive key for matching dish names ("Ají de Gallina" == "aji de gallina"). */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
