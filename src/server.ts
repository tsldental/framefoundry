import express from "express";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { openFrameStore, resolveDavmPaths, type DavmRuntimeOptions } from "./db";
import { listFramefoundryRefs, pruneFramefoundryRefs } from "./git";
import { NoteStore } from "./notes";
import { getForkPreview, runFork, runReplay, runResume } from "./replay";

export interface ServerOptions extends DavmRuntimeOptions {
  port?: number;
  serveVisualizer?: boolean;
}

export function createServer(options: ServerOptions = {}) {
  const paths = resolveDavmPaths(options);
  const app = express();
  app.use(express.json());

  app.get("/api/sessions", (_request, response) => {
    const db = openFrameStore(paths);

    try {
      const sessions = db.listSessions();

        response.json({
          sessionIds: sessions.map((session) => session.sessionId),
          sessions,
          project: {
            name: basename(paths.projectPath),
            projectPath: paths.projectPath,
            dbPath: paths.dbPath,
            configPath: paths.configPath,
            snapshotMode: paths.snapshotMode,
            retentionPolicy: paths.retentionPolicy,
          },
        });
    } finally {
      db.close();
    }
  });

  app.get("/api/sessions/:id", (request, response) => {
    const db = openFrameStore(paths);

    try {
      response.json({
        sessionId: request.params.id,
        frames: db.listFrames(request.params.id),
      });
    } finally {
      db.close();
    }
  });

  app.get("/api/sessions/:id/compare", (request, response) => {
    const db = openFrameStore(paths);

    try {
      response.json(buildSessionComparison(db, request.params.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(500).json({ error: message });
    } finally {
      db.close();
    }
  });

  app.post("/api/sessions/:id/replay", async (request, response) => {
    try {
      const replayResult = await runReplay(request.params.id, paths);
      response.json(replayResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(500).json({ error: message });
    }
  });

  // ── Notes CRUD ──────────────────────────────────────────────────────────────

  app.get("/api/notes", (_request, response) => {
    const db = openFrameStore(paths);
    try {
      const notes = new NoteStore(db.db).list();
      response.json({ notes });
    } finally {
      db.close();
    }
  });

  app.post("/api/notes", (request, response) => {
    const { title, body } = request.body ?? {};
    const db = openFrameStore(paths);
    try {
      const note = new NoteStore(db.db).create({ title, body });
      response.status(201).json({ note });
    } finally {
      db.close();
    }
  });

  app.get("/api/notes/:id", (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) {
      response.status(400).json({ error: "id must be an integer" });
      return;
    }
    const db = openFrameStore(paths);
    try {
      const note = new NoteStore(db.db).get(id);
      if (!note) {
        response.status(404).json({ error: "Note not found" });
        return;
      }
      response.json({ note });
    } finally {
      db.close();
    }
  });

  app.put("/api/notes/:id", (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) {
      response.status(400).json({ error: "id must be an integer" });
      return;
    }
    const { title, body } = request.body ?? {};
    const db = openFrameStore(paths);
    try {
      const note = new NoteStore(db.db).update(id, { title, body });
      if (!note) {
        response.status(404).json({ error: "Note not found" });
        return;
      }
      response.json({ note });
    } finally {
      db.close();
    }
  });

  app.delete("/api/notes/:id", (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) {
      response.status(400).json({ error: "id must be an integer" });
      return;
    }
    const db = openFrameStore(paths);
    try {
      const deleted = new NoteStore(db.db).delete(id);
      if (!deleted) {
        response.status(404).json({ error: "Note not found" });
        return;
      }
      response.status(204).end();
    } finally {
      db.close();
    }
  });

  // ── Sessions ─────────────────────────────────────────────────────────────────

  app.get("/api/sessions/:id/fork-preview", (request, response) => {
    const frameId = Number(request.query.frameId);

    if (!Number.isInteger(frameId)) {
      response.status(400).json({ error: "frameId must be an integer" });
      return;
    }

    try {
      response.json(getForkPreview(request.params.id, frameId, options));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(500).json({ error: message });
    }
  });

  app.post("/api/sessions/:id/fork", async (request, response) => {
    const frameId = Number(request.body?.frameId);
    const newPrompt =
      typeof request.body?.newPrompt === "string" ? request.body.newPrompt.trim() : "";

    if (!Number.isInteger(frameId)) {
      response.status(400).json({ error: "frameId must be an integer" });
      return;
    }

    if (!newPrompt) {
      response.status(400).json({ error: "newPrompt is required" });
      return;
    }

    try {
      const forkResult = await runFork(request.params.id, frameId, newPrompt, paths);
      response.json(forkResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(500).json({ error: message });
    }
  });

  app.post("/api/sessions/:id/resume", async (request, response) => {
    const newPrompt =
      typeof request.body?.newPrompt === "string" ? request.body.newPrompt.trim() : "";

    if (!newPrompt) {
      response.status(400).json({ error: "newPrompt is required" });
      return;
    }

    try {
      const resumeResult = await runResume(request.params.id, newPrompt, options);
      response.json(resumeResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(500).json({ error: message });
    }
  });

  app.get("/api/git/refs", (request, response) => {
    const kind =
      request.query.kind === "snapshot" || request.query.kind === "backup"
        ? request.query.kind
        : "all";
    const sessionId =
      typeof request.query.sessionId === "string" && request.query.sessionId.trim()
        ? request.query.sessionId.trim()
        : undefined;

    response.json(listFramefoundryRefs(paths, { kind, sessionId }));
  });

  app.post("/api/git/refs/prune", (request, response) => {
    const kind =
      request.body?.kind === "snapshot" || request.body?.kind === "backup"
        ? request.body.kind
        : "all";
    const sessionId =
      typeof request.body?.sessionId === "string" && request.body.sessionId.trim()
        ? request.body.sessionId.trim()
        : undefined;
    const keep = Number.isInteger(request.body?.keep) ? request.body.keep : 0;

    try {
      response.json(pruneFramefoundryRefs(paths, { kind, sessionId, keep }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(500).json({ error: message });
    }
  });

  if (options.serveVisualizer ?? false) {
    const visualizerDistPath = resolve(__dirname, "..", "visualizer", "dist");

    if (!existsSync(visualizerDistPath)) {
      throw new Error(
        `Visualizer assets were not found at ${visualizerDistPath}. Run "npm run build" before using davm start.`,
      );
    }

    app.use(express.static(visualizerDistPath));
    app.get(/^\/(?!api(?:\/|$)).*/, (_request, response) => {
      response.sendFile(resolve(visualizerDistPath, "index.html"));
    });
  }

  return app;
}

export async function startServer(options: ServerOptions = {}): Promise<void> {
  const app = createServer(options);
  const port = options.port ?? Number(process.env.PORT ?? 3001);

  await new Promise<void>((resolve) => {
    app.listen(port, () => {
      console.log(`dAVM bridge listening on http://localhost:${port}`);
      resolve();
    });
  });
}

function buildSessionComparison(
  db: ReturnType<typeof openFrameStore>,
  sessionId: string,
): {
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
} {
  const sessions = db.listSessions();
  const currentSession = sessions.find((session) => session.sessionId === sessionId);
  const currentFrames = db.listFrames(sessionId);

  if (currentFrames.length === 0) {
    throw new Error(`No recorded frames found for session "${sessionId}"`);
  }

  const compareTargetInfo = resolveCompareTarget(sessions, currentFrames, currentSession?.parentSessionId ?? null);
  const targetFrames = compareTargetInfo ? db.listFrames(compareTargetInfo.sessionId) : [];
  const inheritedFrameCount = countInheritedFrames(currentFrames);
  const currentAssistantCount = countFrames(currentFrames, "llm_turn", "assistant");
  const currentToolCallCount = countFrames(currentFrames, "tool_call");
  const targetAssistantCount = compareTargetInfo
    ? countFrames(targetFrames, "llm_turn", "assistant")
    : null;
  const targetToolCallCount = compareTargetInfo ? countFrames(targetFrames, "tool_call") : null;
  const targetLatestSummary =
    sessions.find((session) => session.sessionId === compareTargetInfo?.sessionId)?.latestSummary ?? null;

  return {
    sessionId,
    compareTarget: compareTargetInfo
      ? {
          sessionId: compareTargetInfo.sessionId,
          headline: compareTargetInfo.headline,
          reason: compareTargetInfo.reason,
        }
      : null,
    branchRootFrameId: currentSession?.branchRootFrameId ?? null,
    sourceFrameId: compareTargetInfo?.sourceFrameId ?? currentSession?.branchRootFrameId ?? null,
    inheritedFrameCount,
    newFrameCount: Math.max(0, currentFrames.length - inheritedFrameCount),
    currentFrameCount: currentFrames.length,
    targetFrameCount: compareTargetInfo ? targetFrames.length : null,
    currentAssistantCount,
    targetAssistantCount,
    currentToolCallCount,
    targetToolCallCount,
    currentLatestSummary: currentSession?.latestSummary ?? "No session summary available.",
    targetLatestSummary,
    comparisonSummary: buildComparisonSummary({
      compareTarget: compareTargetInfo,
      inheritedFrameCount,
      currentFrameCount: currentFrames.length,
      branchRootFrameId: currentSession?.branchRootFrameId ?? null,
    }),
  };
}

function resolveCompareTarget(
  sessions: ReturnType<typeof openFrameStore>["listSessions"] extends () => infer T ? T : never,
  frames: ReturnType<typeof openFrameStore>["listFrames"] extends (_sessionId: string) => infer T ? T : never,
  parentSessionId: string | null,
): {
  sessionId: string;
  headline: string;
  reason: "fork_source" | "resume_source" | "parent";
  sourceFrameId: number | null;
} | null {
  const sourceHints = [
    { sessionKey: "resume_source_session_id", frameKey: "resume_source_frame_id", reason: "resume_source" as const },
    { sessionKey: "fork_source_session_id", frameKey: "fork_source_frame_id", reason: "fork_source" as const },
  ];

  for (const hint of sourceHints) {
    for (const frame of frames) {
      const candidateSessionId = readStringMetadata(frame.metadata, hint.sessionKey);

      if (!candidateSessionId) {
        continue;
      }

      const candidateSession = sessions.find((session) => session.sessionId === candidateSessionId);

      return {
        sessionId: candidateSessionId,
        headline: candidateSession?.headline ?? candidateSessionId,
        reason: hint.reason,
        sourceFrameId: readNumberMetadata(frame.metadata, hint.frameKey),
      };
    }
  }

  if (!parentSessionId) {
    return null;
  }

  const parentSession = sessions.find((session) => session.sessionId === parentSessionId);

  return {
    sessionId: parentSessionId,
    headline: parentSession?.headline ?? parentSessionId,
    reason: "parent",
    sourceFrameId: null,
  };
}

function countInheritedFrames(
  frames: ReturnType<typeof openFrameStore>["listFrames"] extends (_sessionId: string) => infer T ? T : never,
): number {
  return frames.filter((frame) => readNumberMetadata(frame.metadata, "original_frame_id") !== null).length;
}

function countFrames(
  frames: ReturnType<typeof openFrameStore>["listFrames"] extends (_sessionId: string) => infer T ? T : never,
  frameType: string,
  role?: string,
): number {
  return frames.filter((frame) => frame.frameType === frameType && (role ? frame.role === role : true)).length;
}

function readStringMetadata(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function readNumberMetadata(metadata: unknown, key: string): number | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "number" ? value : null;
}

function buildComparisonSummary({
  compareTarget,
  inheritedFrameCount,
  currentFrameCount,
  branchRootFrameId,
}: {
  compareTarget: {
    sessionId: string;
    headline: string;
    reason: "fork_source" | "resume_source" | "parent";
    sourceFrameId: number | null;
  } | null;
  inheritedFrameCount: number;
  currentFrameCount: number;
  branchRootFrameId: number | null;
}): string {
  if (!compareTarget) {
    return "This session has no detected source session to compare against yet.";
  }

  if (compareTarget.reason === "resume_source") {
    return `Resumed from ${compareTarget.headline}${compareTarget.sourceFrameId ? ` at frame #${compareTarget.sourceFrameId}` : ""} and recorded ${currentFrameCount} new frames in this continuation.`;
  }

  if (compareTarget.reason === "fork_source") {
    return `Forked from ${compareTarget.headline}${branchRootFrameId ? ` at frame #${branchRootFrameId}` : ""} with ${inheritedFrameCount} inherited frames before divergence.`;
  }

  return `Compared against parent session ${compareTarget.headline}.`;
}

if (require.main === module) {
  void startServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
