/**
 * Codex CLI hook adapter.
 *
 * Writes a `[hooks.plannotator]` TOML block in `~/.codex/config.toml`.
 * Codex runs the hook on its stop / approval lifecycle and forwards the
 * plan JSON to the vibecontrols agent.
 */

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { homedir as osHomedir } from "node:os";

function homedir(): string {
  return process.env.HOME ?? osHomedir();
}
import { dirname, join, resolve } from "node:path";

import type { AgentAdapter } from "./index.js";

const SECTION_MARKER_START = "# <vibe-plan-plannotator:start>";
const SECTION_MARKER_END = "# <vibe-plan-plannotator:end>";

function codexDir(): string {
  return join(homedir(), ".codex");
}

function configPath(): string {
  return join(codexDir(), "config.toml");
}

function safeHomePath(path: string): boolean {
  return resolve(path).startsWith(`${homedir()}/`);
}

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function atomicWrite(path: string, text: string): Promise<void> {
  if (!safeHomePath(path)) {
    throw new Error(`refusing to write outside $HOME: ${path}`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
}

function stripExistingBlock(source: string): string {
  const start = source.indexOf(SECTION_MARKER_START);
  if (start === -1) return source;
  const end = source.indexOf(SECTION_MARKER_END);
  if (end === -1) return source;
  const before = source.slice(0, start);
  const after = source.slice(end + SECTION_MARKER_END.length);
  return `${before.replace(/\n+$/, "")}\n${after.replace(/^\n+/, "")}`;
}

function buildBlock(agentApiKey: string, agentBaseUrl: string): string {
  const url = `${agentBaseUrl}/api/plan/sessions`;
  const escapedKey = agentApiKey.replace(/"/g, '\\"');
  const escapedUrl = url.replace(/"/g, '\\"');
  return [
    SECTION_MARKER_START,
    "[hooks.plannotator]",
    `command = "cat | curl -sf -X POST -H 'Content-Type: application/json' -H \\"x-agent-api-key: ${escapedKey}\\" --data-binary @- ${escapedUrl} >/dev/null || true"`,
    `events = ["stop"]`,
    SECTION_MARKER_END,
    "",
  ].join("\n");
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export const adapter: AgentAdapter = {
  agent: "codex",
  name: "Codex CLI",
  instructions:
    "Wires Codex's stop-hook to plannotator so each completed plan lands in the vibecontrols agent.",

  async detect() {
    const installed = await dirExists(codexDir());
    return { installed, configPath: configPath() };
  },

  async isHookConfigured() {
    const text = await readOrEmpty(configPath());
    return text.includes(SECTION_MARKER_START);
  },

  async configureHook({ agentApiKey, agentBaseUrl }) {
    const current = await readOrEmpty(configPath());
    const cleaned = stripExistingBlock(current);
    const block = buildBlock(agentApiKey, agentBaseUrl);
    const next = `${cleaned.trim()}\n\n${block}`.replace(/^\n+/, "");
    await atomicWrite(configPath(), next);
    return { configPath: configPath() };
  },

  async unconfigureHook() {
    const current = await readOrEmpty(configPath());
    if (!current.includes(SECTION_MARKER_START)) return;
    const cleaned = stripExistingBlock(current).replace(/\n{3,}/g, "\n\n");
    await atomicWrite(configPath(), cleaned.trimStart());
  },
};
