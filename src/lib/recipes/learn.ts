/**
 * Learning from corrections (PRD §5.5): simple, explainable, no LLM.
 *
 * When someone confirms an edited shopping quantity, what they meant to have on hand is
 * `edited quantity + stock`. Compared with what the recipes asked for, that gives a ratio; each
 * recipe of that menu using the ingredient moves its per-portion quantity towards the ratio with
 * an exponential moving average, so one odd day can't wreck a recipe.
 */

export const DEFAULT_ALPHA = 0.3;
export const RATIO_MIN = 0.3;
export const RATIO_MAX = 3;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Ratio between what the person wants and what the recipes computed, for the recipe part only
 * (quantities coming from kitchen rules, like the side rice, are not recipe errors).
 * Null when there's nothing to learn (no recipe need, or no real change).
 */
export function correctionRatio(line: { quantity: number; inStock: number; needed: number; ruleNeeded?: number }): number | null {
  const rule = line.ruleNeeded ?? 0;
  const recipeNeeded = line.needed - rule;
  if (!(recipeNeeded > 0)) return null;
  const wanted = Math.max(0, line.quantity) + Math.max(0, line.inStock) - rule;
  const ratio = clamp(wanted / recipeNeeded, RATIO_MIN, RATIO_MAX);
  if (Math.abs(ratio - 1) < 0.02) return null;
  return ratio;
}

/** EMA towards `old × ratio`: new = old × (1 + α (ratio − 1)). */
export function emaUpdate(old: number, ratio: number, alpha = DEFAULT_ALPHA): number {
  const a = clamp(alpha, 0, 1);
  const r = clamp(ratio, RATIO_MIN, RATIO_MAX);
  return Math.round(old * (1 + a * (r - 1)) * 10000) / 10000;
}

/** Applies a ratio to one recipe item. Scales the per-portion part; items with only a fixed batch amount scale that. */
export function learnRecipeItem(
  item: { qtyPerPortion: number; fixedQty: number; corrections: number },
  ratio: number,
  alpha = DEFAULT_ALPHA,
): { qtyPerPortion: number; fixedQty: number; corrections: number; source: "learned" } {
  const perPortion = item.qtyPerPortion > 0;
  return {
    qtyPerPortion: perPortion ? emaUpdate(item.qtyPerPortion, ratio, alpha) : item.qtyPerPortion,
    fixedQty: perPortion ? item.fixedQty : emaUpdate(item.fixedQty, ratio, alpha),
    corrections: item.corrections + 1,
    source: "learned",
  };
}

/** Expected portions for a dish following what the owner sets (rounded EMA). */
export function learnPortions(current: number, observed: number, alpha = DEFAULT_ALPHA): number {
  return Math.max(1, Math.round(current + clamp(alpha, 0, 1) * (observed - current)));
}

/** Badge text for a recipe item's origin. */
export function sourceLabel(source: string, corrections = 0): string {
  if (source === "manual") return "manual";
  if (source === "learned") return `aprendido (${corrections} ${corrections === 1 ? "corrección" : "correcciones"})`;
  return "IA";
}
