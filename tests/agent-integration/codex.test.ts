import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { adapter } from "../../src/agent-integration/codex.js";

const realHome = homedir();
let fakeHome: string;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "vibe-plan-codex-"));
  process.env.HOME = fakeHome;
  await mkdir(join(fakeHome, ".codex"), { recursive: true });
});

afterEach(async () => {
  process.env.HOME = realHome;
  await rm(fakeHome, { recursive: true, force: true });
});

describe("codex adapter", () => {
  it("configureHook injects a marked block into config.toml", async () => {
    await adapter.configureHook({
      agentApiKey: "abc",
      agentBaseUrl: "http://localhost:3005",
    });
    const text = await readFile(
      join(fakeHome, ".codex", "config.toml"),
      "utf8",
    );
    expect(text).toContain("# <vibe-plan-plannotator:start>");
    expect(text).toContain("# <vibe-plan-plannotator:end>");
    expect(text).toContain("[hooks.plannotator]");
  });

  it("configureHook is idempotent", async () => {
    await adapter.configureHook({
      agentApiKey: "a",
      agentBaseUrl: "http://x",
    });
    await adapter.configureHook({
      agentApiKey: "b",
      agentBaseUrl: "http://y",
    });
    const text = await readFile(
      join(fakeHome, ".codex", "config.toml"),
      "utf8",
    );
    const startCount = (text.match(/<vibe-plan-plannotator:start>/g) ?? [])
      .length;
    expect(startCount).toBe(1);
    expect(text).toContain("http://y");
    expect(text).not.toContain("http://x");
  });

  it("preserves preceding user content", async () => {
    await writeFile(
      join(fakeHome, ".codex", "config.toml"),
      `# user comment\n[other]\nfoo = "bar"\n`,
      "utf8",
    );
    await adapter.configureHook({
      agentApiKey: "k",
      agentBaseUrl: "http://x",
    });
    const text = await readFile(
      join(fakeHome, ".codex", "config.toml"),
      "utf8",
    );
    expect(text).toContain("[other]");
    expect(text).toContain('foo = "bar"');
  });

  it("unconfigureHook strips the block but keeps user content", async () => {
    await writeFile(
      join(fakeHome, ".codex", "config.toml"),
      `[other]\nfoo = "bar"\n`,
      "utf8",
    );
    await adapter.configureHook({
      agentApiKey: "k",
      agentBaseUrl: "http://x",
    });
    await adapter.unconfigureHook();
    const text = await readFile(
      join(fakeHome, ".codex", "config.toml"),
      "utf8",
    );
    expect(text).not.toContain("vibe-plan-plannotator");
    expect(text).toContain('foo = "bar"');
  });
});
