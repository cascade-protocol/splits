import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/splits")({
  beforeLoad: () => {
    throw redirect({ href: "https://cascade.fyi" });
  },
});
