/**
 * Plannotator binary installer.
 *
 * The upstream install script (https://plannotator.ai/install.sh) downloads
 * a pre-compiled binary to ~/.local/bin/plannotator. We:
 *   1. Fetch the script (no network egress until invoked).
 *   2. Compute sha256 and compare against the pinned hash in
 *      `installer-manifest.json`.
 *   3. Refuse to execute on mismatch unless
 *      `VIBE_PLANNOTATOR_INSTALL_UNPINNED=1` is set.
 *   4. Pipe to `bash` only after the hash matches.
 *
 * `~/.local/bin` is prepended to spawned subprocess `PATH` by the process
 * manager, so callers don't need shell-init hacks.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

interface InstallerManifest {
  sourceUrl: string;
  sha256: string;
  fetchedAt: string;
}

function loadManifest(): InstallerManifest {
  // The manifest is copied next to the bundled output by the build script;
  // during local dev (running through bun), it lives alongside the source.
  const candidates = [
    join(moduleDir, "installer-manifest.json"),
    join(moduleDir, "lib", "installer-manifest.json"),
    join(moduleDir, "..", "lib", "installer-manifest.json"),
  ];
  for (const path of candidates) {
    try {
      const text = readFileSync(path, "utf8");
      return JSON.parse(text) as InstallerManifest;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("installer-manifest.json not found");
}

export interface InstallStatus {
  installed: boolean;
  binaryPath?: string;
  version?: string;
}

export async function checkInstalled(): Promise<InstallStatus> {
  const candidates = [
    Bun.which?.("plannotator") ?? undefined,
    `${homedir()}/.local/bin/plannotator`,
  ].filter((p): p is string => typeof p === "string");

  for (const path of candidates) {
    try {
      const file = Bun.file(path);
      if (await file.exists()) {
        let version: string | undefined;
        try {
          const proc = Bun.spawnSync([path, "--version"]);
          version = new TextDecoder().decode(proc.stdout).trim() || undefined;
        } catch {
          // Best effort — binary present but `--version` failed.
        }
        return { installed: true, binaryPath: path, version };
      }
    } catch {
      // Try the next candidate.
    }
  }
  return { installed: false };
}

export interface InstallResult {
  success: boolean;
  error?: string;
  binaryPath?: string;
  version?: string;
}

export async function runInstall(): Promise<InstallResult> {
  const manifest = loadManifest();
  const unpinned = process.env.VIBE_PLANNOTATOR_INSTALL_UNPINNED === "1";

  let scriptText: string;
  try {
    const response = await fetch(manifest.sourceUrl, {
      headers: { Accept: "text/plain" },
    });
    if (!response.ok) {
      return {
        success: false,
        error: `installer fetch failed: HTTP ${response.status}`,
      };
    }
    scriptText = await response.text();
  } catch (err) {
    return {
      success: false,
      error: `installer fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const sha256 = createHash("sha256").update(scriptText).digest("hex");
  if (!unpinned && sha256 !== manifest.sha256) {
    return {
      success: false,
      error: `installer sha256 mismatch: expected ${manifest.sha256}, got ${sha256}. Set VIBE_PLANNOTATOR_INSTALL_UNPINNED=1 to bypass (NOT recommended).`,
    };
  }

  const proc = Bun.spawn(["bash", "-s"], {
    stdin: new Response(scriptText).body ?? undefined,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    return {
      success: false,
      error: `installer exited ${exitCode}: ${stderr.slice(0, 4096)}`,
    };
  }

  const status = await checkInstalled();
  if (!status.installed || !status.binaryPath) {
    return {
      success: false,
      error: "installer completed but plannotator binary not found",
    };
  }
  return {
    success: true,
    binaryPath: status.binaryPath,
    version: status.version,
  };
}

export async function ensureInstalled(opts?: {
  autoInstall?: boolean;
}): Promise<InstallStatus> {
  const status = await checkInstalled();
  if (status.installed) return status;

  const auto =
    opts?.autoInstall ?? process.env.VIBE_PLANNOTATOR_AUTOINSTALL === "1";
  if (!auto) {
    const error = new Error(
      "plannotator binary not installed. POST /api/plan-plannotator/install to install, or set VIBE_PLANNOTATOR_AUTOINSTALL=1.",
    );
    (error as Error & { code?: string }).code = "PREREQ_MISSING";
    throw error;
  }

  const result = await runInstall();
  if (!result.success) {
    throw new Error(`plannotator install failed: ${result.error}`);
  }
  return {
    installed: true,
    binaryPath: result.binaryPath,
    version: result.version,
  };
}
