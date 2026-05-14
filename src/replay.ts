import {
  CopilotClient,
  approveAll,
  defineTool,
  type CopilotSession,
  type Tool,
} from "@github/copilot-sdk";
import { platform } from "node:os";
import { createSearchDocsTool } from "./agent";
import {
  openFrameStore,
  resolveDavmPaths,
  type DavmRuntimeOptions,
  type Frame,
  type JsonValue,
  type ToolRegistryEntry,
} from "./db";
import {
  captureGitSnapshot,
  planForkRestore,
  restoreGitSnapshotForFork,
  type ForkRestorePlan,
  type GitSnapshotMetadata,
  type GitWorkspaceRestoreResult,
} from "./git";

const SESSION_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

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
  originalToolCallId: string | null;
  toolName: string;
  argsFingerprint: string;
  result: JsonValue;
  resolved: boolean;
  source: "replay" | "live";
}

interface ReplaySessionState {
  promptIndex: number;
  toolCallIndex: number;
  lastReplayUserFrameId: number | null;
  lastAssistantFrameId: number | null;
  preparedToolCalls: PreparedReplayToolCall[];
  lastSubmittedPromptSource: "replay" | "fork" | null;
}

export interface ReplayResult {
  originalSessionId: string;
  replaySessionId: string;
  assistantResponses: Array<string | null>;
  frames: Frame[];
  registryEntries: ToolRegistryEntry[];
}

export interface ForkResult {
  originalSessionId: string;
  startFrameId: number;
  forkSessionId: string;
  assistantResponse: string | null;
  workspaceRestore: GitWorkspaceRestoreResult;
  resumeCommand: string;
  frames: Frame[];
  registryEntries: ToolRegistryEntry[];
}

export interface ForkPreviewResult {
  originalSessionId: string;
  startFrameId: number;
  latestSnapshotFrameId: number | null;
  restorePlan: ForkRestorePlan;
}

export interface ResumeResult {
  originalSessionId: string;
  resumedSessionId: string;
  assistantResponse: string | null;
  resumeCommand: string;
  frames: Frame[];
  registryEntries: ToolRegistryEntry[];
}

