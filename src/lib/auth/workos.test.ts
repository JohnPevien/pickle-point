import { describe, expect, test } from "vitest";
import { canBypassWorkosAuth, hasWorkosAuthConfig, requiresWorkosAuth, workosAuthRoutes } from "./workos";

describe("WorkOS AuthKit configuration", () => {
  const completeEnv = {
    WORKOS_CLIENT_ID: "client_test",
    WORKOS_API_KEY: "sk_test",
    WORKOS_COOKIE_PASSWORD: "12345678901234567890123456789012",
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: "http://localhost:3000/callback",
  };

  test("recognizes a complete local AuthKit configuration", () => {
    expect(hasWorkosAuthConfig(completeEnv)).toBe(true);
  });

  test("rejects missing or weak cookie configuration", () => {
    expect(
      hasWorkosAuthConfig({
        ...completeEnv,
        WORKOS_COOKIE_PASSWORD: "too-short",
      }),
    ).toBe(false);
  });

  test("only allows missing AuthKit config to be bypassed outside production", () => {
    expect(canBypassWorkosAuth({ NODE_ENV: "development" })).toBe(true);
    expect(canBypassWorkosAuth({ NODE_ENV: "production" })).toBe(false);
    expect(canBypassWorkosAuth({ ...completeEnv, NODE_ENV: "development" })).toBe(false);
  });

  test("keeps the AuthKit route contract explicit", () => {
    expect(workosAuthRoutes).toEqual({
      callback: "/callback",
      signIn: "/sign-in",
      signUp: "/sign-up",
      session: "/api/auth/session",
      token: "/api/auth/token",
    });
  });

  test("identifies routes that require WorkOS configuration", () => {
    expect(requiresWorkosAuth("/tenant-id/admin/open-play")).toBe(true);
    expect(requiresWorkosAuth("/callback")).toBe(true);
    expect(requiresWorkosAuth("/api/auth/token")).toBe(true);
    expect(requiresWorkosAuth("/tenant-id/register")).toBe(false);
    expect(requiresWorkosAuth("/tenant-id/open-play/session-id")).toBe(false);
  });
});
