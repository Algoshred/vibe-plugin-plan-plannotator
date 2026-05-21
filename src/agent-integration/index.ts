/**
 * Per-AI-agent hook configuration dispatcher.
 *
 * Each adapter writes a hook file in the matching agent's config tree
 * (`~/.claude/hooks.json`, `~/.config/opencode/opencode.json`,
 * `~/.codex/config.toml`, …) that pipes plan content to the vibecontrols
 * agent's `/api/plan/sessions` endpoint when the agent hits its
 * "exit-plan" / "approval-required" lifecycle.
 *
 * Adapters MUST be idempotent (re-running configureHook must not duplicate
 * entries) and refuse to write outside the agent's home subdir.
 */

import * as claude from "./claude.js";
import * as opencode from "./opencode.js";
import * as codex from "./codex.js";
import * as pi from "./pi.js";
import * as gemini from "./gemini.js";

import type { AgentDetectionResult, SupportedAgent } from "../types.js";

export interface AgentAdapter {
  agent: SupportedAgent;
  name: string;
  instructions: string;
  detect(): Promise<{ installed: boolean; configPath: string }>;
  isHookConfigured(): Promise<boolean>;
  configureHook(opts: {
    agentApiKey: string;
    agentBaseUrl: string;
  }): Promise<{ configPath: string }>;
  unconfigureHook(): Promise<void>;
}

const ADAPTERS: Record<SupportedAgent, AgentAdapter> = {
  claude: claude.adapter,
  opencode: opencode.adapter,
  codex: codex.adapter,
  pi: pi.adapter,
  gemini: gemini.adapter,
};

export function getAdapter(agent: SupportedAgent): AgentAdapter | null {
  return ADAPTERS[agent] ?? null;
}

export function listAdapters(): AgentAdapter[] {
  return Object.values(ADAPTERS);
}

export async function detectAll(): Promise<AgentDetectionResult[]> {
  const results: AgentDetectionResult[] = [];
  for (const adapter of listAdapters()) {
    const detect = await adapter.detect();
    const hookConfigured = detect.installed
      ? await adapter.isHookConfigured()
      : false;
    results.push({
      agent: adapter.agent,
      name: adapter.name,
      cliInstalled: detect.installed,
      hookConfigured,
      configPath: detect.configPath,
      instructions: adapter.instructions,
    });
  }
  return results;
}
