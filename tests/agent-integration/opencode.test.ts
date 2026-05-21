import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { adapter } from "../../src/agent-integration/opencode.js";

const realHome = homedir();
let fakeHome: string;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "vibe-plan-opencode-"));
  process.env.HOME = fakeHome;
  await mkdir(join(fakeHome, ".config", "opencode"), { recursive: true });
});

afterEach(async () => {
  process.env.HOME = realHome;
  await rm(fakeHome, { recursive: true, force: true });
});

describe("opencode adapter", () => {
  it("adds @plannotator/opencode to the plugin array", async () => {
    await adapter.configureHook({
      agentApiKey: "k",
      agentBaseUrl: "http://x",
    });
    const text = await readFile(
      join(fakeHome, ".config", "opencode", "opencode.json"),
      "utf8",
    );
    expect(JSON.parse(text).plugin).toEqual(["@plannotator/opencode"]);
  });

  it("is idempotent — no duplicates", async () => {
    await adapter.configureHook({
      agentApiKey: "k",
      agentBaseUrl: "http://x",
    });
    await adapter.configureHook({
      agentApiKey: "k",
      agentBaseUrl: "http://x",
    });
    const text = await readFile(
      join(fakeHome, ".config", "opencode", "opencode.json"),
      "utf8",
    );
    expect(JSON.parse(text).plugin).toEqual(["@plannotator/opencode"]);
  });

  it("unconfigureHook removes only this entry", async () => {
    await adapter.configureHook({
      agentApiKey: "k",
      agentBaseUrl: "http://x",
    });
    // Manually inject an unrelated plugin to make sure we don't nuke it.
    const path = join(fakeHome, ".config", "opencode", "opencode.json");
    const text = await readFile(path, "utf8");
    const config = JSON.parse(text);
    config.plugin.push("@other/plugin");
    await Bun.write(path, JSON.stringify(config));
    await adapter.unconfigureHook();
    const after = JSON.parse(await readFile(path, "utf8"));
    expect(after.plugin).toEqual(["@other/plugin"]);
  });
});
