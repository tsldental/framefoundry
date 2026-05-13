import { CopilotClient, approveAll, defineTool, type CopilotSession } from "@github/copilot-sdk";
import { openFrameStore, type Frame, type JsonValue, type ToolRegistryEntry } from "./db";

interface ReplayPrompt {
  frameId: number;
  prompt: string;
}

interface RecordedToolCall {
  frameId: number;
  toolCallId: string;
  toolName: string;
  args: JsonValue;
  argsFingerprint: string;
  result: JsonValue;
}

interface PreparedReplayToolCall {
  replayToolCallFrameId: number;
  replayToolCallId: string;
  originalToolCallId: string;
  toolName: string;
  argsFingerprint: string;
  result: JsonValue;
  resolved: boolean;
}

interface ReplaySessionState {
  promptIndex: number;
  toolCallIndex: number;
  lastReplayUserFrameId: number | null;
  preparedToolCalls: PreparedReplayToolCall[];
}

export interface ReplayResult {
  originalSessionId: string;
  replaySessionId: string;
  assistantResponses: Array<string | null>;
  frames: Frame[];
  registryEntries: ToolRegistryEntry[];
}

export async function runReplay(sessionId: string): Promise<ReplayResult> {
  const db = openFrameStore();
  const sourceFrames = db.listFrames(sessionId);

  if (sourceFrames.length === 0) {
    db.close();
    throw new Error(`No recorded frames found for session "${sessionId}"`);
  }

  const replayPrompts = extractReplayPrompts(sourceFrames);
  const recordedToolCalls = extractRecordedToolCalls(db, sourceFrames);
  const replayState: ReplaySessionState = {
    promptIndex: 0,
    toolCallIndex: 0,
    lastReplayUserFrameId: null,
    preparedToolCalls: [],
  };
  const client = new CopilotClient({
    cwd: process.cwd(),
  });

  let replaySessionId: string | undefined;
  let session: CopilotSession | undefined;
  let workError: unknown;

  try {
    session = await client.createSession({
      onPermissionRequest: approveAll,
      workingDirectory: process.cwd(),
      tools: createReplayToolsForRecordedCalls(recordedToolCalls, replayState),
      hooks: {
        onUserPromptSubmitted(input, invocation) {
          const expectedPrompt = replayPrompts[replayState.promptIndex];

          if (!expectedPrompt) {
            throw new Error(
              `Replay session "${invocation.sessionId}" received an unexpected extra prompt`,
            );
          }

          if (expectedPrompt.prompt !== input.prompt) {
            throw new Error(
              `Replay prompt mismatch at frame ${expectedPrompt.frameId}: expected "${expectedPrompt.prompt}" but received "${input.prompt}"`,
            );
          }

          const frame = db.recordAgentTurn({
            sessionId: invocation.sessionId,
            role: "user",
            content: input.prompt,
            metadata: {
              is_replay: true,
              original_frame_id: expectedPrompt.frameId,
              original_session_id: sessionId,
              hook: "onUserPromptSubmitted",
              cwd: input.cwd,
              timestamp: input.timestamp,
            },
          });

          replayState.lastReplayUserFrameId = frame.id;
          replayState.promptIndex += 1;
        },
        onPreToolUse(input, invocation) {
          const nextRecordedToolCall = recordedToolCalls[replayState.toolCallIndex];

          if (!nextRecordedToolCall) {
            throw new Error(
              `Replay session "${invocation.sessionId}" requested unexpected tool "${input.toolName}"`,
            );
          }

          const normalizedArgs = toJsonValue(input.toolArgs);
          const argsFingerprint = fingerprintValue(normalizedArgs);

          if (
            nextRecordedToolCall.toolName !== input.toolName ||
            nextRecordedToolCall.argsFingerprint !== argsFingerprint
          ) {
            throw new Error(
              `Replay tool mismatch: expected ${nextRecordedToolCall.toolName} ${nextRecordedToolCall.argsFingerprint} but received ${input.toolName} ${argsFingerprint}`,
            );
          }

          const registryEntry = db.getRegistryEntry(nextRecordedToolCall.toolCallId);

          if (!registryEntry?.toolResult) {
            throw new Error(
              `Missing recorded tool result for toolCallId "${nextRecordedToolCall.toolCallId}"`,
            );
          }

          const replayToolCallFrame = db.recordToolCall({
            sessionId: invocation.sessionId,
            toolName: input.toolName,
            args: normalizedArgs,
            parentFrameId: replayState.lastReplayUserFrameId,
            metadata: {
              is_replay: true,
              original_frame_id: nextRecordedToolCall.frameId,
              original_session_id: sessionId,
              original_tool_call_id: nextRecordedToolCall.toolCallId,
              hook: "onPreToolUse",
              cwd: input.cwd,
              timestamp: input.timestamp,
            },
          });

          if (!replayToolCallFrame.toolCallId) {
            throw new Error(`Missing replay toolCallId for "${input.toolName}"`);
          }

          replayState.preparedToolCalls.push({
            replayToolCallFrameId: replayToolCallFrame.id,
            replayToolCallId: replayToolCallFrame.toolCallId,
            originalToolCallId: nextRecordedToolCall.toolCallId,
            toolName: input.toolName,
            argsFingerprint,
            result: registryEntry.toolResult,
            resolved: false,
          });
          replayState.toolCallIndex += 1;

          return {
            additionalContext:
              "Deterministic replay is active. Use the recorded tool result instead of performing a live call.",
            suppressOutput: true,
          };
        },
        onPostToolUse(input, invocation) {
          const normalizedArgs = toJsonValue(input.toolArgs);
          const preparedToolCall = findPreparedReplayToolCall(
            replayState,
            input.toolName,
            fingerprintValue(normalizedArgs),
          );

          if (!preparedToolCall) {
            throw new Error(
              `No prepared replay tool call found for "${input.toolName}" in session "${invocation.sessionId}"`,
            );
          }

          db.recordToolResult({
            sessionId: invocation.sessionId,
            toolName: input.toolName,
            toolCallId: preparedToolCall.replayToolCallId,
            result: toJsonValue(input.toolResult),
            parentFrameId: preparedToolCall.replayToolCallFrameId,
            metadata: {
              is_replay: true,
              original_session_id: sessionId,
              original_tool_call_id: preparedToolCall.originalToolCallId,
              hook: "onPostToolUse",
              cwd: input.cwd,
              timestamp: input.timestamp,
            },
          });

          preparedToolCall.resolved = true;
        },
      },
      onEvent(event) {
        if (event.type !== "assistant.message") {
          return;
        }

        if (!replaySessionId) {
          throw new Error("Assistant message received before the replay session ID was initialized");
        }

        db.recordAgentTurn({
          sessionId: replaySessionId,
          role: "assistant",
          content: event.data.content,
          parentFrameId: replayState.lastReplayUserFrameId,
          metadata: {
            is_replay: true,
            original_session_id: sessionId,
            eventType: event.type,
          },
        });
      },
    });

    replaySessionId = session.sessionId;
    db.recordFrame({
      sessionId: replaySessionId,
      frameType: "system_event",
      role: "system",
      content: {
        event: "replay_session_started",
        originalSessionId: sessionId,
      },
      metadata: {
        is_replay: true,
        original_session_id: sessionId,
      },
    });

    const assistantResponses: Array<string | null> = [];

    for (const replayPrompt of replayPrompts) {
      const assistantMessage = await session.sendAndWait({ prompt: replayPrompt.prompt });
      assistantResponses.push(assistantMessage?.data.content ?? null);
    }

    if (replayState.toolCallIndex !== recordedToolCalls.length) {
      throw new Error(
        `Replay ended after consuming ${replayState.toolCallIndex} of ${recordedToolCalls.length} recorded tool calls`,
      );
    }

    return {
      originalSessionId: sessionId,
      replaySessionId,
      assistantResponses,
      frames: db.listFrames(replaySessionId),
      registryEntries: db.listRegistryEntries(replaySessionId),
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
      throw new AggregateError(cleanupErrors, "Failed to clean up the replay session");
    }
  }
}

