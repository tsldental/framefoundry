import { CopilotClient, approveAll, defineTool, type CopilotSession } from "@github/copilot-sdk";
import {
  openFrameStore,
  resolveDavmPaths,
  type DavmRuntimeOptions,
  type JsonValue,
  type ToolRegistryEntry,
  type Frame,
} from "./db";

const SESSION_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

interface SearchDocsArgs {
  query: string;
}

interface PendingToolCall {
  frameId: number;
  toolCallId: string;
  toolName: string;
  argsFingerprint: string;
  resolved: boolean;
}

interface SessionRecordingState {
  lastUserFrameId: number | null;
  pendingToolCalls: PendingToolCall[];
}

export interface AgentDemoResult {
  sessionId: string;
  assistantResponse: string | null;
  frames: Frame[];
  registryEntries: ToolRegistryEntry[];
}

export function createSearchDocsTool() {
  return defineTool<SearchDocsArgs>("SearchDocs", {
    description: "Search the documentation index and return a dummy result for replay testing.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The documentation search query.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    skipPermission: true,
    async handler(args) {
      return `Dummy SearchDocs result for "${args.query}".`;
    },
  });
}

export async function runAgentDemo(
  prompt: string,
  options: DavmRuntimeOptions = {},
): Promise<AgentDemoResult> {
  const paths = resolveDavmPaths(options);
  const db = openFrameStore(paths);
  const sessionStateById = new Map<string, SessionRecordingState>();
  const client = new CopilotClient({
    cwd: paths.projectPath,
  });

  let activeSessionId: string | undefined;
  let session: CopilotSession | undefined;
  let workError: unknown;

  try {
    session = await client.createSession({
      onPermissionRequest: approveAll,
      workingDirectory: paths.projectPath,
      tools: [createSearchDocsTool()],
      hooks: {
        onUserPromptSubmitted(input, invocation) {
          const state = getSessionRecordingState(sessionStateById, invocation.sessionId);
          const frame = db.recordAgentTurn({
            sessionId: invocation.sessionId,
            role: "user",
            content: input.prompt,
            metadata: {
              cwd: input.cwd,
              hook: "onUserPromptSubmitted",
              timestamp: input.timestamp,
            },
          });

          state.lastUserFrameId = frame.id;

          return {
            additionalContext:
              "Before answering, call the SearchDocs tool once using the user's prompt as the query.",
          };
        },
        onPreToolUse(input, invocation) {
          const state = getSessionRecordingState(sessionStateById, invocation.sessionId);
          const normalizedArgs = toJsonValue(input.toolArgs);
          const frame = db.recordToolCall({
            sessionId: invocation.sessionId,
            toolName: input.toolName,
            args: normalizedArgs,
            parentFrameId: state.lastUserFrameId,
            metadata: {
              cwd: input.cwd,
              hook: "onPreToolUse",
              timestamp: input.timestamp,
            },
          });

          if (!frame.toolCallId) {
            throw new Error(`Missing toolCallId for recorded tool call "${input.toolName}"`);
          }

          state.pendingToolCalls.push({
            frameId: frame.id,
            toolCallId: frame.toolCallId,
            toolName: input.toolName,
            argsFingerprint: fingerprintValue(normalizedArgs),
            resolved: false,
          });
        },
        onPostToolUse(input, invocation) {
          const state = getSessionRecordingState(sessionStateById, invocation.sessionId);
          const normalizedArgs = toJsonValue(input.toolArgs);
          const pendingToolCall = findPendingToolCall(
            state,
            input.toolName,
            fingerprintValue(normalizedArgs),
          );

          if (!pendingToolCall) {
            throw new Error(
              `No pending tool call found for "${input.toolName}" in session "${invocation.sessionId}"`,
            );
          }

          db.recordToolResult({
            sessionId: invocation.sessionId,
            toolName: input.toolName,
            toolCallId: pendingToolCall.toolCallId,
            result: toJsonValue(input.toolResult),
            parentFrameId: pendingToolCall.frameId,
            metadata: {
              cwd: input.cwd,
              hook: "onPostToolUse",
              timestamp: input.timestamp,
            },
          });

          pendingToolCall.resolved = true;
        },
      },
      onEvent(event) {
        if (event.type !== "assistant.message") {
          return;
        }

        if (!activeSessionId) {
          throw new Error("Assistant message received before the session ID was initialized");
        }

        const state = getSessionRecordingState(sessionStateById, activeSessionId);
        db.recordAgentTurn({
          sessionId: activeSessionId,
          role: "assistant",
          content: event.data.content,
          parentFrameId: state.lastUserFrameId,
          metadata: {
            eventType: event.type,
          },
        });
      },
    });

    activeSessionId = session.sessionId;
    const assistantMessage = await session.sendAndWait(
      { prompt },
      SESSION_IDLE_TIMEOUT_MS,
    );
    const assistantResponse = assistantMessage?.data.content ?? null;

    return {
      sessionId: session.sessionId,
      assistantResponse,
      frames: db.listFrames(session.sessionId),
      registryEntries: db.listRegistryEntries(session.sessionId),
    };
  } catch (error) {
    workError = error;
    throw error;
  } finally {
    const cleanupErrors: Error[] = [];

    if (session) {
      try {
        await session.disconnect();
      } catch (error) {
        cleanupErrors.push(asError(error));
      }
    }

    try {
      cleanupErrors.push(...(await client.stop()));
    } catch (error) {
      cleanupErrors.push(asError(error));
    }

    db.close();

    if (!workError && cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "Failed to clean up the agent demo");
    }
  }
}

function getSessionRecordingState(
  sessionStateById: Map<string, SessionRecordingState>,
  sessionId: string,
): SessionRecordingState {
  const existingState = sessionStateById.get(sessionId);

  if (existingState) {
    return existingState;
  }

  const nextState: SessionRecordingState = {
    lastUserFrameId: null,
    pendingToolCalls: [],
  };

  sessionStateById.set(sessionId, nextState);
  return nextState;
}

function fingerprintValue(value: JsonValue): string {
  return JSON.stringify(value);
}

function findPendingToolCall(
  state: SessionRecordingState,
  toolName: string,
  argsFingerprint: string,
): PendingToolCall | undefined {
  for (let index = state.pendingToolCalls.length - 1; index >= 0; index -= 1) {
    const candidate = state.pendingToolCalls[index];

    if (
      !candidate.resolved &&
      candidate.toolName === toolName &&
      candidate.argsFingerprint === argsFingerprint
    ) {
      return candidate;
    }
  }

  return undefined;
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    const normalizedObject: Record<string, JsonValue> = {};

    for (const [key, entry] of Object.entries(value)) {
      normalizedObject[key] = toJsonValue(entry);
    }

    return normalizedObject;
  }

  return String(value);
}

function asError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}
