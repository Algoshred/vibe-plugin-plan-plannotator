/**
 * Vendored copy of the public `PlanProvider` contract from
 * `@vibecontrols/vibe-plugin-plan`. We re-declare it here rather than
 * importing it so this provider can publish independently of the meta
 * plugin's release cadence. Once both packages share a stable release,
 * we can switch to a peerDependency import — until then, keep these
 * shapes byte-identical with `vibe-plugin-plan/src/types.ts`.
 */

export type PlanMode = "plan" | "review" | "annotate" | "archive";

export type PlanSessionStatus =
  | "pending"
  | "active"
  | "approved"
  | "denied"
  | "abandoned"
  | "ended";

export interface PlanProviderCapabilities {
  modes: PlanMode[];
  supportsStreaming: boolean;
  supportsVersionHistory: boolean;
  supportsAnnotations: boolean;
  supportsArchive: boolean;
  externallyHosted: boolean;
  prereqApiPrefix?: string;
}

export interface PlanContent {
  markdown: string;
  version?: number;
  origin?: string;
  previousMarkdown?: string;
}

export interface PlanAnnotation {
  id: string;
  selector: string;
  text: string;
  author?: string;
  createdAt: string;
}

export interface PlanFeedback {
  decision: "approve" | "deny";
  comment?: string;
  annotations?: PlanAnnotation[];
}

export interface PlanSession {
  id: string;
  providerName: string;
  projectId: string;
  status: PlanSessionStatus;
  mode: PlanMode;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
  uiUrl?: string;
  content?: PlanContent;
  feedback?: PlanFeedback;
  providerData?: Record<string, unknown>;
}

export interface StartSessionRequest {
  projectId: string;
  prompt?: string;
  mode?: PlanMode;
  agent?: string;
  timeoutMs?: number;
}

export interface ListSessionsFilter {
  status?: PlanSessionStatus;
  projectId?: string;
  provider?: string;
  limit?: number;
}

export interface PlanProvider {
  readonly name: string;
  getCapabilities(): PlanProviderCapabilities;
  startSession(req: StartSessionRequest): Promise<PlanSession>;
  getSession(id: string): Promise<PlanSession | null>;
  listSessions(filter?: ListSessionsFilter): Promise<PlanSession[]>;
  submitFeedback(id: string, feedback: PlanFeedback): Promise<PlanSession>;
  endSession(id: string): Promise<void>;
  streamSession?(id: string): AsyncIterable<PlanContent>;
}

// ─────────────────────────────────────────────────────────────────────
// Plannotator-specific shapes
// ─────────────────────────────────────────────────────────────────────

export type SupportedAgent = "claude" | "opencode" | "codex" | "pi" | "gemini";

export interface AgentDetectionResult {
  agent: SupportedAgent;
  /** Display name for the wizard UI. */
  name: string;
  /** True if the agent's CLI / config directory is present on disk. */
  cliInstalled: boolean;
  /** True if the plannotator hook is currently configured for this agent. */
  hookConfigured: boolean;
  /** Path the hook config is written to. */
  configPath: string;
  /** Free-form instructions shown to the user in the wizard. */
  instructions: string;
}

export interface PlannotatorStatus {
  installed: boolean;
  installedPath?: string;
  version?: string;
  runningSessions: Array<{
    sessionId: string;
    pid: number;
    port: number;
    mode: PlanMode;
    startedAt: string;
    lastActivity: string;
  }>;
}
