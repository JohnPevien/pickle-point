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
  fetchAction: vi.fn(),
}));

vi.mock("@workos-inc/authkit-nextjs", () => authkitMocks);
vi.mock("convex/nextjs", () => convexMocks);
vi.mock("fumadocs-core/search/server", () => docsSearchMocks);
vi.mock("@/lib/source", () => ({ source: {} }));
vi.mock("next/navigation", () => navigationMocks);
vi.mock("next/headers", () => nextHeadersMocks);
// The generated `api` object is imported by the callback route. We do
// not exercise Convex here — the route only passes the function
// reference through to the mocked `fetchAction`. Stub it as `anyApi`.
vi.mock("../../../convex/_generated/api", () => ({
  api: {
    callback: { reconcileWorkosCallback: "api.callback.reconcileWorkosCallback" },
  },
}));

// `convexMocks.fetchAction` is reset and re-stubbed per test inside the
// callback reconciliation suite. The mock survives `vi.resetModules()`
// because it lives on the hoisted `convexMocks` object.

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
  convexMocks.fetchAction.mockReset();

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
// Task 2.3: login/callback membership reconciliation (route-level)
// -------------------------------------------------------------------------
//
// These tests exercise the AuthKit callback route's `onSuccess` and
// `onError` behavior, not a reconcile helper. The route forwards the
// access token to `api.callback.reconcileWorkosCallback` via Convex's
// authenticated `fetchAction`. Convex validates the JWT and derives the
// identity server-side, so the route passes NO user/org/tenant/role
// arguments — only the token. A non-`ok` result throws, routing the
// user to `onError` → `/support/access`.

describe("callback reconciliation", () => {
  // The route imports `handleAuth` and calls its returned handler. To
  // exercise onSuccess/onError we capture the options passed to
  // `handleAuth`, then drive the real handler with a fake Request so
  // AuthKit's own OAuth/PKCE code is bypassed.
  function captureHandleAuthOptions(): {
    getOptions: () => {
      onSuccess?: (data: { accessToken: string }) => Promise<void>;
      onError?: (params: { request: Request; error?: unknown }) => Response | Promise<Response>;
    };
  } {
    const captured: {
      onSuccess?: (data: { accessToken: string }) => Promise<void>;
      onError?: (params: { request: Request; error?: unknown }) => Response | Promise<Response>;
    } = {};
    // Cast around vitest's mock-typing variance: `handleAuth` is mocked
    // as a zero-arg `vi.fn`, but the real AuthKit `handleAuth` takes an
    // options object. We capture that object to drive onSuccess/onError.
    const mockHandleAuth = authkitMocks.handleAuth as unknown as {
      mockImplementation: (impl: (options: typeof captured) => unknown) => void;
    };
    mockHandleAuth.mockImplementation((options) => {
      Object.assign(captured, options ?? {});
      return authkitMocks.callbackHandler;
    });
    return { getOptions: () => captured };
  }

  test("onSuccess forwards only the access token to the authenticated action", async () => {
    setWorkosEnv({ ...completeWorkosEnv, WORKOS_ORGANIZATION_ID: "org_pickle_point" });
    convexMocks.fetchAction.mockResolvedValue({ status: "ok" });
    const { getOptions } = captureHandleAuthOptions();
    await import("../../app/callback/route");

    const accessToken = "jwt.access.token";
    await getOptions().onSuccess!({ accessToken });

    expect(convexMocks.fetchAction).toHaveBeenCalledTimes(1);
    const [ref, args, options] = convexMocks.fetchAction.mock.calls[0];
    // The function reference is opaque to the test; we assert the call
    // carries NO identity arguments and forwards the token as the sole
    // authentication credential.
    expect(ref).toBeTruthy();
    expect(args).toEqual({});
    expect(options).toEqual({ token: accessToken });
  });

  test("onSuccess with a non-ok status throws so AuthKit routes to onError", async () => {
    setWorkosEnv({ ...completeWorkosEnv, WORKOS_ORGANIZATION_ID: "org_pickle_point" });
    const { getOptions } = captureHandleAuthOptions();
    await import("../../app/callback/route");
    const onSuccess = getOptions().onSuccess!;
    expect(onSuccess).toBeInstanceOf(Function);

    for (const status of ["email_required", "forbidden", "tenant_not_provisioned", "unauthenticated"] as const) {
      convexMocks.fetchAction.mockResolvedValueOnce({ status });
      await expect(onSuccess({ accessToken: "jwt" })).rejects.toThrow();
    }
  });

  test("onSuccess surfaces a fetchAction rejection as a thrown error (→ onError)", async () => {
    setWorkosEnv({ ...completeWorkosEnv, WORKOS_ORGANIZATION_ID: "org_pickle_point" });
    convexMocks.fetchAction.mockRejectedValue(new Error("convex down"));
    const { getOptions } = captureHandleAuthOptions();
    await import("../../app/callback/route");

    await expect(
      getOptions().onSuccess!({ accessToken: "jwt" })
    ).rejects.toThrow();
  });

  test("onError redirects to /support/access and leaks nothing", async () => {
    setWorkosEnv({ ...completeWorkosEnv, WORKOS_ORGANIZATION_ID: "org_pickle_point" });
    const { getOptions } = captureHandleAuthOptions();
    await import("../../app/callback/route");

    const request = new Request("https://app.example.com/callback");
    const sensitive = {
      error: new Error("organization_id=org_pickle_point token=secret email=owner@x.example"),
    };
    const response = await getOptions().onError!({ request, ...sensitive } as never);

    expect(response.status).toBe(303);
    const location = response.headers.get("location");
    expect(location).toMatch(/^https:\/\/app\.example\.com\/support\/access$/);

    // No token, claim, organization id, email, or internal message may
    // appear anywhere in the response headers or body.
    const headerDump = JSON.stringify(Object.fromEntries(response.headers.entries()));
    expect(headerDump).not.toContain("org_pickle_point");
    expect(headerDump).not.toContain("owner@x.example");
    expect(headerDump.toLowerCase()).not.toContain("token=secret");
    const body = await response.text();
    expect(body).toBe("");
  });

  test("onError never reflects query-string tokens even if present on the request", async () => {
    setWorkosEnv(completeWorkosEnv);
    const { getOptions } = captureHandleAuthOptions();
    await import("../../app/callback/route");

    const request = new Request(
      "https://app.example.com/callback?code=secret_code&state=secret_state"
    );
    const response = await getOptions().onError!({
      request,
      error: new Error("boom"),
    });

    const location = response.headers.get("location") ?? "";
    // The redirect destination is the fixed support URL with no query.
    expect(location).toBe("https://app.example.com/support/access");
    expect(location).not.toContain("code=");
    expect(location).not.toContain("state=");
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
