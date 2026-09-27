export type Course = "entrada" | "segundo" | "extra";

export const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const ENTRADA_CATEGORIES = ["sopa", "crema", "ensalada", "fritura", "fria", "criolla"] as const;
export const SEGUNDO_CATEGORIES = ["menestra", "guiso", "verduras", "frio", "fritura", "arroz", "pasta", "saltado"] as const;
export const TAGS = ["legumbre", "pesado", "frito", "picante", "cerdo", "pescado", "menudencia"] as const;

/** Selects menu items. All given fields must match; list fields match if any value matches. */
export interface DishFilter {
  course?: Course;
  categories?: string[];
  tagsAny?: string[];
  names?: string[];
}

/**
 * Rule params, discriminated by `type`. Every rule is data in the `rules` table so the owner can
 * add / edit / delete / disable them from the UI.
 * - count_per_day: number of items matching `filter` must be within [min, max]; `weekdayOverrides` replaces min/max on given days.
 * - count_per_week: items matching `filter` across the Mon–Sat week containing the date (other days' menus + this one) <= max.
 * - forbid_pair: an item matching `a` and an item matching `b` can't be on the same menu.
 * - no_repeat: a dish can't appear again within `days` days, except `exceptNames`.
 * - text: free-text rule in Spanish, enforced by the LLM when generating (and shown as a reminder).
 */
export type RuleParams =
  | { type: "count_per_day"; filter: DishFilter; min?: number; max?: number; weekdayOverrides?: Partial<Record<Weekday, { min?: number; max?: number }>> }
  | { type: "count_per_week"; filter: DishFilter; max: number }
  | { type: "forbid_pair"; a: DishFilter; b: DishFilter }
  | { type: "no_repeat"; days: number; exceptNames?: string[] }
  | { type: "text"; text: string };

export interface Settings {
  menuPrice: number; // entrada + segundo, fixed
  structure: Record<Weekday, { entradas: number; segundos: number }>;
  defaultPortions: number; // per dish per day
  extraPortions: number;
  extrasPerDay: number;
  defaultExtras: string[]; // dish names
  generateAt: string; // "17:00", evening before
  newDishesPerWeek: number;
  /** Shopping: white rice served as a side (arroz blanco de acompañamiento), from the kitchen chat. */
  sideRice?: SideRiceRule;
  /** Shopping: EMA weight when a confirmed shopping edit updates recipe quantities (0–1). */
  learningAlpha?: number;
}

/**
 * "Si hay tallarín/arroz con pollo/chaufa/jardinera solo 3 kg de arroz blanco, si no 5 kg" — for `basePortions`
 * segundo portions; scaled linearly with the day's segundo portions. Recipes don't include the side rice.
 */
export interface SideRiceRule {
  enabled: boolean;
  ingredient: string; // ingredient name, e.g. "Arroz"
  withRiceDishKg: number;
  defaultKg: number;
  basePortions: number;
  triggers: string[]; // dish-name fragments that lower the side rice
}

export const DEFAULT_SETTINGS: Settings = {
  menuPrice: 13,
  structure: {
    lunes: { entradas: 3, segundos: 4 },
    martes: { entradas: 3, segundos: 4 },
    miércoles: { entradas: 3, segundos: 4 },
    jueves: { entradas: 3, segundos: 4 },
    viernes: { entradas: 3, segundos: 4 },
    sábado: { entradas: 3, segundos: 4 },
    domingo: { entradas: 3, segundos: 4 },
  },
  defaultPortions: 20,
  extraPortions: 10,
  extrasPerDay: 3,
  defaultExtras: ["Trucha frita", "Arroz chaufa", "Pollo broaster", "Lomo saltado", "Churrasco a lo pobre"],
  generateAt: "17:00",
  newDishesPerWeek: 1,
  sideRice: {
    enabled: true,
    ingredient: "Arroz",
    withRiceDishKg: 3,
    defaultKg: 5,
    basePortions: 80,
    triggers: ["tallarín", "tallarines", "arroz con pollo", "chaufa", "jardinera"],
  },
  learningAlpha: 0.3,
};

export function weekdayOf(date: string): Weekday {
  const d = new Date(`${date}T12:00:00`);
  return WEEKDAYS[(d.getDay() + 6) % 7];
}

export interface MenuItemView {
  id: number;
  menuId: number;
  dishId: number | null;
  name: string;
  course: Course;
  price: number | null;
  portions: number | null;
  position: number;
  pinned: boolean;
  reason: string | null;
  dish: { id: number; name: string; course: Course; category: string; tags: string[]; status: string } | null;
}

/** Shape returned by GET /api/menus/[date] and every menu mutation route. */
export interface MenuPayload {
  date: string;
  weekday: Weekday;
  menu: {
    id: number;
    date: string;
    status: "borrador" | "publicado";
    menuPrice: number;
    source: string;
    reasoning: string | null;
    warnings: string[];
  } | null;
  items: MenuItemView[];
}

export const UNITS =["kg", "g", "l", "ml", "unidad", "paquete", "bolsa", "tarro", "botella", "atado", "presa", "caja", "lata"] as const;
