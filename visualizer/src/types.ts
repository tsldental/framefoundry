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

export interface Note {
  id: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}
