import { canBypassWorkosAuth, hasWorkosAuthConfig } from "@/lib/auth/workos";

export type DocsAccessMode = "public_local" | "authenticated" | "unavailable";

type DocsAccessEnv = Record<string, string | undefined> & {
  NODE_ENV?: string;
  WORKOS_CLIENT_ID?: string;
  WORKOS_API_KEY?: string;
  WORKOS_COOKIE_PASSWORD?: string;
  NEXT_PUBLIC_WORKOS_REDIRECT_URI?: string;
};

export function getDocsAccessMode(env: DocsAccessEnv): DocsAccessMode {
  if (hasWorkosAuthConfig(env)) {
    return "authenticated";
  }

  if (canBypassWorkosAuth(env)) {
    return "public_local";
  }

  return "unavailable";
}
