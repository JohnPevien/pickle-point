import { beforeEach, describe, expect, test, vi } from "vitest";

const authkitMocks = vi.hoisted(() => {
  const callbackHandler = vi.fn();
  const proxyHandler = vi.fn();

  return {
    callbackHandler,
    proxyHandler,
    authkitProxy: vi.fn(() => proxyHandler),
    getSignInUrl: vi.fn(),
    getSignUpUrl: vi.fn(),
    handleAuth: vi.fn(() => callbackHandler),
    refreshSession: vi.fn(),
    withAuth: vi.fn(),
  };
});

const docsSearchMocks = vi.hoisted(() => {
  const searchGet = vi.fn(() => Response.json({ ok: true }));

  return {
    searchGet,
    createFromSource: vi.fn(() => ({ GET: searchGet })),
  };
});

const navigationMocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => ({ kind: "redirect", url })),
}));

const nextHeadersMocks = vi.hoisted(() => ({
  headers: vi.fn(),
}));

const convexMocks = vi.hoisted(() => ({
  fetchQuery: vi.fn(),
}));

vi.mock("@workos-inc/authkit-nextjs", () => authkitMocks);
vi.mock("convex/nextjs", () => convexMocks);
vi.mock("fumadocs-core/search/server", () => docsSearchMocks);
vi.mock("@/lib/source", () => ({ source: {} }));
vi.mock("next/navigation", () => navigationMocks);
vi.mock("next/headers", () => nextHeadersMocks);

// Hoisted mock for `@/lib/convex/internal` so that any code path that
// imports `reconcile.ts` (which in turn imports the internal client)
// is intercepted even before this test file's body runs. The mock
// state lives on a `vi.hoisted` shared object so it survives
// `vi.resetModules()` — which clears module identity but preserves
// the hoisted reference.
const convexInternalShared = vi.hoisted(() => {
  type AnyFunction = (args: unknown) => Promise<unknown>;
  const resolvers: Record<string, AnyFunction> = {};
  const calls: string[] = [];
  return {
    resolvers,
    calls,
    invoke: async (path: string, args: unknown) => {
      calls.push(path);
      const fn = resolvers[path];
      if (!fn) {
        throw new Error(`No mock registered for convex internal endpoint ${path}`);
      }
      return await fn(args);
    },
  };
});

vi.mock("@/lib/convex/internal", () => ({
  invokeInternalAction: convexInternalShared.invoke,
}));

const workosEnvKeys = [
  "NODE_ENV",
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
  "WORKOS_COOKIE_PASSWORD",
  "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
] as const;

const originalWorkosEnv = Object.fromEntries(
  workosEnvKeys.map((key) => [key, process.env[key]])
);

const completeWorkosEnv = {
  NODE_ENV: "production",
  WORKOS_CLIENT_ID: "client_test",
  WORKOS_API_KEY: "sk_test",
  WORKOS_COOKIE_PASSWORD: "12345678901234567890123456789012",
  NEXT_PUBLIC_WORKOS_REDIRECT_URI: "https://app.example.com/callback",
};

function setWorkosEnv(env: Partial<Record<(typeof workosEnvKeys)[number], string | undefined>>) {
  for (const key of workosEnvKeys) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}

