/**
 * IdleWatchdog — periodic scan that kills sessions whose `lastActivity`
 * is older than `IDLE_TIMEOUT_MS`. Avoids the plannotator CLI's default
 * 96 h hang behavior — a stale tab keeps the binary alive otherwise.
 */

import { listSessions, stopSession } from "./process.js";

let timer: ReturnType<typeof setInterval> | null = null;

export function startIdleWatchdog(): void {
  if (timer) return;
  const intervalMs = parseInt(
    process.env.VIBE_PLANNOTATOR_IDLE_SCAN_MS ?? "60000",
    10,
  );
  const idleMs = parseInt(
    process.env.VIBE_PLANNOTATOR_IDLE_MS ?? `${15 * 60 * 1000}`,
    10,
  );
  timer = setInterval(() => {
    const now = Date.now();
    for (const entry of listSessions()) {
      if (now - entry.lastActivity > idleMs) {
        void stopSession(entry.sessionId);
      }
    }
  }, intervalMs);
}

export function stopIdleWatchdog(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
