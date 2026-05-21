import { Elysia } from "elysia";

import type { HostServices } from "@vibecontrols/plugin-sdk";

import { createAgentRoutes } from "./agents.js";
import { createLifecycleRoutes } from "./lifecycle.js";
import { createStatusRoute } from "./status.js";

interface RoutesConfig {
  getAgentApiKey: () => string | null;
  getAgentBaseUrl: () => string;
}

export function createPlannotatorRoutes(host: HostServices, cfg: RoutesConfig) {
  return new Elysia({ prefix: "/api/plan-plannotator" })
    .use(createStatusRoute())
    .use(createLifecycleRoutes())
    .use(createAgentRoutes(host, cfg));
}
