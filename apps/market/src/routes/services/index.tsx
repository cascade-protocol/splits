import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/services/")({
  ssr: false,
  component: () => <Navigate to="/dashboard" />,
});
