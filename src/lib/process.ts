/**
 * Per-session plannotator subprocess manager.
 *
 * Each plan session spawns its own plannotator HTTP server on a dedicated
 * port (preferred PLANNOTATOR_PORT, fall back scan 19432–19442). The
 * reverse proxy in `proxy.ts` routes `/plan/:sessionId/*` to the right
 * subprocess based on a sessionId → port map maintained here.
 *
 * Lifecycle: SIGTERM → 5 s grace → SIGKILL. Tracked PID + port stays in
 * the module-level map until `stopSession()` clears it (or the watchdog
 * times the session out).
 */

import type { Subprocess } from "bun";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { PlanMode, StartSessionRequest } from "../types.js";
import { ensureInstalled } from "./installer.js";

interface SessionEntry {
  sessionId: string;
  proc: Subprocess;
  pid: number;
  port: number;
  mode: PlanMode;
  workingDir: string;
  startedAt: number;
  lastActivity: number;
}

const sessions = new Map<string, SessionEntry>();

const DEFAULT_PORT = parseInt(process.env.PLANNOTATOR_PORT ?? "19432", 10);
const PORT_RANGE_END = DEFAULT_PORT + 10;

async function isPortAvailable(port: number): Promise<boolean> {
  try {
    const server = Bun.serve({
      port,
      hostname: "127.0.0.1",
      fetch: () => new Response(),
    });
    server.stop(true);
    return true;
  } catch {
    return false;
  }
}

async function findAvailablePort(preferred?: number): Promise<number> {
  const start = preferred ?? DEFAULT_PORT;
  if (await isPortAvailable(start)) return start;
  for (let port = DEFAULT_PORT; port <= PORT_RANGE_END; port++) {
    if (port === start) continue;
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(
    `No available port in range ${DEFAULT_PORT}-${PORT_RANGE_END}`,
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function buildPath(): string {
  // Ensure ~/.local/bin (where the installer writes the binary) is on
  // PATH for the spawned subprocess regardless of the parent shell init.
  const local = `${homedir()}/.local/bin`;
  const parent = process.env.PATH ?? "";
  if (parent.split(":").includes(local)) return parent;
  return `${local}:${parent}`;
}

/**
 * Build the plannotator argv for a session.
 *
 * `plan` and `annotate` both open plannotator's annotation server on the
 * plan markdown file (`annotate <file>`). Running the binary with *no*
 * subcommand is reserved for stdin hook-integration mode: plannotator reads
 * EOF and exits 0 immediately, so the HTTP server never binds and the spawn
 * is reported as "failed to start" (with empty stderr). So the default
 * `plan` mode must pass `annotate <planPath>`, not run bare.
 */
export function buildPlannotatorArgs(
  binaryPath: string,
  mode: PlanMode,
  planPath: string,
): string[] {
  const args: string[] = [binaryPath];
  if (mode === "review") args.push("review");
  else if (mode === "archive") args.push("archive");
  else args.push("annotate", planPath); // plan + annotate
  return args;
}

export async function spawnPlannotator(
  sessionId: string,
  req: StartSessionRequest,
  dataDir: string,
): Promise<{ pid: number; port: number; workingDir: string }> {
  const status = await ensureInstalled();
  if (!status.binaryPath) {
    throw new Error("plannotator binary path not resolved");
  }

  const port = await findAvailablePort();
  const sessionDir = join(dataDir, "plannotator", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });
  const planPath = join(sessionDir, "plan.md");
  if (req.prompt) {
    await writeFile(planPath, req.prompt, "utf8");
  } else {
    await writeFile(planPath, `# Plan\n`, "utf8");
  }

  const mode = req.mode ?? "plan";
  const args = buildPlannotatorArgs(status.binaryPath, mode, planPath);

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: dirname(planPath),
    env: {
      ...process.env,
      PATH: buildPath(),
      PLANNOTATOR_PORT: String(port),
      PLANNOTATOR_REMOTE: "1",
      PLANNOTATOR_ORIGIN: req.agent ?? "vibecontrols",
      PLANNOTATOR_BROWSER: "/bin/true",
      PLANNOTATOR_NO_BROWSER: "1",
    },
  });

  const entry: SessionEntry = {
    sessionId,
    proc,
    pid: proc.pid,
    port,
    mode,
    workingDir: dirname(planPath),
    startedAt: Date.now(),
    lastActivity: Date.now(),
  };
  sessions.set(sessionId, entry);

  // Cleanup on unexpected exit.
  void proc.exited.then((code) => {
    const current = sessions.get(sessionId);
    if (current && current.proc === proc) {
      sessions.delete(sessionId);
    }
    if (code !== 0 && code !== null) {
      process.stderr.write(
        `plannotator session ${sessionId} exited unexpectedly with code ${code}\n`,
      );
    }
  });

  // Give plannotator a moment to bind.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (!isProcessAlive(proc.pid)) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`plannotator failed to start: ${stderr.slice(0, 1024)}`);
  }

  return { pid: proc.pid, port, workingDir: entry.workingDir };
}

export function getSessionEntry(sessionId: string): SessionEntry | null {
  const entry = sessions.get(sessionId);
  if (!entry) return null;
  if (!isProcessAlive(entry.pid)) {
    sessions.delete(sessionId);
    return null;
  }
  return entry;
}

export function getPortForSession(sessionId: string): number | null {
  return getSessionEntry(sessionId)?.port ?? null;
}

export function touchSession(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (entry) entry.lastActivity = Date.now();
}

export async function stopSession(sessionId: string): Promise<void> {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  sessions.delete(sessionId);
  if (!isProcessAlive(entry.pid)) return;

  try {
    process.kill(entry.pid, "SIGTERM");
  } catch {
    return;
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && isProcessAlive(entry.pid)) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  if (isProcessAlive(entry.pid)) {
    try {
      process.kill(entry.pid, "SIGKILL");
    } catch {
      // Already dead.
    }
  }

  try {
    await entry.proc.exited;
  } catch {
    // Ignore.
  }
}

export async function stopAllSessions(): Promise<void> {
  const ids = [...sessions.keys()];
  await Promise.all(ids.map(stopSession));
}

export function listSessions(): SessionEntry[] {
  for (const [id, entry] of sessions) {
    if (!isProcessAlive(entry.pid)) sessions.delete(id);
  }
  return [...sessions.values()];
}
