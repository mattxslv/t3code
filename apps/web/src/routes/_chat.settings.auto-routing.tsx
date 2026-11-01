import { createFileRoute } from "@tanstack/react-router";

import { AutoRoutingSettingsPanel } from "../components/settings/AutoRoutingSettings";

export const Route = createFileRoute("/_chat/settings/auto-routing")({
  component: AutoRoutingSettingsPanel,
});
