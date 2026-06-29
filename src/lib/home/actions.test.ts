import { describe, expect, test } from "vitest";
import { HOME_ACTIONS, getHomeAction } from "./actions";

describe("home actions", () => {
  test("exposes the MVP entry routes in display order", () => {
    expect(HOME_ACTIONS.map((action) => action.href)).toEqual([
      "/sign-in",
      "/sign-up",
      "/docs",
    ]);
  });

  test("marks sign-in as the primary action", () => {
    expect(getHomeAction("sign-in")).toMatchObject({
      label: "Sign in",
      href: "/sign-in",
      variant: "primary",
    });
  });

  test("returns null for an unknown action", () => {
    expect(getHomeAction("unknown")).toBeNull();
  });
});
