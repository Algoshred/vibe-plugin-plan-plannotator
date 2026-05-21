/**
 * OpenCode hook adapter.
 *
 * Adds `@plannotator/opencode` to the `plugin` array in
 * `~/.config/opencode/opencode.json`. The upstream package is the
 * canonical integration path; users still drive auth/configuration
 * through `opencode` itself.
 */

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { homedir as osHomedir } from "node:os";

function homedir(): string {
  return process.env.HOME ?? osHomedir();
}
import { dirname, join, resolve } from "node:path";

import type { AgentAdapter } from "./index.js";

const PLUGIN_PKG = "@plannotator/opencode";

function opencodeDir(): string {
  return join(homedir(), ".config", "opencode");
}

function configPath(): string {
  return join(opencodeDir(), "opencode.json");
}

interface OpencodeConfig {
  plugin?: string[];
  [key: string]: unknown;
}

function safeHomePath(path: string): boolean {
  return resolve(path).startsWith(`${homedir()}/`);
}

async function readJsonOrEmpty(path: string): Promise<OpencodeConfig> {
  try {
    const text = await readFile(path, "utf8");
    if (!text.trim()) return {};
    return JSON.parse(text) as OpencodeConfig;
  } catch {
    return {};
  }
}

async function atomicWriteJson(
  path: string,
  data: OpencodeConfig,
): Promise<void> {
  if (!safeHomePath(path)) {
    throw new Error(`refusing to write outside $HOME: ${path}`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
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
  agent: "opencode",
  name: "OpenCode",
  instructions:
    "Adds @plannotator/opencode to the OpenCode plugin array so plans go through plannotator on review.",

  async detect() {
    const installed = await dirExists(opencodeDir());
    return { installed, configPath: configPath() };
  },

  async isHookConfigured() {
    const config = await readJsonOrEmpty(configPath());
    return (config.plugin ?? []).includes(PLUGIN_PKG);
  },

  async configureHook(_opts) {
    const config = await readJsonOrEmpty(configPath());
    const existing = new Set(config.plugin ?? []);
    existing.add(PLUGIN_PKG);
    config.plugin = [...existing];
    await atomicWriteJson(configPath(), config);
    return { configPath: configPath() };
  },

  async unconfigureHook() {
    const config = await readJsonOrEmpty(configPath());
    if (!config.plugin) return;
    config.plugin = config.plugin.filter((p) => p !== PLUGIN_PKG);
    await atomicWriteJson(configPath(), config);
  },
};
