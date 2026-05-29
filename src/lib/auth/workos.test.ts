import { describe, expect, test } from "vitest";
import { hasWorkosAuthConfig, workosAuthRoutes } from "./workos";

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
