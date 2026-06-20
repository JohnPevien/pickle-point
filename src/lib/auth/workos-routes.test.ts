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

const navigationMocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => ({ kind: "redirect", url })),
}));

const convexNextMocks = vi.hoisted(() => ({
  fetchQuery: vi.fn(),
}));

vi.mock("@workos-inc/authkit-nextjs", () => authkitMocks);
vi.mock("next/navigation", () => navigationMocks);
vi.mock("convex/nextjs", () => convexNextMocks);
vi.mock("react/jsx-dev-runtime", () => ({
  Fragment: Symbol.for("react.fragment"),
  jsxDEV: (_type: unknown, props: unknown) => ({ props }),
}));
vi.mock("react/jsx-runtime", () => ({
  Fragment: Symbol.for("react.fragment"),
  jsx: (_type: unknown, props: unknown) => ({ props }),
  jsxs: (_type: unknown, props: unknown) => ({ props }),
}));
vi.mock("fumadocs-ui/layouts/docs", () => ({
  DocsLayout: vi.fn(),
}));
vi.mock("@/lib/layout.shared", () => ({
  baseOptions: vi.fn(() => ({ nav: { title: "Pickle Point" } })),
}));
vi.mock("@/lib/source", () => ({
  source: {
    getPageTree: vi.fn(() => ({ name: "docs-tree" })),
  },
}));
vi.mock("@/components/admin/AdminShell", () => ({
  AdminShell: vi.fn(() => null),
}));
vi.mock("@/components/admin/WorkspaceSettingsForm", () => ({
  WorkspaceSettingsForm: vi.fn(() => null),
}));
vi.mock("@/components/setup/WorkspaceSetupForm", () => ({
  WorkspaceSetupForm: vi.fn(() => null),
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
  convexNextMocks.fetchQuery.mockReset();
  navigationMocks.notFound.mockReset();
  navigationMocks.notFound.mockImplementation(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
  navigationMocks.redirect.mockReset();
  navigationMocks.redirect.mockImplementation((url: string) => ({ kind: "redirect", url }));

  restoreWorkosEnv();
});

describe("AuthKit page routes", () => {
  test("redirects sign-in requests to the WorkOS authorization URL", async () => {
    authkitMocks.getSignInUrl.mockResolvedValue("https://workos.example.com/sign-in");

    const { GET } = await import("../../app/sign-in/route");
    const result = await GET();

    expect(authkitMocks.getSignInUrl).toHaveBeenCalledTimes(1);
    expect(navigationMocks.redirect).toHaveBeenCalledWith("https://workos.example.com/sign-in");
    expect(result).toEqual({ kind: "redirect", url: "https://workos.example.com/sign-in" });
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

describe("docs access layout", () => {
  test("forces dynamic rendering so docs auth runs per request", async () => {
    const { dynamic } = await import("../../app/docs/layout");

    expect(dynamic).toBe("force-dynamic");
  });

  test("requires a signed-in WorkOS session when production auth is configured", async () => {
    setWorkosEnv(completeWorkosEnv);
    authkitMocks.withAuth.mockResolvedValue({ user: { id: "user_123" }, accessToken: "token_123" });

    const { default: Layout } = await import("../../app/docs/layout");
    await Layout({ children: "docs content" });

    expect(authkitMocks.withAuth).toHaveBeenCalledTimes(1);
    expect(authkitMocks.withAuth).toHaveBeenCalledWith();
    expect(navigationMocks.notFound).not.toHaveBeenCalled();
  });

  test("redirects docs visitors through the sign-in route without WorkOS PKCE writes in the layout", async () => {
    setWorkosEnv(completeWorkosEnv);
    authkitMocks.withAuth.mockResolvedValue({ user: null });

    const { default: Layout } = await import("../../app/docs/layout");
    const result = await Layout({ children: "docs content" });

    expect(result).toEqual({ kind: "redirect", url: "/sign-in" });
    expect(authkitMocks.withAuth).toHaveBeenCalledWith();
    expect(navigationMocks.redirect).toHaveBeenCalledWith("/sign-in");
  });

  test("keeps docs available during local development without WorkOS configuration", async () => {
    setWorkosEnv({ NODE_ENV: "development" });

    const { default: Layout } = await import("../../app/docs/layout");
    await Layout({ children: "docs content" });

    expect(authkitMocks.withAuth).not.toHaveBeenCalled();
    expect(navigationMocks.notFound).not.toHaveBeenCalled();
  });

  test("hides docs in production when WorkOS is not configured", async () => {
    setWorkosEnv({ NODE_ENV: "production" });

    const { default: Layout } = await import("../../app/docs/layout");

    await expect(Layout({ children: "docs content" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(authkitMocks.withAuth).not.toHaveBeenCalled();
    expect(navigationMocks.notFound).toHaveBeenCalledTimes(1);
  });
});

describe("protected server component auth", () => {
  test("redirects setup visitors through the sign-in route without ensureSignedIn", async () => {
    setWorkosEnv(completeWorkosEnv);
    authkitMocks.withAuth.mockResolvedValue({ user: null });

    const { default: SetupPage } = await import("../../app/setup/page");
    const result = await SetupPage();

    expect(result).toEqual({ kind: "redirect", url: "/sign-in" });
    expect(authkitMocks.withAuth).toHaveBeenCalledTimes(1);
    expect(authkitMocks.withAuth).toHaveBeenCalledWith();
    expect(convexNextMocks.fetchQuery).not.toHaveBeenCalled();
  });

  test("redirects tenant admin visitors through the sign-in route without ensureSignedIn", async () => {
    setWorkosEnv(completeWorkosEnv);
    authkitMocks.withAuth.mockResolvedValue({ user: null });
    convexNextMocks.fetchQuery.mockResolvedValueOnce({
      _id: "tenant_123",
      name: "Downtown Pickleball",
    });

    const { default: AdminLayout } = await import("../../app/[tenant]/admin/layout");
    const result = await AdminLayout({
      children: "admin content",
      params: Promise.resolve({ tenant: "tenant_123" }),
    });

    expect(result).toEqual({ kind: "redirect", url: "/sign-in" });
    expect(authkitMocks.withAuth).toHaveBeenCalledTimes(1);
    expect(authkitMocks.withAuth).toHaveBeenCalledWith();
  });

  test("redirects workspace settings visitors through the sign-in route without ensureSignedIn", async () => {
    setWorkosEnv(completeWorkosEnv);
    authkitMocks.withAuth.mockResolvedValue({ user: null });

    const { default: AdminWorkspacePage } = await import("../../app/[tenant]/admin/workspace/page");
    const result = await AdminWorkspacePage({
      params: Promise.resolve({ tenant: "tenant_123" }),
    });

    expect(result).toEqual({ kind: "redirect", url: "/sign-in" });
    expect(authkitMocks.withAuth).toHaveBeenCalledTimes(1);
    expect(authkitMocks.withAuth).toHaveBeenCalledWith();
    expect(convexNextMocks.fetchQuery).not.toHaveBeenCalled();
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
