const WORKOS_COOKIE_PASSWORD_MIN_LENGTH = 32;

type WorkosAuthEnv = Record<string, string | undefined> & {
  NODE_ENV?: string;
  WORKOS_CLIENT_ID?: string;
  WORKOS_API_KEY?: string;
  WORKOS_COOKIE_PASSWORD?: string;
  NEXT_PUBLIC_WORKOS_REDIRECT_URI?: string;
};

export const workosAuthRoutes = {
  callback: "/callback",
  signIn: "/sign-in",
  signUp: "/sign-up",
  session: "/api/auth/session",
  token: "/api/auth/token",
} as const;

export function hasWorkosAuthConfig(env: WorkosAuthEnv) {
  return Boolean(
    env.WORKOS_CLIENT_ID &&
      env.WORKOS_API_KEY &&
      env.NEXT_PUBLIC_WORKOS_REDIRECT_URI &&
      env.WORKOS_COOKIE_PASSWORD &&
      env.WORKOS_COOKIE_PASSWORD.length >= WORKOS_COOKIE_PASSWORD_MIN_LENGTH,
  );
}

export function canBypassWorkosAuth(env: WorkosAuthEnv) {
  return env.NODE_ENV !== "production" && !hasWorkosAuthConfig(env);
}
