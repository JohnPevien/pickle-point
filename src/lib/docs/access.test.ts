import { describe, expect, test } from "vitest";
import { getDocsAccessMode } from "./access";

describe("docs access policy", () => {
  test("keeps docs public for local development when WorkOS is not configured", () => {
    expect(getDocsAccessMode({ NODE_ENV: "development" })).toBe("public_local");
  });

  test("requires authentication when WorkOS is configured", () => {
    expect(
      getDocsAccessMode({
        NODE_ENV: "production",
        WORKOS_CLIENT_ID: "client_test",
        WORKOS_API_KEY: "sk_test",
        WORKOS_COOKIE_PASSWORD: "12345678901234567890123456789012",
        NEXT_PUBLIC_WORKOS_REDIRECT_URI: "https://app.example.com/callback",
      })
    ).toBe("authenticated");
  });

  test("hides docs in production when WorkOS is incomplete", () => {
    expect(getDocsAccessMode({ NODE_ENV: "production" })).toBe("unavailable");
  });
});
