/**
 * Clamp `value` (after `Math.trunc`) into [min, max].
 *
 * Non-finite inputs (NaN, +Infinity, -Infinity) are saturated to the
 * nearest bound rather than propagating. Without this guard, a
 * non-finite input is invisibly preserved by `Math.min`/`Math.max` and
 * reaches `.take()` or range math downstream — never the desired
 * outcome at a trust boundary.
 *   - +Infinity -> max
 *   - -Infinity -> min
 *   - NaN      -> min
 */
export function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  if (value === Number.POSITIVE_INFINITY) {
    return max;
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return min;
  }
  return Math.min(Math.max(Math.trunc(value), min), max);
}

/**
 * Clamp `value` (after `Math.trunc`) into [min, max], substituting a
 * bounded `fallback` when `value` is not a finite number (NaN, ±Infinity).
 *
 * Used at public-query boundaries so non-finite values can never leak
 * into `.take()`, range math, or slicing. The fallback itself is
 * trimmed into [min, max] so a misconfigured fallback cannot widen the
 * range either.
 */
export function finiteInt(
  value: number,
  min: number,
  max: number,
  fallback: number
): number {
  if (Number.isFinite(value)) {
    return clampInt(value, min, max);
  }
  return clampInt(fallback, min, max);
}