function extractReplayPrompts(frames: Frame[]): ReplayPrompt[] {
  const prompts: ReplayPrompt[] = [];

  for (const frame of frames) {
    if (frame.frameType !== "llm_turn" || frame.role !== "user" || isReplayFrame(frame)) {
      continue;
    }

    prompts.push({
      frameId: frame.id,
      prompt: getRecordedTurnContent(frame),
    });
  }

  if (prompts.length === 0) {
    throw new Error("Replay requires at least one recorded user prompt");
  }

  return prompts;
}

function extractRecordedToolCalls(db: ReturnType<typeof openFrameStore>, frames: Frame[]): RecordedToolCall[] {
  const toolCalls: RecordedToolCall[] = [];

  for (const frame of frames) {
    if (frame.frameType !== "tool_call" || isReplayFrame(frame)) {
      continue;
    }

    if (!frame.toolCallId || !frame.toolName) {
      throw new Error(`Recorded tool call frame ${frame.id} is missing tool metadata`);
    }

    const registryEntry = db.getRegistryEntry(frame.toolCallId);

    if (!registryEntry?.toolResult) {
      throw new Error(`No recorded tool result found for toolCallId "${frame.toolCallId}"`);
    }

    const args = getRecordedToolArgs(frame);
    toolCalls.push({
      frameId: frame.id,
      toolCallId: frame.toolCallId,
      toolName: frame.toolName,
      args,
      argsFingerprint: fingerprintValue(args),
      result: registryEntry.toolResult,
    });
  }

  return toolCalls;
}

