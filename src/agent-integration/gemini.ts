/**
 * Gemini CLI hook adapter.
 *
 * Drops a shell hook at `~/.gemini/hooks/vibe-plan-plannotator.sh`. The
 * Gemini CLI fans out hooks by lexical order — our hook is invoked with
 * the plan content on stdin at the model's plan-finalisation step.
 */

import { mkdir, writeFile, stat, chmod, unlink } from "node:fs/promises";
import { homedir as osHomedir } from "node:os";

function homedir(): string {
  return process.env.HOME ?? osHomedir();
}
import { join, resolve } from "node:path";

import type { AgentAdapter } from "./index.js";

function geminiDir(): string {
  return join(homedir(), ".gemini");
}

function hookDir(): string {
  return join(geminiDir(), "hooks");
}

function hookPath(): string {
  return join(hookDir(), "vibe-plan-plannotator.sh");
}

function safeHomePath(path: string): boolean {
  return resolve(path).startsWith(`${homedir()}/`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function buildScript(
  agentApiKey: string,
  agentBaseUrl: string,
  profile: string,
): string {
  const keyEscaped = agentApiKey.replace(/'/g, "'\\''");
  const urlEscaped =
    `${agentBaseUrl}/api/profiles/${profile}/plan/sessions`.replace(
      /'/g,
      "'\\''",
    );
  return `#!/bin/bash
# vibe-plan-plannotator hook for Gemini CLI.
# Forwards the plan content on stdin to the vibecontrols agent.

set -e
API_KEY='${keyEscaped}'
URL='${urlEscaped}'

cat | curl -sf -X POST \\
  -H 'Content-Type: application/json' \\
  -H "x-agent-api-key: $API_KEY" \\
  --data-binary @- \\
  "$URL" >/dev/null || true
`;
}

export const adapter: AgentAdapter = {
  agent: "gemini",
  name: "Gemini CLI",
  instructions:
    "Drops a hook script in ~/.gemini/hooks/ so Gemini plan finalisation forwards to plannotator.",

  async detect() {
    const installed = await fileExists(geminiDir());
    return { installed, configPath: hookPath() };
  },

  async isHookConfigured() {
    return fileExists(hookPath());
  },

  async configureHook({ agentApiKey, agentBaseUrl, profile = "default" }) {
    if (!safeHomePath(hookPath())) {
      throw new Error(`refusing to write outside $HOME: ${hookPath()}`);
    }
    await mkdir(hookDir(), { recursive: true });
    await writeFile(
      hookPath(),
      buildScript(agentApiKey, agentBaseUrl, profile),
      "utf8",
    );
    await chmod(hookPath(), 0o755);
    return { configPath: hookPath() };
  },

  async unconfigureHook() {
    try {
      await unlink(hookPath());
    } catch {
      // Already absent.
    }
  },
};
