/**
 * @vibecontrols/vibe-plugin-plan-plannotator
 *
 * Plannotator plan provider. Spawns one plannotator binary per active
 * session, reverse-proxies its UI at `/plan/:sessionId/*` (auth via
 * session cookie + API key, header-stripped for iframe embedding), and
 * registers itself with the agent's ServiceRegistry under the `"plan"`
 * provider type so the meta plugin (`@vibecontrols/vibe-plugin-plan`)
 * can dispatch to it.
 *
 * Manifest:
 *   apiPrefix:   /api/plan-plannotator
 *   cliCommand:  plan-plannotator
 *   tags:        backend, provider, frontend, integration
 *   capabilities: storage rw, subprocess, telemetry, broadcast, audit
 *   hasUI:       true
 *   publicPaths: ["/plan/"]
 */

import type { Command } from "commander";

import {
  createLifecycleHooks,
  TelemetryEmitter,
  type HostServices,
  type ProfileContext,
  type VibePlugin,
  type VibePluginFactory,
} from "@vibecontrols/plugin-sdk";

import { PlannotatorProvider } from "./provider.js";
import { createPlannotatorRoutes } from "./routes/index.js";
import { createPlannotatorProxy } from "./lib/proxy.js";
import { startIdleWatchdog, stopIdleWatchdog } from "./lib/idle-watchdog.js";
import { stopAllSessions } from "./lib/process.js";
import { registerPlannotatorCommands } from "./commands.js";

export type {
  PlanProvider,
  PlanProviderCapabilities,
  PlanSession,
  PlanFeedback,
  PlanContent,
  PlanAnnotation,
  PlanMode,
  SupportedAgent,
  AgentDetectionResult,
  PlannotatorStatus,
} from "./types.js";

const PLUGIN_NAME = "plan-plannotator";
const PLUGIN_VERSION = "2026.521.1";

type PlanPlannotatorVibePlugin = VibePlugin & {
  hasUI?: boolean;
  publicPaths?: string[];
};

let agentApiKey: string | null = null;

export const createPlugin: VibePluginFactory = (
  _ctx: ProfileContext,
): VibePlugin => {
  const lifecycle = createLifecycleHooks({
    name: PLUGIN_NAME,
    telemetryEventName: "plan.provider.ready",
    onInit: async (host: HostServices) => {
      const telemetry = new TelemetryEmitter(PLUGIN_NAME, PLUGIN_VERSION, host);
      telemetry.emitEvent("plan.provider.ready", { provider: "plannotator" });
    },
  });

  const plugin: PlanPlannotatorVibePlugin = {
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    description:
      "Plannotator-backed plan provider — wraps the upstream plannotator CLI for plan review inside vibecontrols.",
    tags: ["backend", "provider", "frontend", "integration"],
    capabilities: {
      storage: "rw",
      subprocess: true,
      telemetry: true,
      broadcast: true,
      audit: true,
    },
    prerequisites: [
      {
        kind: "binary",
        name: "plannotator",
        requiresSudo: false,
        install: "curl -fsSL https://plannotator.ai/install.sh | bash",
      },
    ],
    hasUI: true,
    publicPaths: ["/plan/"],
    cliCommand: "plan-plannotator",
    apiPrefix: "/api/plan-plannotator",

    async onServerStart(app: unknown, host: HostServices) {
      await lifecycle.onServerStart(app, host);

      const elysiaApp = app as {
        use: (plugin: unknown) => unknown;
        decorator?: { apiKey?: string };
      };
      try {
        agentApiKey =
          elysiaApp.decorator?.apiKey ?? process.env.AGENT_API_KEY ?? null;
      } catch {
        agentApiKey = process.env.AGENT_API_KEY ?? null;
      }

      // Mount /api/plan-plannotator/* + /plan/:sessionId/* proxy.
      elysiaApp.use(
        createPlannotatorRoutes(host, {
          getAgentApiKey: () => agentApiKey,
          getAgentBaseUrl: () =>
            host.getAgentBaseUrl?.() ??
            process.env.VIBE_AGENT_URL ??
            "http://localhost:3005",
        }),
      );
      elysiaApp.use(
        createPlannotatorProxy((key) =>
          agentApiKey ? key === agentApiKey : false,
        ),
      );

      // Register provider with the agent's ServiceRegistry under "plan".
      const provider = new PlannotatorProvider(host);
      const registry = host.serviceRegistry as
        | {
            registerProvider?: (
              type: string,
              provider: unknown,
              name: string,
            ) => void;
          }
        | undefined;
      registry?.registerProvider?.("plan", provider, "plannotator");

      startIdleWatchdog();

      process.stdout.write(
        "  Plugin 'plan-plannotator' registered routes: /api/plan-plannotator, /plan\n",
      );
    },

    async onServerStop(host: HostServices) {
      stopIdleWatchdog();
      await stopAllSessions();
      await lifecycle.onServerStop(host);
      process.stdout.write("  Plugin 'plan-plannotator' stopped\n");
    },

    onCliSetup(programArg: unknown) {
      registerPlannotatorCommands(programArg as Command);
    },
  };

  return plugin;
};

export default createPlugin;
