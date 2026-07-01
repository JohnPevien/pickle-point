import { describe, expect, test } from "vitest";
import { clampInt, finiteInt } from "./num";

describe("finiteInt", () => {
  test("returns finite integers unchanged when within bounds", () => {
    expect(finiteInt(50, 1, 100, 25)).toBe(50);
    expect(finiteInt(42, 1, 100, 25)).toBe(42);
    expect(finiteInt(-5, -10, 10, 0)).toBe(-5);
  });

  test("falls back to fallback for NaN", () => {
    expect(finiteInt(Number.NaN, 1, 100, 25)).toBe(25);
  });

  test("falls back to fallback for +Infinity and -Infinity", () => {
    expect(finiteInt(Number.POSITIVE_INFINITY, 1, 100, 25)).toBe(25);
    expect(finiteInt(Number.NEGATIVE_INFINITY, 1, 100, 25)).toBe(25);
  });

  test("clamps below min", () => {
    expect(finiteInt(-50, 1, 100, 25)).toBe(1);
    expect(finiteInt(0, 5, 100, 25)).toBe(5);
  });

  test("clamps above max", () => {
    expect(finiteInt(500, 1, 100, 25)).toBe(100);
  });

  test("truncates fractional values within bounds", () => {
    expect(finiteInt(3.9, 1, 100, 25)).toBe(3);
    expect(finiteInt(-3.9, -10, 10, 0)).toBe(-3);
  });

  test("non-finite fallback is itself clamped to [min, max]", () => {
    expect(finiteInt(Number.NaN, 10, 20, 1000)).toBe(20);
    expect(finiteInt(Number.NaN, 10, 20, -100)).toBe(10);
  });
});

describe("clampInt", () => {
  test("returns finite integers unchanged", () => {
    expect(clampInt(42, 1, 100)).toBe(42);
  });

  test("clamps NaN to min (regression: NaN must not propagate)", () => {
    // Math.min/max with NaN propagates NaN. We want a safe integer instead.
    expect(Number.isNaN(clampInt(Number.NaN, 1, 100))).toBe(false);
  });

  test("clamps +Infinity to max and -Infinity to min", () => {
    expect(clampInt(Number.POSITIVE_INFINITY, 1, 100)).toBe(100);
    expect(clampInt(Number.NEGATIVE_INFINITY, 1, 100)).toBe(1);
  });

  test("clamps out-of-range finite values", () => {
    expect(clampInt(-10, 1, 100)).toBe(1);
    expect(clampInt(200, 1, 100)).toBe(100);
  });

  test("truncates fractions before clamping", () => {
    expect(clampInt(3.9, 1, 100)).toBe(3);
    expect(clampInt(-3.9, -10, 10)).toBe(-3);
  });
});