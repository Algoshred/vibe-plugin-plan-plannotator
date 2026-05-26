import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { HostServices } from "@vibecontrols/plugin-sdk";

import { createAgentRoutes } from "../../src/routes/agents.js";

// The route never touches host services — only the adapter (which writes to
// ~/.claude under a fake HOME below). A bare cast keeps the test focused.
const host = {} as unknown as HostServices;

const realHome = homedir();
let fakeHome: string;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "vibe-plan-routes-test-"));
  process.env.HOME = fakeHome;
  await mkdir(join(fakeHome, ".claude"), { recursive: true });
});

afterEach(async () => {
  process.env.HOME = realHome;
  await rm(fakeHome, { recursive: true, force: true });
});

function configureHookRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://local/agents/claude/configure-hook", {
    method: "POST",
    headers,
  });
}

async function readClaudeHookCommand(): Promise<string> {
  const cfg = JSON.parse(
    await readFile(join(fakeHome, ".claude", "hooks.json"), "utf8"),
  ) as {
    hooks: { PreToolUse: { hooks: { command: string }[] }[] };
  };
  return cfg.hooks.PreToolUse[0].hooks[0].command;
}

describe("createAgentRoutes — configure-hook agent-key resolution", () => {
  it("falls back to the x-agent-api-key request header when the cfg key is null", async () => {
    // Reproduces the agent runtimes that don't surface the key via the elysia
    // decorator / AGENT_API_KEY env (getAgentApiKey() === null). The caller's
    // header is a valid agent key and must be used.
    const app = createAgentRoutes(host, {
      getAgentApiKey: () => null,
      getAgentBaseUrl: () => "http://localhost:3005",
    });

    const res = await app.handle(
      configureHookRequest({ "x-agent-api-key": "header-key-123" }),
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(await readClaudeHookCommand()).toContain("header-key-123");
  });

  it("prefers the configured agent key over the request header", async () => {
    const app = createAgentRoutes(host, {
      getAgentApiKey: () => "cfg-key-abc",
      getAgentBaseUrl: () => "http://localhost:3005",
    });

    const res = await app.handle(
      configureHookRequest({ "x-agent-api-key": "header-key-123" }),
    );

    expect(res.status).toBe(200);
    const command = await readClaudeHookCommand();
    expect(command).toContain("cfg-key-abc");
    expect(command).not.toContain("header-key-123");
  });

  it("returns 500 when neither the cfg key nor the request header is present", async () => {
    const app = createAgentRoutes(host, {
      getAgentApiKey: () => null,
      getAgentBaseUrl: () => "http://localhost:3005",
    });

    const res = await app.handle(configureHookRequest());

    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Agent API key not available");
  });
});
