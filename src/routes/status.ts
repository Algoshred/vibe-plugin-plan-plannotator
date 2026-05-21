import { Elysia } from "elysia";

import { checkInstalled } from "../lib/installer.js";
import { getRunningSessionsSnapshot } from "../provider.js";

export function createStatusRoute() {
  return new Elysia().get("/status", async () => {
    const installed = await checkInstalled();
    return {
      installed: installed.installed,
      installedPath: installed.binaryPath,
      version: installed.version,
      runningSessions: getRunningSessionsSnapshot(),
    };
  });
}
