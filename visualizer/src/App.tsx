import { useEffect, useState } from "react";
import { FrameTimeline } from "./components/FrameTimeline";
import { SessionSidebar } from "./components/SessionSidebar";
import type { Frame, SessionFramesResponse, SessionSummary, SessionsResponse } from "./types";

function App() {
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
      setSessions(payload.sessions);
      setSelectedSessionId((currentSessionId) => {
        const nextSessionId = preferredSessionId ?? currentSessionId;

        if (nextSessionId && payload.sessionIds.includes(nextSessionId)) {
          return nextSessionId;
        }

        return payload.sessionIds[0] ?? null;
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
                Cognitive Snapshot Explorer
              </h1>
            </div>
            <button
              type="button"
              onClick={() => void loadSessions()}
              className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-200 transition hover:border-cyan-300 hover:bg-cyan-400/20"
            >
              Refresh
            </button>
          </div>
          <p className="max-w-3xl text-sm leading-6 text-slate-300">
            Inspect recorded sessions, compare live and replay frames, and browse the SQLite-backed timeline that powers dAVM.
          </p>
        </header>

        {error ? (
          <div className="mb-6 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="grid flex-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <SessionSidebar
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
        </div>
      </div>
    </div>
  );
}

export default App;
