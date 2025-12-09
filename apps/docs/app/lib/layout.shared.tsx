import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "Cascade Docs",
    },
    links: [
      {
        text: "Launch App",
        url: "https://cascade.fyi",
      },
    ],
  };
}
