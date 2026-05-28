/**
 * PlannotatorProvider — implements the `PlanProvider` contract by
 * orchestrating one plannotator subprocess per session, exposed via the
 * `/plan/:sessionId/*` reverse proxy.
 *
 * The agent's tunnel URL fronts the proxy in production; locally,
 * `http://localhost:3005/plan/<sessionId>/` works the same way.
 */

import { homedir as osHomedir } from "node:os";

import type { HostServices } from "@vibecontrols/plugin-sdk";

import type {
  ListSessionsFilter,
  PlanFeedback,
  PlanProvider,
  PlanProviderCapabilities,
  PlanSession,
  StartSessionRequest,
} from "./types.js";

import {
  getSessionEntry,
  listSessions,
  spawnPlannotator,
  stopSession,
  touchSession,
} from "./lib/process.js";

interface PersistedSession {
  id: string;
  projectId: string;
  status: PlanSession["status"];
  mode: PlanSession["mode"];
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
  origin?: string;
}

const NS = "plannotator-sessions";

function nowIso(): string {
  return new Date().toISOString();
}

export class PlannotatorProvider implements PlanProvider {
  readonly name = "plannotator";

  constructor(private readonly host: HostServices) {}

  getCapabilities(): PlanProviderCapabilities {
    return {
      modes: ["plan", "review", "annotate", "archive"],
      supportsStreaming: true,
      supportsVersionHistory: true,
      supportsAnnotations: true,
      supportsArchive: true,
      externallyHosted: false,
      prereqApiPrefix: "/api/plan-plannotator",
    };
  }

  async startSession(req: StartSessionRequest): Promise<PlanSession> {
    const id = crypto.randomUUID();
    const dataDir =
      this.host.getDataDir?.() ?? `${osHomedir()}/.boff/vibecontrols`;
    const { pid, port } = await spawnPlannotator(id, req, dataDir);

    const persisted: PersistedSession = {
      id,
      projectId: req.projectId,
      status: "active",
      mode: req.mode ?? "plan",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      origin: req.agent,
    };
    await this.host.storage?.set(NS, id, persisted);

    return {
      id,
      providerName: this.name,
      projectId: persisted.projectId,
      status: "active",
      mode: persisted.mode,
      createdAt: persisted.createdAt,
      updatedAt: persisted.updatedAt,
      uiUrl: `/plan/${id}/`,
      providerData: { pid, port, origin: req.agent ?? null },
    };
  }

  async getSession(id: string): Promise<PlanSession | null> {
    const persisted = await this.host.storage?.get<PersistedSession>(NS, id);
    if (!persisted) return null;

    const entry = getSessionEntry(id);
    let content: PlanSession["content"] | undefined;
    let status: PlanSession["status"] = persisted.status;

    if (entry) {
      try {
        const res = await fetch(`http://127.0.0.1:${entry.port}/api/plan`);
        if (res.ok) {
          const live = (await res.json()) as {
            plan?: string;
            origin?: string;
            previousPlan?: string;
            versionInfo?: { version?: number };
          };
          if (live.plan) {
            content = {
              markdown: live.plan,
              version: live.versionInfo?.version,
              origin: live.origin ?? persisted.origin,
              previousMarkdown: live.previousPlan,
            };
          }
        }
      } catch {
        // Live fetch failed — fall through with persisted state.
      }
      touchSession(id);
    } else if (status === "active") {
      // Process died unexpectedly — mark abandoned.
      status = "abandoned";
      const updated: PersistedSession = {
        ...persisted,
        status,
        updatedAt: nowIso(),
        endedAt: nowIso(),
      };
      await this.host.storage?.set(NS, id, updated);
    }

    return {
      id,
      providerName: this.name,
      projectId: persisted.projectId,
      status,
      mode: persisted.mode,
      createdAt: persisted.createdAt,
      updatedAt: persisted.updatedAt,
      endedAt: persisted.endedAt,
      uiUrl: entry ? `/plan/${id}/` : undefined,
      content,
      providerData: entry
        ? { pid: entry.pid, port: entry.port, origin: persisted.origin ?? null }
        : { origin: persisted.origin ?? null },
    };
  }

  async listSessions(filter?: ListSessionsFilter): Promise<PlanSession[]> {
    const ids =
      (await this.host.storage?.list?.(NS).catch(() => undefined)) ?? [];
    const all = await Promise.all(ids.map((id) => this.getSession(id)));
    const filtered = all.filter((s): s is PlanSession => {
      if (!s) return false;
      if (filter?.status && s.status !== filter.status) return false;
      if (filter?.projectId && s.projectId !== filter.projectId) return false;
      return true;
    });
    if (filter?.limit && filtered.length > filter.limit) {
      return filtered.slice(0, filter.limit);
    }
    return filtered;
  }

  async submitFeedback(
    id: string,
    feedback: PlanFeedback,
  ): Promise<PlanSession> {
    const entry = getSessionEntry(id);
    if (!entry) {
      throw new Error(`plannotator session '${id}' is not running`);
    }
    const path = feedback.decision === "approve" ? "/api/approve" : "/api/deny";
    const res = await fetch(`http://127.0.0.1:${entry.port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comment: feedback.comment ?? "",
        annotations: feedback.annotations ?? [],
      }),
    });
    if (!res.ok) {
      throw new Error(`plannotator feedback failed: ${res.status}`);
    }
    const persisted = await this.host.storage?.get<PersistedSession>(NS, id);
    const status = feedback.decision === "approve" ? "approved" : "denied";
    if (persisted) {
      const updated: PersistedSession = {
        ...persisted,
        status,
        updatedAt: nowIso(),
        endedAt: nowIso(),
      };
      await this.host.storage?.set(NS, id, updated);
    }
    // Stop the subprocess once feedback lands — the binary's job is done.
    void stopSession(id);

    return {
      id,
      providerName: this.name,
      projectId: persisted?.projectId ?? "",
      status,
      mode: persisted?.mode ?? "plan",
      createdAt: persisted?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
      endedAt: nowIso(),
      feedback,
    };
  }

  async endSession(id: string): Promise<void> {
    await stopSession(id);
    const persisted = await this.host.storage?.get<PersistedSession>(NS, id);
    if (persisted && persisted.status === "active") {
      const updated: PersistedSession = {
        ...persisted,
        status: "ended",
        updatedAt: nowIso(),
        endedAt: nowIso(),
      };
      await this.host.storage?.set(NS, id, updated);
    }
  }
}

export function getRunningSessionsSnapshot() {
  return listSessions().map((entry) => ({
    sessionId: entry.sessionId,
    pid: entry.pid,
    port: entry.port,
    mode: entry.mode,
    startedAt: new Date(entry.startedAt).toISOString(),
    lastActivity: new Date(entry.lastActivity).toISOString(),
  }));
}
