import { describe, expect, test } from "vitest";
import { HOME_ACTIONS, getHomeAction } from "./actions";

describe("home actions", () => {
  test("exposes the MVP entry routes in display order", () => {
    expect(HOME_ACTIONS.map((action) => action.href)).toEqual([
      "/setup",
      "/sign-in",
      "/docs",
    ]);
  });

  test("marks setup as the primary action", () => {
    expect(getHomeAction("setup")).toMatchObject({
      label: "Create workspace",
      href: "/setup",
      variant: "primary",
    });
  });

  test("returns null for an unknown action", () => {
    expect(getHomeAction("unknown")).toBeNull();
  });
});
