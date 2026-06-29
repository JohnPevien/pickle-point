export type HomeActionKey = "sign-in" | "sign-up" | "docs";

export type HomeAction = {
  key: HomeActionKey;
  label: string;
  href: string;
  description: string;
  variant: "primary" | "secondary";
};

export const HOME_ACTIONS: HomeAction[] = [
  {
    key: "sign-in",
    label: "Sign in",
    href: "/sign-in",
    description: "Continue to your protected Game Master or player workspace.",
    variant: "primary",
  },
  {
    key: "sign-up",
    label: "Register",
    href: "/sign-up",
    description: "Create a verified player account for the Pickle Point workspace.",
    variant: "secondary",
  },
  {
    key: "docs",
    label: "Read docs",
    href: "/docs",
    description: "Open product, technical, and operating documentation.",
    variant: "secondary",
  },
];

export function getHomeAction(key: string) {
  return HOME_ACTIONS.find((action) => action.key === key) ?? null;
}