function createReplayToolsForRecordedCalls(recordedToolCalls: RecordedToolCall[], replayState: ReplaySessionState) {
  const uniqueToolNames = [...new Set(recordedToolCalls.map((recordedToolCall) => recordedToolCall.toolName))];

  return uniqueToolNames.map((toolName) =>
    defineTool<JsonValue>(toolName, {
      description: `Deterministic replay stub for the recorded ${toolName} tool.`,
      parameters: {
        type: "object",
        additionalProperties: true,
      },
      overridesBuiltInTool: true,
      skipPermission: true,
      handler(args) {
        const argsFingerprint = fingerprintValue(toJsonValue(args));
        const preparedToolCall = findPreparedReplayToolCall(replayState, toolName, argsFingerprint);

        if (!preparedToolCall) {
          throw new Error(
            `Replay stub for "${toolName}" was invoked without a prepared recorded result`,
          );
        }

        return preparedToolCall.result;
      },
    }),
  );
}

function findPreparedReplayToolCall(
  replayState: ReplaySessionState,
  toolName: string,
  argsFingerprint: string,
): PreparedReplayToolCall | undefined {
  for (let index = replayState.preparedToolCalls.length - 1; index >= 0; index -= 1) {
    const candidate = replayState.preparedToolCalls[index];

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

function getRecordedTurnContent(frame: Frame): string {
  if (typeof frame.content !== "object" || frame.content === null || Array.isArray(frame.content)) {
    throw new Error(`Frame ${frame.id} does not contain a valid recorded turn payload`);
  }

  const content = frame.content.content;

  if (typeof content !== "string") {
    throw new Error(`Frame ${frame.id} is missing its recorded turn content`);
  }

  return content;
}

function getRecordedToolArgs(frame: Frame): JsonValue {
  if (typeof frame.content !== "object" || frame.content === null || Array.isArray(frame.content)) {
    throw new Error(`Frame ${frame.id} does not contain a valid recorded tool payload`);
  }

  return toJsonValue(frame.content.args);
}

function isReplayFrame(frame: Frame): boolean {
  if (typeof frame.metadata !== "object" || frame.metadata === null || Array.isArray(frame.metadata)) {
    return false;
  }

  return frame.metadata.is_replay === true;
}

function fingerprintValue(value: JsonValue): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: JsonValue): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  const sortedEntries = Object.entries(value).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );
  const sortedObject: Record<string, JsonValue> = {};

  for (const [key, entry] of sortedEntries) {
    sortedObject[key] = sortJsonValue(entry);
  }

  return sortedObject;
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
