export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface Frame {
  id: number;
  sessionId: string;
  sequence: number;
  frameType: "llm_turn" | "tool_call" | "tool_result" | "system_event";
  parentFrameId: number | null;
  branchRootFrameId: number | null;
  role: "user" | "assistant" | "system" | "tool" | null;
  toolName: string | null;
  toolCallId: string | null;
  content: JsonValue;
  metadata: JsonValue;
  createdAt: string;
}

export interface SessionSummary {
  sessionId: string;
  parentSessionId: string | null;
  branchRootFrameId: number | null;
  createdAt: string;
  lastUpdatedAt: string;
  frameCount: number;
  childCount: number;
  headline: string;
  latestSummary: string;
}

export interface ProjectContext {
  name: string;
  projectPath: string;
  dbPath: string;
  configPath?: string | null;
  snapshotMode?: "prompt" | "assistant" | "off";
  retentionPolicy?: {
    snapshotsPerSession: number;
    backupsPerSession: number;
  };
}

export interface SessionsResponse {
  sessionIds: string[];
  sessions: SessionSummary[];
  project?: ProjectContext;
}

export interface SessionFramesResponse {
  sessionId: string;
  frames: Frame[];
}

export interface WorkspaceRestoreResult {
  available: boolean;
  applied: boolean;
  repoRoot: string | null;
  snapshotCommit: string | null;
  snapshotRef: string | null;
  restoredBranch: string | null;
  backupRef: string | null;
  snapshotFrameId: number | null;
  reason: string | null;
}

export interface ForkPreviewResult {
  originalSessionId: string;
  startFrameId: number;
  latestSnapshotFrameId: number | null;
  restorePlan: {
    available: boolean;
    repoRoot: string | null;
    plannedBranch: string | null;
    backupRefPrefix: string | null;
    snapshotCommit: string | null;
    snapshotRef: string | null;
    snapshotFrameId: number | null;
    reason: string | null;
  };
}

export interface ResumeResult {
  originalSessionId: string;
  resumedSessionId: string;
  assistantResponse: string | null;
  resumeCommand: string;
  frames: Frame[];
  registryEntries: unknown[];
}

export interface SessionCompareResult {
  sessionId: string;
  compareTarget: {
    sessionId: string;
    headline: string;
    reason: "fork_source" | "resume_source" | "parent";
  } | null;
  branchRootFrameId: number | null;
  sourceFrameId: number | null;
  inheritedFrameCount: number;
  newFrameCount: number;
  currentFrameCount: number;
  targetFrameCount: number | null;
  currentAssistantCount: number;
  targetAssistantCount: number | null;
  currentToolCallCount: number;
  targetToolCallCount: number | null;
  currentLatestSummary: string;
  targetLatestSummary: string | null;
  comparisonSummary: string;
}

export interface Note {
  id: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}
