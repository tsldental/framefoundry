import { useEffect, useState } from "react";
import { FrameTimeline } from "./components/FrameTimeline";
import { NotesApp } from "./components/NotesApp";
import { SessionSidebar } from "./components/SessionSidebar";
import type {
  Frame,
  ProjectContext,
  SessionFramesResponse,
  SessionSummary,
  SessionsResponse,
} from "./types";

type Tab = "sessions" | "notes";

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("sessions");
  const [project, setProject] = useState<ProjectContext | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [selectedFrameId, setSelectedFrameId] = useState<number | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingFrames, setIsLoadingFrames] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedSession =
    sessions.find((session) => session.sessionId === selectedSessionId) ?? null;

  useEffect(() => {
    void loadSessions();
  }, []);

  useEffect(() => {
    const projectSuffix = project ? ` — ${project.name}` : "";
    document.title = `framefoundry${projectSuffix}`;
  }, [project]);

  useEffect(() => {
    if (!selectedSessionId) {
      setFrames([]);
      setSelectedFrameId(null);
      return;
    }

    void loadFrames(selectedSessionId);
  }, [selectedSessionId]);

  async function loadSessions(preferredSessionId?: string) {
    setIsLoadingSessions(true);
    setError(null);

    try {
      const response = await fetch("/api/sessions");

      if (!response.ok) {
        throw new Error(`Failed to load sessions: ${response.status}`);
      }

      const payload = (await response.json()) as SessionsResponse;
      const normalizedSessions = normalizeSessionsResponse(payload);
      setProject(normalizeProjectContext(payload.project));
      setSessions(normalizedSessions);
      setSelectedSessionId((currentSessionId) => {
        const nextSessionId = preferredSessionId ?? currentSessionId;

        if (nextSessionId && normalizedSessions.some((session) => session.sessionId === nextSessionId)) {
          return nextSessionId;
        }

        return normalizedSessions[0]?.sessionId ?? null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoadingSessions(false);
    }
  }

  async function loadFrames(sessionId: string) {
    setIsLoadingFrames(true);
    setError(null);

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);

      if (!response.ok) {
        throw new Error(`Failed to load session ${sessionId}: ${response.status}`);
      }

      const payload = (await response.json()) as SessionFramesResponse;
      setFrames(payload.frames);
      setSelectedFrameId(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoadingFrames(false);
    }
  }

  async function forkFromFrame(frame: Frame) {
    if (!selectedSessionId) {
      return;
    }

    const newPrompt = window.prompt(
      `Fork from frame #${frame.sequence} with a new prompt:`,
      "Take this in a new direction.",
    );

    if (!newPrompt?.trim()) {
      return;
    }

    setError(null);

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(selectedSessionId)}/fork`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          frameId: frame.id,
          newPrompt: newPrompt.trim(),
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `Failed to fork from frame ${frame.id}`);
      }

      const payload = (await response.json()) as {
        forkSessionId: string;
        frames: Frame[];
      };

      setSelectedSessionId(payload.forkSessionId);
      setFrames(payload.frames);
      setSelectedFrameId(null);
      await loadSessions(payload.forkSessionId);
    } catch (forkError) {
      setError(forkError instanceof Error ? forkError.message : String(forkError));
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-8 lg:px-8">
        <header className="mb-8 flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-8 shadow-2xl shadow-slate-950/40 backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.3em] text-cyan-400">
                dAVM Visualizer
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">
                {activeTab === "sessions" ? "Cognitive Snapshot Explorer" : "Notes"}
              </h1>
              {project ? (
                <div
                  className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100"
                  title={`Project: ${project.projectPath}\nDatabase: ${project.dbPath}`}
                >
                  <span className="font-semibold uppercase tracking-[0.22em] text-cyan-300">
                    Project
                  </span>
                  <span className="truncate">{project.name}</span>
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              {/* Tab switcher */}
              <div className="flex rounded-full border border-slate-700 bg-slate-800/60 p-1">
                {(["sessions", "notes"] as Tab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition ${
                      activeTab === tab
                        ? "bg-cyan-500/20 text-cyan-200 shadow"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              {activeTab === "sessions" && (
                <button
                  type="button"
                  onClick={() => void loadSessions()}
                  className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-200 transition hover:border-cyan-300 hover:bg-cyan-400/20"
                >
                  Refresh
                </button>
              )}
            </div>
          </div>
          <p className="max-w-3xl text-sm leading-6 text-slate-300">
            {activeTab === "sessions"
              ? "Inspect recorded sessions, compare live and replay frames, and browse the SQLite-backed timeline that powers dAVM."
              : "Create and manage notes stored in the dAVM SQLite database."}
          </p>
        </header>

        {error ? (
          <div className="mb-6 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="grid flex-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          {activeTab === "notes" ? (
            <NotesApp />
          ) : (
            <>
          <SessionSidebar
            project={project}
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            isLoading={isLoadingSessions}
                onRefresh={() => void loadSessions()}
                onSelectSession={setSelectedSessionId}
              />
              <FrameTimeline
                sessionId={selectedSessionId}
                session={selectedSession}
                frames={frames}
                isLoading={isLoadingFrames}
                selectedFrameId={selectedFrameId}
                onSelectFrame={(frame) => setSelectedFrameId(frame.id)}
                onForkFromFrame={forkFromFrame}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;

function normalizeProjectContext(project: ProjectContext | undefined): ProjectContext | null {
  if (!project) {
    return null;
  }

  return {
    name: typeof project.name === "string" && project.name.trim() ? project.name : "unknown-project",
    projectPath: typeof project.projectPath === "string" ? project.projectPath : "",
    dbPath: typeof project.dbPath === "string" ? project.dbPath : "",
  };
}

function normalizeSessionsResponse(payload: SessionsResponse): SessionSummary[] {
  if (Array.isArray(payload.sessions) && payload.sessions.length > 0) {
    return payload.sessions.map((session) => normalizeSessionSummary(session));
  }

  if (Array.isArray(payload.sessionIds)) {
    return payload.sessionIds.map((sessionId) =>
      normalizeSessionSummary({
        sessionId,
        parentSessionId: null,
        branchRootFrameId: null,
        createdAt: "",
        lastUpdatedAt: "",
        frameCount: 0,
        childCount: 0,
        headline: "Recorded session",
        latestSummary: "No session summary available from the current API response.",
      }),
    );
  }

  return [];
}

function normalizeSessionSummary(session: SessionSummary): SessionSummary {
  return {
    sessionId: typeof session.sessionId === "string" ? session.sessionId : String(session.sessionId),
    parentSessionId: typeof session.parentSessionId === "string" ? session.parentSessionId : null,
    branchRootFrameId:
      typeof session.branchRootFrameId === "number" ? session.branchRootFrameId : null,
    createdAt: typeof session.createdAt === "string" ? session.createdAt : "",
    lastUpdatedAt:
      typeof session.lastUpdatedAt === "string"
        ? session.lastUpdatedAt
        : typeof session.createdAt === "string"
          ? session.createdAt
          : "",
    frameCount: typeof session.frameCount === "number" ? session.frameCount : 0,
    childCount: typeof session.childCount === "number" ? session.childCount : 0,
    headline: typeof session.headline === "string" && session.headline.trim()
      ? session.headline
      : "Recorded session",
    latestSummary:
      typeof session.latestSummary === "string" && session.latestSummary.trim()
        ? session.latestSummary
        : "No session summary available from the current API response.",
  };
}
