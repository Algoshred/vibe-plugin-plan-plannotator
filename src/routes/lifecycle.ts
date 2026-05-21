import { Elysia } from "elysia";

import { checkInstalled, runInstall } from "../lib/installer.js";
import { stopAllSessions, stopSession } from "../lib/process.js";

export function createLifecycleRoutes() {
  return new Elysia()
    .post("/install", async ({ set }) => {
      const before = await checkInstalled();
      if (before.installed) {
        return { ok: true, alreadyInstalled: true, path: before.binaryPath };
      }
      const result = await runInstall();
      if (!result.success) {
        set.status = 500;
        return { ok: false, error: result.error };
      }
      return {
        ok: true,
        path: result.binaryPath,
        version: result.version,
      };
    })
    .get("/prereqs", async () => {
      const status = await checkInstalled();
      return {
        installed: status.installed,
        path: status.binaryPath,
        version: status.version,
        autoInstall: process.env.VIBE_PLANNOTATOR_AUTOINSTALL === "1",
      };
    })
    .post("/prereqs/install", async ({ set }) => {
      const before = await checkInstalled();
      if (before.installed) return { ok: true, alreadyInstalled: true };
      const result = await runInstall();
      if (!result.success) {
        set.status = 500;
        return { ok: false, error: result.error };
      }
      return { ok: true, path: result.binaryPath };
    })
    .post("/stop", async ({ query }) => {
      if (query.sessionId) {
        await stopSession(query.sessionId);
        return { ok: true, stopped: query.sessionId };
      }
      await stopAllSessions();
      return { ok: true, stoppedAll: true };
    });
}
