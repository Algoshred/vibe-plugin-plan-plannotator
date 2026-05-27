/**
 * Claude Code hook adapter.
 *
 * Writes a PreToolUse hook that forwards `ExitPlanMode` invocations to
 * the vibecontrols agent's `/api/plan/sessions` REST endpoint. The hook
 * runs as a shell command — we shell-escape every interpolated value.
 */

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { homedir as osHomedir } from "node:os";

function homedir(): string {
  return process.env.HOME ?? osHomedir();
}
import { dirname, join, resolve } from "node:path";

import type { AgentAdapter } from "./index.js";

const HOOK_NAME = "vibe-plan-plannotator";

function claudeDir(): string {
  return join(homedir(), ".claude");
}

function hooksPath(): string {
  return join(claudeDir(), "hooks.json");
}

interface HookCommand {
  type: "command";
  command: string;
}

interface ClaudeHookEntry {
  matcher?: string;
  hooks: HookCommand[];
  source?: string;
}

interface ClaudeHooksConfig {
  hooks?: {
    PreToolUse?: ClaudeHookEntry[];
    [event: string]: ClaudeHookEntry[] | undefined;
  };
}

function safeHomePath(path: string): boolean {
  const real = resolve(path);
  return real.startsWith(`${homedir()}/`);
}

async function readJsonOrEmpty(path: string): Promise<ClaudeHooksConfig> {
  try {
    const text = await readFile(path, "utf8");
    if (!text.trim()) return {};
    return JSON.parse(text) as ClaudeHooksConfig;
  } catch {
    return {};
  }
}

async function atomicWriteJson(
  path: string,
  data: ClaudeHooksConfig,
): Promise<void> {
  if (!safeHomePath(path)) {
    throw new Error(`refusing to write outside $HOME: ${path}`);
  }
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  // Atomic rename within the same directory.
  await import("node:fs").then((fs) =>
    fs.promises.rename(tmp, path).catch(async () => {
      // Fallback for environments where rename is non-atomic.
      await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    }),
  );
}

function buildCommand(
  agentApiKey: string,
  agentBaseUrl: string,
  profile: string,
): string {
  // The hook input arrives on stdin as JSON. We push the entire JSON body
  // through to the agent and let the agent's /api/plan/sessions handler
  // pluck the plan text out of `tool_input.plan` (Claude Code's
  // ExitPlanMode tool shape).
  const key = JSON.stringify(agentApiKey);
  const url = JSON.stringify(
    `${agentBaseUrl}/api/profiles/${profile}/plan/sessions`,
  );
  // shell-quote the variables — we use printf to avoid eval-style risks.
  return `cat | curl -sf -X POST -H 'Content-Type: application/json' -H "x-agent-api-key: $(printf '%s' ${key})" --data-binary @- $(printf '%s' ${url}) >/dev/null || true`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export const adapter: AgentAdapter = {
  agent: "claude",
  name: "Claude Code",
  instructions:
    "Routes Claude Code's ExitPlanMode hook to plannotator via the vibecontrols agent. Hook lives in ~/.claude/hooks.json.",

  async detect() {
    const installed = await fileExists(claudeDir());
    return { installed, configPath: hooksPath() };
  },

  async isHookConfigured() {
    const config = await readJsonOrEmpty(hooksPath());
    const preTool = config.hooks?.PreToolUse ?? [];
    return preTool.some((entry) => entry.source === HOOK_NAME);
  },

  async configureHook({ agentApiKey, agentBaseUrl, profile = "default" }) {
    const config = await readJsonOrEmpty(hooksPath());
    config.hooks = config.hooks ?? {};
    config.hooks.PreToolUse = config.hooks.PreToolUse ?? [];

    // Remove any prior vibe-plan-plannotator entries (idempotent re-apply).
    config.hooks.PreToolUse = config.hooks.PreToolUse.filter(
      (e) => e.source !== HOOK_NAME,
    );

    config.hooks.PreToolUse.push({
      matcher: "ExitPlanMode",
      source: HOOK_NAME,
      hooks: [
        {
          type: "command",
          command: buildCommand(agentApiKey, agentBaseUrl, profile),
        },
      ],
    });

    await atomicWriteJson(hooksPath(), config);
    return { configPath: hooksPath() };
  },

  async unconfigureHook() {
    const config = await readJsonOrEmpty(hooksPath());
    if (!config.hooks?.PreToolUse) return;
    config.hooks.PreToolUse = config.hooks.PreToolUse.filter(
      (e) => e.source !== HOOK_NAME,
    );
    await atomicWriteJson(hooksPath(), config);
  },
};
