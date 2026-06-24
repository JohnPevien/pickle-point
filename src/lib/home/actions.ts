export type HomeActionKey = "setup" | "sign-in" | "docs";

export type HomeAction = {
  key: HomeActionKey;
  label: string;
  href: string;
  description: string;
  variant: "primary" | "secondary";
};

export const HOME_ACTIONS: HomeAction[] = [
  {
    key: "setup",
    label: "Create workspace",
    href: "/setup",
    description: "Set up your Game Master workspace and club profile.",
    variant: "primary",
  },
  {
    key: "sign-in",
    label: "Sign in",
    href: "/sign-in",
    description: "Continue to your protected Game Master workspace.",
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
