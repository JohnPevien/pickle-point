"use client";

import { ReactNode, useCallback, useEffect, useState } from "react";
import { ConvexProvider, ConvexProviderWithAuth, ConvexReactClient } from "convex/react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!convex) {
    // Graceful fallback during static build phases or before the client environment is configured.
    console.warn("NEXT_PUBLIC_CONVEX_URL is not set. Realtime queries will be disabled.");
    return <>{children}</>;
  }

  if (!process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI) {
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
      console.warn("NEXT_PUBLIC_WORKOS_REDIRECT_URI is not set. Authenticated Convex queries will be disabled.");
    }

    return <ConvexProvider client={convex}>{children}</ConvexProvider>;
  }

  return (
    <ConvexProviderWithAuth client={convex} useAuth={useAuthFromWorkosSession}>
      {children}
    </ConvexProviderWithAuth>
  );
}

type AuthState = {
  isLoading: boolean;
  isAuthenticated: boolean;
};

type SessionResponse = {
  authenticated?: boolean;
};

type TokenResponse = {
  accessToken?: string | null;
};

function useAuthFromWorkosSession() {
  const [authState, setAuthState] = useState<AuthState>({
    isLoading: true,
    isAuthenticated: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const data = (await response.json()) as SessionResponse;

        if (!cancelled) {
          setAuthState({
            isLoading: false,
            isAuthenticated: Boolean(response.ok && data.authenticated),
          });
        }
      } catch {
        if (!cancelled) {
          setAuthState({ isLoading: false, isAuthenticated: false });
        }
      }
    }

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }): Promise<string | null> => {
      if (!authState.isAuthenticated) {
        return null;
      }

      try {
        const response = await fetch(`/api/auth/token${forceRefreshToken ? "?refresh=1" : ""}`, {
          cache: "no-store",
        });

        if (response.status === 401) {
          setAuthState({ isLoading: false, isAuthenticated: false });
          return null;
        }

        if (!response.ok) {
          return null;
        }

        const data = (await response.json()) as TokenResponse;
        return data.accessToken ?? null;
      } catch {
        return null;
      }
    },
    [authState.isAuthenticated],
  );

  return {
    isLoading: authState.isLoading,
    isAuthenticated: authState.isAuthenticated,
    fetchAccessToken,
  };
}
