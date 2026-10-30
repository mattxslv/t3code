import { createFileRoute } from "@tanstack/react-router";

import { UsagePage } from "../components/usage/UsagePage";

export const Route = createFileRoute("/_chat/usage")({
  validateSearch: (search: Record<string, unknown>): { metric?: "limits" } =>
    search.metric === "limits" ? { metric: "limits" } : {},
  component: UsagePage,
});
