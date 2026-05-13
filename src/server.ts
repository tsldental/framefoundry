import express from "express";
import { openFrameStore } from "./db";
import { runFork, runReplay } from "./replay";

export interface ServerOptions {
  port?: number;
}

export function createServer() {
  const app = express();
  app.use(express.json());

  app.get("/api/sessions", (_request, response) => {
    const db = openFrameStore();

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
    const db = openFrameStore();

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
      const replayResult = await runReplay(request.params.id);
      response.json(replayResult);
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
      const forkResult = await runFork(request.params.id, frameId, newPrompt);
      response.json(forkResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(500).json({ error: message });
    }
  });

  return app;
}

export async function startServer(options: ServerOptions = {}): Promise<void> {
  const app = createServer();
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
