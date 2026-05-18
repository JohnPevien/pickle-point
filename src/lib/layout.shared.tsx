import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "Pickle Point Docs",
      url: "/docs",
    },
    links: [
      {
        text: "App",
        url: "/",
      },
    ],
  };
}
