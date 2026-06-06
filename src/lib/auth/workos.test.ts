import { describe, expect, test } from "vitest";
import { canBypassWorkosAuth, hasWorkosAuthConfig, workosAuthRoutes } from "./workos";

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

  test("requires every WorkOS environment variable", () => {
    for (const key of Object.keys(completeEnv) as (keyof typeof completeEnv)[]) {
      expect(
        hasWorkosAuthConfig({
          ...completeEnv,
          [key]: undefined,
        }),
      ).toBe(false);
    }
  });

  test("rejects missing or weak cookie configuration", () => {
    expect(
      hasWorkosAuthConfig({
        ...completeEnv,
        WORKOS_COOKIE_PASSWORD: "too-short",
      }),
    ).toBe(false);
    expect(
      hasWorkosAuthConfig({
        ...completeEnv,
        WORKOS_COOKIE_PASSWORD: "1234567890123456789012345678901",
      }),
    ).toBe(false);
    expect(
      hasWorkosAuthConfig({
        ...completeEnv,
        WORKOS_COOKIE_PASSWORD: "12345678901234567890123456789012",
      }),
    ).toBe(true);
  });

  test("only allows missing AuthKit config to be bypassed outside production", () => {
    expect(canBypassWorkosAuth({ NODE_ENV: "development" })).toBe(true);
    expect(canBypassWorkosAuth({ NODE_ENV: "test" })).toBe(true);
    expect(canBypassWorkosAuth({})).toBe(true);
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
});
