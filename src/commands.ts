/**
 * `vibe plan-plannotator` CLI commands.
 */

import type { Command } from "commander";

import {
  maybePrintJson,
  pickOutputMode,
  redact,
  runMultimode,
  type OutputFlags,
} from "@vibecontrols/plugin-sdk";

import type { PlannotatorStatus } from "./types.js";

const AGENT_BASE_URL = process.env.VIBE_AGENT_URL ?? "http://localhost:3005";
const API_KEY = process.env.VIBE_AGENT_API_KEY ?? "";

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${AGENT_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-agent-api-key": API_KEY,
      ...init?.headers,
    },
  });
}

export function registerPlannotatorCommands(program: Command): void {
  const cmd = program
    .command("plan-plannotator")
    .description("Plannotator plan provider lifecycle");

  cmd
    .command("status")
    .description("Show plannotator binary + session status")
    .option("--json", "Emit JSON")
    .option("--plain", "Plain text output")
    .action(async (opts: OutputFlags) => {
      await runMultimode<PlannotatorStatus>({
        mode: pickOutputMode(opts),
        fetchData: async () => {
          const res = await apiFetch("/api/plan-plannotator/status");
          return (await res.json()) as PlannotatorStatus;
        },
        plain: (data) => {
          process.stdout.write(
            `installed=${data.installed} version=${data.version ?? "?"} running=${data.runningSessions.length}\n`,
          );
        },
        interactive: async (data) => {
          process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
        },
        json: (data) => redact(data),
      });
    });

  cmd
    .command("install")
    .description("Install the plannotator binary")
    .option("--json", "Emit JSON")
    .action(async (opts: OutputFlags) => {
      const res = await apiFetch("/api/plan-plannotator/install", {
        method: "POST",
      });
      const data = await res.json();
      if (maybePrintJson(opts, data)) return;
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    });

  cmd
    .command("stop")
    .description("Stop a plannotator session (or all if no id given)")
    .option("--session <id>", "Stop a specific session id")
    .option("--json", "Emit JSON")
    .action(async (opts: { session?: string } & OutputFlags) => {
      const query = opts.session
        ? `?sessionId=${encodeURIComponent(opts.session)}`
        : "";
      const res = await apiFetch(`/api/plan-plannotator/stop${query}`, {
        method: "POST",
      });
      const data = await res.json();
      if (maybePrintJson(opts, data)) return;
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    });

  const agents = cmd.command("agents").description("Manage AI-agent hooks");

  agents
    .command("list")
    .description("List supported AI agents + hook status")
    .option("--json", "Emit JSON")
    .action(async (opts: OutputFlags) => {
      const res = await apiFetch("/api/plan-plannotator/agents/supported");
      const data = await res.json();
      if (maybePrintJson(opts, data)) return;
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    });

  agents
    .command("configure <agent>")
    .description("Install the plannotator hook for an AI agent")
    .option("--json", "Emit JSON")
    .action(async (agent: string, opts: OutputFlags) => {
      const res = await apiFetch(
        `/api/plan-plannotator/agents/${encodeURIComponent(agent)}/configure-hook`,
        { method: "POST" },
      );
      const data = await res.json();
      if (maybePrintJson(opts, data)) return;
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    });

  agents
    .command("unconfigure <agent>")
    .description("Remove the plannotator hook for an AI agent")
    .option("--json", "Emit JSON")
    .action(async (agent: string, opts: OutputFlags) => {
      const res = await apiFetch(
        `/api/plan-plannotator/agents/${encodeURIComponent(agent)}/unconfigure-hook`,
        { method: "POST" },
      );
      const data = await res.json();
      if (maybePrintJson(opts, data)) return;
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    });
}
