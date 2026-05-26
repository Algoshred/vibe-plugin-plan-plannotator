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
      async ({ params, set, request }) => {
        const adapter = getAdapter(params.agent as SupportedAgent);
        if (!adapter) {
          set.status = 404;
          return { ok: false, error: `Unknown agent '${params.agent}'` };
        }
        // Prefer the agent's configured key, but fall back to the key the
        // caller authenticated with. Every request reaching this plugin route
        // carries `x-agent-api-key`, and some agent runtimes don't surface the
        // key via the elysia decorator or AGENT_API_KEY env — leaving
        // cfg.getAgentApiKey() null. The request header is always present and
        // is itself a valid agent key, which is exactly what the hook needs to
        // embed for its callback auth.
        const apiKey =
          cfg.getAgentApiKey() ?? request.headers.get("x-agent-api-key");
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
