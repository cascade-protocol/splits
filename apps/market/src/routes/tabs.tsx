import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/tabs")({
  beforeLoad: () => {
    throw redirect({ href: "https://tabs.cascade.fyi" });
  },
});
