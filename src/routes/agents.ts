import { Elysia, t } from "elysia";

import type { HostServices } from "@vibecontrols/plugin-sdk";

import { detectAll, getAdapter } from "../agent-integration/index.js";
import type { SupportedAgent } from "../types.js";

interface AgentRouteConfig {
  getAgentApiKey: () => string | null;
  getAgentBaseUrl: () => string;
}

export function createAgentRoutes(_host: HostServices, cfg: AgentRouteConfig) {
  return new Elysia()
    .get("/agents/supported", async () => ({ agents: await detectAll() }))
    .post(
      "/agents/:agent/configure-hook",
      async ({ params, set }) => {
        const adapter = getAdapter(params.agent as SupportedAgent);
        if (!adapter) {
          set.status = 404;
          return { ok: false, error: `Unknown agent '${params.agent}'` };
        }
        const apiKey = cfg.getAgentApiKey();
        if (!apiKey) {
          set.status = 500;
          return {
            ok: false,
            error:
              "Agent API key not available — cannot configure hook without it",
          };
        }
        try {
          const result = await adapter.configureHook({
            agentApiKey: apiKey,
            agentBaseUrl: cfg.getAgentBaseUrl(),
          });
          return { ok: true, configPath: result.configPath };
        } catch (err) {
          set.status = 500;
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
      {
        params: t.Object({
          agent: t.Union([
            t.Literal("claude"),
            t.Literal("opencode"),
            t.Literal("codex"),
            t.Literal("pi"),
            t.Literal("gemini"),
          ]),
        }),
      },
    )
    .post(
      "/agents/:agent/unconfigure-hook",
      async ({ params, set }) => {
        const adapter = getAdapter(params.agent as SupportedAgent);
        if (!adapter) {
          set.status = 404;
          return { ok: false, error: `Unknown agent '${params.agent}'` };
        }
        try {
          await adapter.unconfigureHook();
          return { ok: true };
        } catch (err) {
          set.status = 500;
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
      {
        params: t.Object({
          agent: t.Union([
            t.Literal("claude"),
            t.Literal("opencode"),
            t.Literal("codex"),
            t.Literal("pi"),
            t.Literal("gemini"),
          ]),
        }),
      },
    );
}