export async function runReplay(
  sessionId: string,
  options: DavmRuntimeOptions = {},
): Promise<ReplayResult> {
  const paths = resolveDavmPaths(options);
  const db = openFrameStore(paths);
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
    lastAssistantFrameId: null,
    preparedToolCalls: [],
    lastSubmittedPromptSource: null,
  };
  const client = new CopilotClient({
    cwd: paths.projectPath,
  });

  let replaySessionId: string | undefined;
  let session: CopilotSession | undefined;
  let workError: unknown;

  try {
    session = await client.createSession({
      onPermissionRequest: approveAll,
      workingDirectory: paths.projectPath,
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
          replayState.lastSubmittedPromptSource = "replay";

          const nextRecordedToolCall = recordedToolCalls[replayState.toolCallIndex];

          if (nextRecordedToolCall) {
            return {
              additionalContext: `To match the recorded history, call ${nextRecordedToolCall.toolName} with these exact arguments before answering: ${JSON.stringify(nextRecordedToolCall.args)}.`,
            };
          }
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
            source: "replay",
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

        const frame = db.recordAgentTurn({
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

        replayState.lastAssistantFrameId = frame.id;
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
      const assistantMessage = await session.sendAndWait(
        { prompt: replayPrompt.prompt },
        SESSION_IDLE_TIMEOUT_MS,
      );
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

export async function runFork(
  originalSessionId: string,
  startFrameId: number,
  newPrompt: string,
  options: DavmRuntimeOptions = {},
): Promise<ForkResult> {
  const paths = resolveDavmPaths(options);
  const db = openFrameStore(paths);
  const sourceFrames = db.listFrames(originalSessionId);

  if (sourceFrames.length === 0) {
    db.close();
    throw new Error(`No recorded frames found for session "${originalSessionId}"`);
  }

  const startFrame = sourceFrames.find((frame) => frame.id === startFrameId);

  if (!startFrame) {
    db.close();
    throw new Error(`Frame ${startFrameId} was not found in session "${originalSessionId}"`);
  }

  const forkScopeFrames = sourceFrames.filter((frame) => frame.sequence <= startFrame.sequence);
  const forkContext = buildForkContext(forkScopeFrames);
  const snapshotForRestore = findLatestGitSnapshotAtOrBeforeFrame(forkScopeFrames);
  const workspaceRestore = restoreGitSnapshotForFork(
    paths,
    originalSessionId,
    startFrameId,
    snapshotForRestore,
  );
  const forkState: ReplaySessionState = {
    promptIndex: 0,
    toolCallIndex: 0,
    lastReplayUserFrameId: null,
    lastAssistantFrameId: null,
    preparedToolCalls: [],
    lastSubmittedPromptSource: null,
  };
  const client = new CopilotClient({
    cwd: paths.projectPath,
  });

  let forkSessionId: string | undefined;
  let session: CopilotSession | undefined;
  let workError: unknown;

  try {
    session = await client.createSession({
      onPermissionRequest: approveAll,
      workingDirectory: paths.projectPath,
      tools: [createSearchDocsTool()],
      hooks: {
        onUserPromptSubmitted(input, invocation) {
          const frame = db.recordAgentTurn({
            sessionId: invocation.sessionId,
            role: "user",
            content: input.prompt,
            branchRootFrameId: startFrameId,
            metadata: {
              is_fork: true,
              original_session_id: originalSessionId,
              fork_source_session_id: originalSessionId,
              fork_source_frame_id: startFrameId,
              hook: "onUserPromptSubmitted",
              cwd: input.cwd,
              timestamp: input.timestamp,
            },
          });

          forkState.lastReplayUserFrameId = frame.id;
          forkState.lastSubmittedPromptSource = "fork";

          if (forkState.promptIndex === 0) {
            forkState.promptIndex = 1;
            return {
              additionalContext: `${buildWorkspaceRestoreContext(workspaceRestore)}\n\nYou are continuing a forked dAVM session from recorded frame ${startFrameId}. Reconstruct the state from this history before answering the new user prompt:\n\n${forkContext}`,
            };
          }
        },
        onPreToolUse(input, invocation) {
          const normalizedArgs = toJsonValue(input.toolArgs);
          const argsFingerprint = fingerprintValue(normalizedArgs);

          const replayToolCallFrame = db.recordToolCall({
            sessionId: invocation.sessionId,
            toolName: input.toolName,
            args: normalizedArgs,
            parentFrameId: forkState.lastReplayUserFrameId,
            branchRootFrameId: startFrameId,
            metadata: {
              is_fork: true,
              original_session_id: originalSessionId,
              fork_source_session_id: originalSessionId,
              fork_source_frame_id: startFrameId,
              prompt_source: forkState.lastSubmittedPromptSource,
              hook: "onPreToolUse",
              cwd: input.cwd,
              timestamp: input.timestamp,
            },
          });

          if (!replayToolCallFrame.toolCallId) {
            throw new Error(`Missing fork toolCallId for "${input.toolName}"`);
          }

          forkState.preparedToolCalls.push({
            replayToolCallFrameId: replayToolCallFrame.id,
            replayToolCallId: replayToolCallFrame.toolCallId,
            originalToolCallId: null,
            toolName: input.toolName,
            argsFingerprint,
            result: null,
            resolved: false,
            source: "live",
          });
        },
        onPostToolUse(input, invocation) {
          const normalizedArgs = toJsonValue(input.toolArgs);
          const preparedToolCall = findPreparedReplayToolCall(
            forkState,
            input.toolName,
            fingerprintValue(normalizedArgs),
          );

          if (!preparedToolCall) {
            throw new Error(
              `No prepared fork tool call found for "${input.toolName}" in session "${invocation.sessionId}"`,
            );
          }

          db.recordToolResult({
            sessionId: invocation.sessionId,
            toolName: input.toolName,
            toolCallId: preparedToolCall.replayToolCallId,
            result: toJsonValue(input.toolResult),
            parentFrameId: preparedToolCall.replayToolCallFrameId,
            branchRootFrameId: startFrameId,
            metadata: {
              is_fork: true,
              original_session_id: originalSessionId,
              original_tool_call_id: preparedToolCall.originalToolCallId,
              fork_source_session_id: originalSessionId,
              fork_source_frame_id: startFrameId,
              prompt_source: forkState.lastSubmittedPromptSource,
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

        if (!forkSessionId) {
          throw new Error("Assistant message received before the fork session ID was initialized");
        }

        const frame = db.recordAgentTurn({
          sessionId: forkSessionId,
          role: "assistant",
          content: event.data.content,
          parentFrameId: forkState.lastReplayUserFrameId,
          branchRootFrameId: startFrameId,
          metadata: {
            is_fork: true,
            original_session_id: originalSessionId,
            fork_source_session_id: originalSessionId,
            fork_source_frame_id: startFrameId,
            eventType: event.type,
          },
        });

        forkState.lastAssistantFrameId = frame.id;
        recordSnapshotForFrame(
          db,
          paths,
          forkSessionId,
          paths.snapshotMode,
          "assistant",
          frame.id,
          "fork assistant message",
        );
      },
    });

    forkSessionId = session.sessionId;
    db.recordFrame({
      sessionId: forkSessionId,
      frameType: "system_event",
      role: "system",
      branchRootFrameId: startFrameId,
      content: {
        event: "fork_session_started",
        originalSessionId,
        startFrameId,
        workspaceRestore: toJsonObject(workspaceRestore),
      },
      metadata: {
        is_fork: true,
        fork_source_session_id: originalSessionId,
        fork_source_frame_id: startFrameId,
      },
    });

    cloneFramesIntoFork(db, forkScopeFrames, forkSessionId, originalSessionId, startFrameId);

    const assistantMessage = await session.sendAndWait(
      { prompt: newPrompt },
      SESSION_IDLE_TIMEOUT_MS,
    );
    recordSnapshotForFrame(
      db,
      paths,
      forkSessionId,
      paths.snapshotMode,
      "prompt",
      forkState.lastAssistantFrameId ?? forkState.lastReplayUserFrameId,
      "fork continuation",
    );

    return {
      originalSessionId,
      startFrameId,
      forkSessionId,
      assistantResponse: assistantMessage?.data.content ?? null,
      workspaceRestore,
      resumeCommand: buildResumeCommand(paths.projectPath, forkSessionId),
      frames: db.listFrames(forkSessionId),
      registryEntries: db.listRegistryEntries(forkSessionId),
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
      throw new AggregateError(cleanupErrors, "Failed to clean up the fork session");
    }
  }
}

export function getForkPreview(
  originalSessionId: string,
  startFrameId: number,
  options: DavmRuntimeOptions = {},
): ForkPreviewResult {
  const paths = resolveDavmPaths(options);
  const db = openFrameStore(paths);

  try {
    const sourceFrames = db.listFrames(originalSessionId);

    if (sourceFrames.length === 0) {
      throw new Error(`No recorded frames found for session "${originalSessionId}"`);
    }

    const startFrame = sourceFrames.find((frame) => frame.id === startFrameId);

    if (!startFrame) {
      throw new Error(`Frame ${startFrameId} was not found in session "${originalSessionId}"`);
    }

    const forkScopeFrames = sourceFrames.filter((frame) => frame.sequence <= startFrame.sequence);
    const snapshotForRestore = findLatestGitSnapshotAtOrBeforeFrame(forkScopeFrames);

    return {
      originalSessionId,
      startFrameId,
      latestSnapshotFrameId: snapshotForRestore?.frameId ?? null,
      restorePlan: planForkRestore(paths, originalSessionId, startFrameId, snapshotForRestore),
    };
  } finally {
    db.close();
  }
}

export async function runResume(
  originalSessionId: string,
  newPrompt: string,
  options: DavmRuntimeOptions = {},
): Promise<ResumeResult> {
  const paths = resolveDavmPaths(options);
  const db = openFrameStore(paths);
  const sourceFrames = db.listFrames(originalSessionId);

  if (sourceFrames.length === 0) {
    db.close();
    throw new Error(`No recorded frames found for session "${originalSessionId}"`);
  }

  const lastFrame = sourceFrames.at(-1) as Frame;
  const resumeContext = buildForkContext(sourceFrames);
  const resumeState: ReplaySessionState = {
    promptIndex: 0,
    toolCallIndex: 0,
    lastReplayUserFrameId: null,
    lastAssistantFrameId: null,
    preparedToolCalls: [],
    lastSubmittedPromptSource: "fork",
  };
  const client = new CopilotClient({
    cwd: paths.projectPath,
  });

  let resumedSessionId: string | undefined;
  let session: CopilotSession | undefined;
  let workError: unknown;

  try {
    session = await client.createSession({
      onPermissionRequest: approveAll,
      workingDirectory: paths.projectPath,
      tools: [createSearchDocsTool()],
      hooks: {
        onUserPromptSubmitted(input, invocation) {
          const frame = db.recordAgentTurn({
            sessionId: invocation.sessionId,
            role: "user",
            content: input.prompt,
            branchRootFrameId: lastFrame.id,
            metadata: {
              is_resume: true,
              original_session_id: originalSessionId,
              resume_source_session_id: originalSessionId,
              resume_source_frame_id: lastFrame.id,
              hook: "onUserPromptSubmitted",
              cwd: input.cwd,
              timestamp: input.timestamp,
            },
          });

          resumeState.lastReplayUserFrameId = frame.id;

          if (resumeState.promptIndex === 0) {
            resumeState.promptIndex = 1;
            return {
              additionalContext: `You are resuming a dAVM session from recorded frame ${lastFrame.id}. Reconstruct the state from this history before answering the new user prompt:\n\n${resumeContext}`,
            };
          }
        },
        onPreToolUse(input, invocation) {
          const normalizedArgs = toJsonValue(input.toolArgs);
          const replayToolCallFrame = db.recordToolCall({
            sessionId: invocation.sessionId,
            toolName: input.toolName,
            args: normalizedArgs,
            parentFrameId: resumeState.lastReplayUserFrameId,
            branchRootFrameId: lastFrame.id,
            metadata: {
              is_resume: true,
              original_session_id: originalSessionId,
              resume_source_session_id: originalSessionId,
              resume_source_frame_id: lastFrame.id,
              hook: "onPreToolUse",
              cwd: input.cwd,
              timestamp: input.timestamp,
            },
          });

          if (!replayToolCallFrame.toolCallId) {
            throw new Error(`Missing resume toolCallId for "${input.toolName}"`);
          }

          resumeState.preparedToolCalls.push({
            replayToolCallFrameId: replayToolCallFrame.id,
            replayToolCallId: replayToolCallFrame.toolCallId,
            originalToolCallId: null,
            toolName: input.toolName,
            argsFingerprint: fingerprintValue(normalizedArgs),
            result: null,
            resolved: false,
            source: "live",
          });
        },
        onPostToolUse(input, invocation) {
          const normalizedArgs = toJsonValue(input.toolArgs);
          const preparedToolCall = findPreparedReplayToolCall(
            resumeState,
            input.toolName,
            fingerprintValue(normalizedArgs),
          );

          if (!preparedToolCall) {
            throw new Error(
              `No prepared resume tool call found for "${input.toolName}" in session "${invocation.sessionId}"`,
            );
          }

          db.recordToolResult({
            sessionId: invocation.sessionId,
            toolName: input.toolName,
            toolCallId: preparedToolCall.replayToolCallId,
            result: toJsonValue(input.toolResult),
            parentFrameId: preparedToolCall.replayToolCallFrameId,
            branchRootFrameId: lastFrame.id,
            metadata: {
              is_resume: true,
              original_session_id: originalSessionId,
              resume_source_session_id: originalSessionId,
              resume_source_frame_id: lastFrame.id,
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

        if (!resumedSessionId) {
          throw new Error("Assistant message received before the resumed session ID was initialized");
        }

        const frame = db.recordAgentTurn({
          sessionId: resumedSessionId,
          role: "assistant",
          content: event.data.content,
          parentFrameId: resumeState.lastReplayUserFrameId,
          branchRootFrameId: lastFrame.id,
          metadata: {
            is_resume: true,
            original_session_id: originalSessionId,
            resume_source_session_id: originalSessionId,
            resume_source_frame_id: lastFrame.id,
            eventType: event.type,
          },
        });

        resumeState.lastAssistantFrameId = frame.id;
        recordSnapshotForFrame(
          db,
          paths,
          resumedSessionId,
          paths.snapshotMode,
          "assistant",
          frame.id,
          "resume assistant message",
        );
      },
    });

    resumedSessionId = session.sessionId;
    db.recordFrame({
      sessionId: resumedSessionId,
      frameType: "system_event",
      role: "system",
      branchRootFrameId: lastFrame.id,
      content: {
        event: "resume_session_started",
        originalSessionId,
        sourceFrameId: lastFrame.id,
      },
      metadata: {
        is_resume: true,
        resume_source_session_id: originalSessionId,
        resume_source_frame_id: lastFrame.id,
      },
    });

    const assistantMessage = await session.sendAndWait(
      { prompt: newPrompt },
      SESSION_IDLE_TIMEOUT_MS,
    );

    recordSnapshotForFrame(
      db,
      paths,
      resumedSessionId,
      paths.snapshotMode,
      "prompt",
      resumeState.lastAssistantFrameId ?? resumeState.lastReplayUserFrameId,
      "resume continuation",
    );

    return {
      originalSessionId,
      resumedSessionId,
      assistantResponse: assistantMessage?.data.content ?? null,
      resumeCommand: buildResumeCommand(paths.projectPath, resumedSessionId),
      frames: db.listFrames(resumedSessionId),
      registryEntries: db.listRegistryEntries(resumedSessionId),
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
      throw new AggregateError(cleanupErrors, "Failed to clean up the resumed session");
    }
  }
}

function cloneFramesIntoFork(
  db: ReturnType<typeof openFrameStore>,
  sourceFrames: Frame[],
  forkSessionId: string,
  originalSessionId: string,
  startFrameId: number,
): void {
  for (const frame of sourceFrames) {
    db.recordFrame({
      sessionId: forkSessionId,
      frameType: frame.frameType,
      role: frame.role,
      toolName: frame.toolName,
      toolCallId: frame.toolCallId,
      parentFrameId: frame.parentFrameId,
      branchRootFrameId: startFrameId,
      content: frame.content,
      metadata: {
        ...(typeof frame.metadata === "object" && frame.metadata !== null && !Array.isArray(frame.metadata)
          ? frame.metadata
          : {}),
        is_replay: true,
        is_fork: true,
        original_frame_id: frame.id,
        original_session_id: originalSessionId,
        fork_source_session_id: originalSessionId,
        fork_source_frame_id: startFrameId,
      },
    });
  }
}

function buildForkContext(frames: Frame[]): string {
  return frames.map((frame) => summarizeFrameForFork(frame)).join("\n");
}

function summarizeFrameForFork(frame: Frame): string {
  if (frame.frameType === "llm_turn") {
    return `[${frame.role ?? "unknown"}] ${getRecordedTurnContent(frame)}`;
  }

  if (frame.frameType === "tool_call") {
    return `[tool_call:${frame.toolName ?? "unknown"}] ${JSON.stringify(getRecordedToolArgs(frame))}`;
  }

  if (frame.frameType === "tool_result") {
    return `[tool_result:${frame.toolName ?? "unknown"}] ${JSON.stringify(extractObjectField(frame.content, "result"))}`;
  }

  return `[system] ${JSON.stringify(frame.content)}`;
}

function extractReplayPrompts(
  frames: Frame[],
  options: { includeReplayFrames?: boolean } = {},
): ReplayPrompt[] {
  const prompts: ReplayPrompt[] = [];

  for (const frame of frames) {
    if (
      frame.frameType !== "llm_turn" ||
      frame.role !== "user" ||
      (!options.includeReplayFrames && isReplayFrame(frame))
    ) {
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

function extractRecordedToolCalls(
  db: ReturnType<typeof openFrameStore>,
  frames: Frame[],
  options: { includeReplayFrames?: boolean } = {},
): RecordedToolCall[] {
  const toolCalls: RecordedToolCall[] = [];

  for (const frame of frames) {
    if (
      frame.frameType !== "tool_call" ||
      (!options.includeReplayFrames && isReplayFrame(frame))
    ) {
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

        if (preparedToolCall.source !== "replay") {
          throw new Error(`Replay expected recorded state for "${toolName}" but found live state`);
        }

        return preparedToolCall.result;
      },
    }),
  );
}

function createForkToolsForRecordedCalls(
  recordedToolCalls: RecordedToolCall[],
  replayState: ReplaySessionState,
  liveTools: Array<Tool<any>>,
) {
  const liveToolsByName = new Map(liveTools.map((tool) => [tool.name, tool]));
  const uniqueToolNames = [
    ...new Set([
      ...recordedToolCalls.map((recordedToolCall) => recordedToolCall.toolName),
      ...liveTools.map((tool) => tool.name),
    ]),
  ];

  return uniqueToolNames.map((toolName) =>
    defineTool<JsonValue>(toolName, {
      description: `Fork-aware wrapper for ${toolName}.`,
      parameters: {
        type: "object",
        additionalProperties: true,
      },
      overridesBuiltInTool: true,
      skipPermission: true,
      async handler(args, invocation) {
        const argsFingerprint = fingerprintValue(toJsonValue(args));
        const preparedToolCall = findPreparedReplayToolCall(
          replayState,
          toolName,
          argsFingerprint,
        );

        if (preparedToolCall?.source === "replay") {
          return preparedToolCall.result;
        }

        const liveTool = liveToolsByName.get(toolName);

        if (!liveTool) {
          throw new Error(`No live implementation is registered for the forked ${toolName} tool`);
        }

        return liveTool.handler(args, invocation);
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

function extractObjectField(value: JsonValue, fieldName: string): JsonValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }

  return toJsonValue(value[fieldName]);
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

function findLatestGitSnapshotAtOrBeforeFrame(
  frames: Frame[],
): { frameId: number; metadata: GitSnapshotMetadata } | null {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const snapshotMetadata = getGitSnapshotMetadata(frames[index]);

    if (snapshotMetadata) {
      return {
        frameId: frames[index].id,
        metadata: snapshotMetadata,
      };
    }
  }

  return null;
}

function getGitSnapshotMetadata(frame: Frame): GitSnapshotMetadata | null {
  if (typeof frame.metadata !== "object" || frame.metadata === null || Array.isArray(frame.metadata)) {
    return null;
  }

  const candidate = frame.metadata.git_snapshot;

  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return null;
  }

  if (
    typeof candidate.repoRoot !== "string" ||
    candidate.repoRoot.length === 0 ||
    typeof candidate.snapshotCommit !== "string" ||
    candidate.snapshotCommit.length === 0 ||
    typeof candidate.snapshotRef !== "string" ||
    candidate.snapshotRef.length === 0 ||
    typeof candidate.createdNewCommit !== "boolean" ||
    typeof candidate.recordedAt !== "string"
  ) {
    return null;
  }

  return {
    repoRoot: candidate.repoRoot,
    snapshotCommit: candidate.snapshotCommit,
    snapshotRef: candidate.snapshotRef,
    headCommit: typeof candidate.headCommit === "string" ? candidate.headCommit : null,
    createdNewCommit: candidate.createdNewCommit,
    recordedAt: candidate.recordedAt,
  };
}

function buildWorkspaceRestoreContext(workspaceRestore: GitWorkspaceRestoreResult): string {
  if (workspaceRestore.applied && workspaceRestore.restoredBranch && workspaceRestore.snapshotCommit) {
    return `The working tree was restored from Git snapshot ${workspaceRestore.snapshotCommit} on branch ${workspaceRestore.restoredBranch}.`;
  }

  if (workspaceRestore.reason) {
    return `No Git workspace restore was applied before this fork. Reason: ${workspaceRestore.reason}`;
  }

  return "No Git workspace restore metadata was available for this fork.";
}

function buildResumeCommand(projectPath: string, sessionId: string): string {
  const scriptPath = platform() === "win32" ? "dist\\index.js" : "dist/index.js";
  return `node ${scriptPath} resume --project ${quoteForShell(projectPath)} ${quoteForShell(sessionId)} ${quoteForShell("Continue from this session.")}`;
}

function recordSnapshotForFrame(
  db: ReturnType<typeof openFrameStore>,
  paths: ReturnType<typeof resolveDavmPaths>,
  sessionId: string,
  snapshotMode: NonNullable<DavmRuntimeOptions["snapshotMode"]>,
  trigger: "prompt" | "assistant",
  frameId: number | null,
  label: string,
): void {
  if (!frameId || snapshotMode === "off" || (snapshotMode === "prompt" && trigger !== "prompt")) {
    return;
  }

  const frame = db.getFrame(frameId);

  if (!frame) {
    return;
  }

  const snapshotResult = captureGitSnapshot(paths, sessionId, frame.id, label);

  if (snapshotResult.available && snapshotResult.metadata) {
    db.updateFrameMetadata(frame.id, mergeJsonObjects(frame.metadata, {
      git_snapshot: toJsonObject(snapshotResult.metadata),
    }));
  }
}

function mergeJsonObjects(left: JsonValue, right: JsonValue): JsonValue {
  const normalizedLeft =
    typeof left === "object" && left !== null && !Array.isArray(left) ? left : {};
  const normalizedRight =
    typeof right === "object" && right !== null && !Array.isArray(right) ? right : {};

  return {
    ...normalizedLeft,
    ...normalizedRight,
  };
}

function toJsonObject(value: object): JsonValue {
  const normalizedObject: Record<string, JsonValue> = {};

  for (const [key, entry] of Object.entries(value)) {
    normalizedObject[key] = toJsonValue(entry);
  }

  return normalizedObject;
}

function quoteForShell(value: string): string {
  if (platform() === "win32") {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function asError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}
