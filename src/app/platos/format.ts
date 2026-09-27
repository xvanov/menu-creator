/** "29/09/2026" from "2026-09-29". */
export const dmy = (date: string | null | undefined) => (date ? date.split("-").reverse().join("/") : "—");

export const normalizeText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export const COURSE_LABELS = { entrada: "Entrada", segundo: "Segundo", extra: "Extra" } as const;
export const STATUS_LABELS = { activo: "Activo", nuevo: "Nuevo", archivado: "Archivado" } as const;
