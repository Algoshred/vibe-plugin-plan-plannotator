import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { adapter } from "../../src/agent-integration/claude.js";

const realHome = homedir();
let fakeHome: string;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "vibe-plan-test-"));
  process.env.HOME = fakeHome;
  await mkdir(join(fakeHome, ".claude"), { recursive: true });
});

afterEach(async () => {
  process.env.HOME = realHome;
  await rm(fakeHome, { recursive: true, force: true });
});

describe("claude adapter", () => {
  it("detects ~/.claude as installed", async () => {
    const result = await adapter.detect();
    expect(result.installed).toBe(true);
    expect(result.configPath).toBe(join(fakeHome, ".claude", "hooks.json"));
  });

  it("configureHook writes a PreToolUse hook", async () => {
    await adapter.configureHook({
      agentApiKey: "test-key",
      agentBaseUrl: "http://localhost:3005",
    });
    const text = await readFile(
      join(fakeHome, ".claude", "hooks.json"),
      "utf8",
    );
    const config = JSON.parse(text);
    expect(config.hooks.PreToolUse).toHaveLength(1);
    expect(config.hooks.PreToolUse[0].source).toBe("vibe-plan-plannotator");
    expect(config.hooks.PreToolUse[0].matcher).toBe("ExitPlanMode");
  });

  it("configureHook is idempotent — never duplicates entries", async () => {
    await adapter.configureHook({
      agentApiKey: "k",
      agentBaseUrl: "http://x",
    });
    await adapter.configureHook({
      agentApiKey: "k2",
      agentBaseUrl: "http://y",
    });
    const text = await readFile(
      join(fakeHome, ".claude", "hooks.json"),
      "utf8",
    );
    const config = JSON.parse(text);
    expect(config.hooks.PreToolUse).toHaveLength(1);
    expect(config.hooks.PreToolUse[0].hooks[0].command).toContain("http://y");
  });

  it("preserves unrelated hooks during configureHook", async () => {
    const existing = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Read",
            hooks: [{ type: "command", command: "echo hi" }],
          },
        ],
      },
    };
    await writeFile(
      join(fakeHome, ".claude", "hooks.json"),
      JSON.stringify(existing),
      "utf8",
    );
    await adapter.configureHook({
      agentApiKey: "k",
      agentBaseUrl: "http://x",
    });
    const text = await readFile(
      join(fakeHome, ".claude", "hooks.json"),
      "utf8",
    );
    const config = JSON.parse(text);
    expect(config.hooks.PreToolUse).toHaveLength(2);
    expect(
      config.hooks.PreToolUse.some(
        (e: { matcher?: string }) => e.matcher === "Read",
      ),
    ).toBe(true);
  });

  it("isHookConfigured returns true after configure", async () => {
    await adapter.configureHook({
      agentApiKey: "k",
      agentBaseUrl: "http://x",
    });
    expect(await adapter.isHookConfigured()).toBe(true);
  });

  it("unconfigureHook removes the entry but keeps the file", async () => {
    await adapter.configureHook({
      agentApiKey: "k",
      agentBaseUrl: "http://x",
    });
    await adapter.unconfigureHook();
    const text = await readFile(
      join(fakeHome, ".claude", "hooks.json"),
      "utf8",
    );
    const config = JSON.parse(text);
    expect(config.hooks.PreToolUse).toEqual([]);
  });
});