function restoreWorkosEnv() {
  for (const key of workosEnvKeys) {
    const value = originalWorkosEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

beforeEach(() => {
  vi.resetModules();

  authkitMocks.callbackHandler.mockReset();
  authkitMocks.proxyHandler.mockReset();
  authkitMocks.authkitProxy.mockReset();
  authkitMocks.authkitProxy.mockReturnValue(authkitMocks.proxyHandler);
  authkitMocks.getSignInUrl.mockReset();
  authkitMocks.getSignUpUrl.mockReset();
  authkitMocks.handleAuth.mockReset();
  authkitMocks.handleAuth.mockReturnValue(authkitMocks.callbackHandler);
  authkitMocks.refreshSession.mockReset();
  authkitMocks.withAuth.mockReset();
  docsSearchMocks.searchGet.mockReset();
  docsSearchMocks.searchGet.mockImplementation(() => Response.json({ ok: true }));
  docsSearchMocks.createFromSource.mockReset();
  docsSearchMocks.createFromSource.mockReturnValue({ GET: docsSearchMocks.searchGet });
  navigationMocks.redirect.mockReset();
  navigationMocks.redirect.mockImplementation((url: string) => ({ kind: "redirect", url }));
  nextHeadersMocks.headers.mockReset();
  nextHeadersMocks.headers.mockResolvedValue(new Headers());
  convexMocks.fetchQuery.mockReset();

  restoreWorkosEnv();
});

describe("AuthKit page routes", () => {
  test("redirects sign-in requests to the WorkOS authorization URL", async () => {
    authkitMocks.getSignInUrl.mockResolvedValue("https://workos.example.com/sign-in");

    const { GET } = await import("../../app/sign-in/route");
    const result = await GET(new Request("https://app.example.com/sign-in"));

    expect(authkitMocks.getSignInUrl).toHaveBeenCalledTimes(1);
    expect(navigationMocks.redirect).toHaveBeenCalledWith("https://workos.example.com/sign-in");
    expect(result).toEqual({ kind: "redirect", url: "https://workos.example.com/sign-in" });
  });

  test("preserves a local return path when starting sign-in", async () => {
    authkitMocks.getSignInUrl.mockResolvedValue("https://workos.example.com/sign-in");

    const { GET } = await import("../../app/sign-in/route");
    await GET(
      new Request(
        "https://app.example.com/sign-in?returnTo=%2Fpickle-point%2Fdashboard%3Ftab%3Dhistory"
      )
    );

    expect(authkitMocks.getSignInUrl).toHaveBeenCalledWith({
      returnTo: "/pickle-point/dashboard?tab=history",
    });
  });

  test("does not preserve an external return destination", async () => {
    authkitMocks.getSignInUrl.mockResolvedValue("https://workos.example.com/sign-in");

    const { GET } = await import("../../app/sign-in/route");
    await GET(
      new Request(
        "https://app.example.com/sign-in?returnTo=https%3A%2F%2Fevil.example.com%2Fsteal",
      ),
    );

    expect(authkitMocks.getSignInUrl).toHaveBeenCalledWith({});
  });

  test("redirects sign-up requests to the WorkOS authorization URL", async () => {
    authkitMocks.getSignUpUrl.mockResolvedValue("https://workos.example.com/sign-up");

    const { GET } = await import("../../app/sign-up/route");
    const result = await GET();

    expect(authkitMocks.getSignUpUrl).toHaveBeenCalledTimes(1);
    expect(navigationMocks.redirect).toHaveBeenCalledWith("https://workos.example.com/sign-up");
    expect(result).toEqual({ kind: "redirect", url: "https://workos.example.com/sign-up" });
  });

  test("registers the callback route through handleAuth", async () => {
    const { GET } = await import("../../app/callback/route");

    expect(authkitMocks.handleAuth).toHaveBeenCalledTimes(1);
    expect(GET).toBe(authkitMocks.callbackHandler);
  });
});

// -------------------------------------------------------------------------
// Task 2.3: login/callback membership reconciliation
// -------------------------------------------------------------------------

// Hoisted once: the verifier survives `vi.resetModules` because both
// reconcile.ts and the test reference this same shared reference.
const fakeJwtVerifier = vi.hoisted(() => {
  return async (accessToken: string, expectedSubject: string) => {
    const parts = accessToken.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    ) as Record<string, unknown>;
    if (typeof payload["sub"] !== "string" || payload["sub"].length === 0) {
      throw new Error("missing sub");
    }
    if (payload["sub"] !== expectedSubject) {
      throw new Error("sub mismatch");
    }
    const orgId =
      (payload["organization_id"] as string | undefined) ??
      (payload["org_id"] as string | undefined);
    const roles = payload["roles"];
    const role =
      Array.isArray(roles) && typeof roles[0] === "string"
        ? roles[0]
        : typeof roles === "string"
          ? roles
          : typeof payload["role"] === "string"
            ? payload["role"]
            : undefined;
    return {
      subject: payload["sub"],
      organizationId: orgId,
      role,
    };
  };
});

describe("callback reconciliation", () => {
  function encodeAccessToken(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${header}.${body}.signature`;
  }

  beforeEach(async () => {
    // The reconcile module's module-scoped override is reset by
    // vi.resetModules, so re-install the verifier on every test.
    const { __setAccessTokenVerifier } = await import("../auth/reconcile");
    __setAccessTokenVerifier(fakeJwtVerifier);
  });

  test("owner claims drive reconciliation against the fixed tenant", async () => {
    setWorkosEnv({ ...completeWorkosEnv, WORKOS_ORGANIZATION_ID: "org_pickle_point" });
    const convexInternalMocks = convexInternalShared;
    convexInternalMocks.calls.length = 0;
    convexInternalMocks.resolvers["/internal/reconcile-callback"] = vi.fn(async () => ({
      status: "reconciled",
    }));

    authkitMocks.callbackHandler.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "/dashboard" } })
    );

    const accessToken = encodeAccessToken({
      sub: "user_001",
      org_id: "org_pickle_point",
      role: "owner",
    });

    const { reconcileWorkosCallback } = await import("../auth/reconcile");
    const result = await reconcileWorkosCallback({
      user: {
        id: "user_001",
        email: "owner@picklepoint.example",
        firstName: "Ada",
        lastName: "Lovelace",
      },
      accessToken,
    });

    expect(convexInternalMocks.calls).toContain("/internal/reconcile-callback");
    expect(
      convexInternalMocks.resolvers["/internal/reconcile-callback"]
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workosUserId: "user_001",
        organizationId: "org_pickle_point",
        role: "owner",
      })
    );
    expect(result.ok).toBe(true);
  });

  test("ordinary player login (no organization claim) never invents an admin role", async () => {
    setWorkosEnv({ ...completeWorkosEnv, WORKOS_ORGANIZATION_ID: "org_pickle_point" });
    const convexInternalMocks = convexInternalShared;
    convexInternalMocks.calls.length = 0;
    convexInternalMocks.resolvers["/internal/reconcile-callback"] = vi.fn(async () => ({
      status: "reconciled",
    }));

    // Personal-account JWT — no organization claim.
    const accessToken = encodeAccessToken({ sub: "user_player" });
    const { reconcileWorkosCallback } = await import("../auth/reconcile");
    await reconcileWorkosCallback({
      user: {
        id: "user_player",
        email: "player@picklepoint.example",
      },
      accessToken,
    });

    const call =
      convexInternalMocks.resolvers["/internal/reconcile-callback"].mock.calls.at(-1)?.[0];
    expect(call).toBeDefined();
    expect(call.role).toBe("player");
    expect(call.organizationId).toBeUndefined();
  });

  test("JWT role claim is the authoritative source", async () => {
    setWorkosEnv({ ...completeWorkosEnv, WORKOS_ORGANIZATION_ID: "org_pickle_point" });
    const convexInternalMocks = convexInternalShared;
    convexInternalMocks.calls.length = 0;
    convexInternalMocks.resolvers["/internal/reconcile-callback"] = vi.fn(async () => ({
      status: "reconciled",
    }));

    // JWT carries role=owner; we trust that claim.
    const accessToken = encodeAccessToken({
      sub: "user_002",
      org_id: "org_pickle_point",
      role: "owner",
    });
    const { reconcileWorkosCallback } = await import("../auth/reconcile");
    await reconcileWorkosCallback({
      user: { id: "user_002", email: "owner2@picklepoint.example" },
      accessToken,
    });

    const call =
      convexInternalMocks.resolvers["/internal/reconcile-callback"].mock.calls.at(-1)?.[0];
    expect(call.role).toBe("owner");
  });

  test("JWT with wrong organization claim returns safe support route, no DB write", async () => {
    setWorkosEnv({ ...completeWorkosEnv, WORKOS_ORGANIZATION_ID: "org_pickle_point" });
    const convexInternalMocks = convexInternalShared;
    convexInternalMocks.calls.length = 0;

    const accessToken = encodeAccessToken({
      sub: "user_cross",
      org_id: "org_someone_else",
      role: "owner",
    });
    const { reconcileWorkosCallback } = await import("../auth/reconcile");
    const result = await reconcileWorkosCallback({
      user: { id: "user_cross", email: "cross@picklepoint.example" },
      accessToken,
    });

    expect(result.ok).toBe(false);
    expect(result.redirectTo).toMatch(/^\/support\/access/);
    expect(convexInternalMocks.calls).toHaveLength(0);
  });

  test("replay is idempotent and never errors when the user/membership already exists", async () => {
    setWorkosEnv({ ...completeWorkosEnv, WORKOS_ORGANIZATION_ID: "org_pickle_point" });
    const convexInternalMocks = convexInternalShared;
    convexInternalMocks.calls.length = 0;
    convexInternalMocks.resolvers["/internal/reconcile-callback"] = vi.fn(async () => ({
      status: "reconciled",
    }));

    const accessToken = encodeAccessToken({
      sub: "user_dup",
      org_id: "org_pickle_point",
      role: "game_master",
    });
    const { reconcileWorkosCallback } = await import("../auth/reconcile");
    const first = await reconcileWorkosCallback({
      user: { id: "user_dup", email: "dup@picklepoint.example" },
      accessToken,
    });
    const second = await reconcileWorkosCallback({
      user: { id: "user_dup", email: "dup@picklepoint.example" },
      accessToken,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(
      convexInternalMocks.resolvers["/internal/reconcile-callback"]
    ).toHaveBeenCalledTimes(2);
  });

  test("reconciliation failure returns a safe support route without leaking claims", async () => {
    setWorkosEnv({ ...completeWorkosEnv, WORKOS_ORGANIZATION_ID: "org_pickle_point" });
    const convexInternalMocks = convexInternalShared;
    convexInternalMocks.calls.length = 0;
    convexInternalMocks.resolvers["/internal/reconcile-callback"] = vi.fn(async () => {
      throw new Error("network down");
    });

    const accessToken = encodeAccessToken({
      sub: "user_fail",
      org_id: "org_pickle_point",
      role: "owner",
    });
    const { reconcileWorkosCallback } = await import("../auth/reconcile");
    const result = await reconcileWorkosCallback({
      user: { id: "user_fail", email: "fail@picklepoint.example" },
      accessToken,
    });

    expect(result.ok).toBe(false);
    expect(result.redirectTo).toMatch(/^\/support\/access/);
    expect(JSON.stringify(result)).not.toContain("owner");
    expect(JSON.stringify(result)).not.toContain("org_pickle_point");
  });
});

describe("public workspace route authentication", () => {
  test("sends a logged-out user through the sign-in route without asking AuthKit to redirect during render", async () => {
    setWorkosEnv(completeWorkosEnv);
    authkitMocks.withAuth.mockImplementation(async (options?: { ensureSignedIn?: boolean }) => {
      if (options?.ensureSignedIn) {
        throw new Error("Cookies can only be modified in a Server Action or Route Handler.");
      }

      return { user: null };
    });
    nextHeadersMocks.headers.mockResolvedValue(
      new Headers({ "x-url": "https://app.example.com/pickle-point/dashboard?tab=history" }),
    );
    navigationMocks.redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });

    const { requireWorkosAuth } = await import("../auth/server");

    await expect(requireWorkosAuth()).rejects.toThrow("NEXT_REDIRECT");
    expect(authkitMocks.withAuth).toHaveBeenCalledWith();
    expect(navigationMocks.redirect).toHaveBeenCalledWith(
      "/sign-in?returnTo=%2Fpickle-point%2Fdashboard%3Ftab%3Dhistory",
    );
  });
});

describe("AuthKit proxy route", () => {
  test("keeps the proxy matcher broad while excluding static Next assets", async () => {
    const { config } = await import("../../proxy");

    expect(config.matcher).toEqual(["/((?!_next/static|_next/image|favicon.ico).*)"]);
  });

  test("creates the AuthKit proxy once at module load and reuses it", async () => {
    setWorkosEnv(completeWorkosEnv);
    authkitMocks.proxyHandler.mockReturnValue(new Response("delegated", { status: 202 }));

    const { default: proxy } = await import("../../proxy");
    proxy(new Request("https://app.example.com/admin") as never, {} as never);
    proxy(new Request("https://app.example.com/admin/players") as never, {} as never);

    expect(authkitMocks.authkitProxy).toHaveBeenCalledTimes(1);
    expect(authkitMocks.proxyHandler).toHaveBeenCalledTimes(2);
  });

  test("bypasses WorkOS locally when the auth environment is incomplete", async () => {
    setWorkosEnv({ NODE_ENV: "development" });

    const { default: proxy } = await import("../../proxy");
    const response = proxy(new Request("https://app.example.com/admin") as never, {} as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(authkitMocks.proxyHandler).not.toHaveBeenCalled();
  });

  test("returns a configuration error in production when WorkOS is incomplete", async () => {
    setWorkosEnv({ NODE_ENV: "production" });

    const { default: proxy } = await import("../../proxy");
    const response = proxy(new Request("https://app.example.com/admin") as never, {} as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "WorkOS AuthKit is not configured.",
    });
    expect(authkitMocks.proxyHandler).not.toHaveBeenCalled();
  });

  test("delegates to authkitProxy when the WorkOS environment is complete", async () => {
    setWorkosEnv(completeWorkosEnv);
    authkitMocks.proxyHandler.mockReturnValue(new Response("delegated", { status: 202 }));

    const request = new Request("https://app.example.com/admin");
    const event = {};
    const { default: proxy } = await import("../../proxy");
    const response = proxy(request as never, event as never);

    expect(authkitMocks.authkitProxy).toHaveBeenCalledTimes(1);
    expect(authkitMocks.proxyHandler).toHaveBeenCalledWith(request, event);
    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe("delegated");
  });
});

describe("docs search access route", () => {
  test("returns 404 in production when docs auth cannot be configured", async () => {
    setWorkosEnv({ NODE_ENV: "production" });

    const { GET } = await import("../../app/api/search/route");
    const response = await GET(new Request("https://app.example.com/api/search?q=open"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Docs are unavailable." });
    expect(authkitMocks.withAuth).not.toHaveBeenCalled();
    expect(docsSearchMocks.searchGet).not.toHaveBeenCalled();
  });

  test("requires WorkOS auth before serving production docs search", async () => {
    setWorkosEnv(completeWorkosEnv);
    authkitMocks.withAuth.mockResolvedValue({ user: { id: "user_123" } });

    const request = new Request("https://app.example.com/api/search?q=open");
    const { GET } = await import("../../app/api/search/route");
    const response = await GET(request);

    expect(authkitMocks.withAuth).toHaveBeenCalledWith({ ensureSignedIn: true });
    expect(docsSearchMocks.searchGet).toHaveBeenCalledWith(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});

describe("auth session route", () => {
  test("reports authenticated when WorkOS returns a user", async () => {
    authkitMocks.withAuth.mockResolvedValue({ user: { id: "user_123" } });

    const { GET } = await import("../../app/api/auth/session/route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authenticated: true });
  });

  test("reports unauthenticated when WorkOS has no user or throws", async () => {
    authkitMocks.withAuth.mockResolvedValueOnce({ user: null });

    const { GET } = await import("../../app/api/auth/session/route");
    const emptySessionResponse = await GET();

    expect(emptySessionResponse.status).toBe(200);
    await expect(emptySessionResponse.json()).resolves.toEqual({ authenticated: false });

    authkitMocks.withAuth.mockRejectedValueOnce(new Error("session unavailable"));
    const errorResponse = await GET();

    expect(errorResponse.status).toBe(200);
    await expect(errorResponse.json()).resolves.toEqual({ authenticated: false });
  });
});

describe("auth token route", () => {
  test("returns an access token from the current session", async () => {
    authkitMocks.withAuth.mockResolvedValue({
      user: { id: "user_123" },
      accessToken: "token_123",
    });

    const { GET } = await import("../../app/api/auth/token/route");
    const response = await GET(new Request("https://app.example.com/api/auth/token"));

    expect(authkitMocks.withAuth).toHaveBeenCalledTimes(1);
    expect(authkitMocks.refreshSession).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accessToken: "token_123" });
  });

  test("refreshes the session when refresh=1 is requested", async () => {
    authkitMocks.refreshSession.mockResolvedValue({
      user: { id: "user_123" },
      accessToken: "fresh_token",
    });

    const { GET } = await import("../../app/api/auth/token/route");
    const response = await GET(new Request("https://app.example.com/api/auth/token?refresh=1"));

    expect(authkitMocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(authkitMocks.withAuth).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accessToken: "fresh_token" });
  });

  test("returns 401 when a refreshed session is missing a user or access token", async () => {
    authkitMocks.refreshSession.mockResolvedValueOnce({
      user: null,
      accessToken: "fresh_token",
    });

    const { GET } = await import("../../app/api/auth/token/route");
    const missingUserResponse = await GET(new Request("https://app.example.com/api/auth/token?refresh=1"));

    expect(missingUserResponse.status).toBe(401);
    await expect(missingUserResponse.json()).resolves.toEqual({ accessToken: null });

    authkitMocks.refreshSession.mockResolvedValueOnce({
      user: { id: "user_123" },
      accessToken: null,
    });
    const missingTokenResponse = await GET(new Request("https://app.example.com/api/auth/token?refresh=1"));

    expect(missingTokenResponse.status).toBe(401);
    await expect(missingTokenResponse.json()).resolves.toEqual({ accessToken: null });
  });

  test("returns 401 when the session is missing a user or access token", async () => {
    authkitMocks.withAuth.mockResolvedValueOnce({ user: null, accessToken: "token_123" });

    const { GET } = await import("../../app/api/auth/token/route");
    const missingUserResponse = await GET(new Request("https://app.example.com/api/auth/token"));

    expect(missingUserResponse.status).toBe(401);
    await expect(missingUserResponse.json()).resolves.toEqual({ accessToken: null });

    authkitMocks.withAuth.mockResolvedValueOnce({ user: { id: "user_123" }, accessToken: null });
    const missingTokenResponse = await GET(new Request("https://app.example.com/api/auth/token"));

    expect(missingTokenResponse.status).toBe(401);
    await expect(missingTokenResponse.json()).resolves.toEqual({ accessToken: null });
  });

  test("returns 401 when WorkOS session lookup fails", async () => {
    authkitMocks.withAuth.mockRejectedValue(new Error("session unavailable"));

    const { GET } = await import("../../app/api/auth/token/route");
    const response = await GET(new Request("https://app.example.com/api/auth/token"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ accessToken: null });
  });
});
