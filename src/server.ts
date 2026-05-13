import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openFrameStore, resolveDavmPaths, type DavmRuntimeOptions } from "./db";
import { NoteStore } from "./notes";
import { runFork, runReplay } from "./replay";

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

if (require.main === module) {
  void startServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
