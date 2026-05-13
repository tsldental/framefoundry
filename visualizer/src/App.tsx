import { useEffect, useState } from "react";
import { FrameTimeline } from "./components/FrameTimeline";
import { SessionSidebar } from "./components/SessionSidebar";
import type { Frame, SessionFramesResponse, SessionsResponse } from "./types";

function App() {
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingFrames, setIsLoadingFrames] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadSessions();
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      setFrames([]);
      return;
    }

    void loadFrames(selectedSessionId);
  }, [selectedSessionId]);

  async function loadSessions() {
    setIsLoadingSessions(true);
    setError(null);

    try {
      const response = await fetch("/api/sessions");

      if (!response.ok) {
        throw new Error(`Failed to load sessions: ${response.status}`);
      }

      const payload = (await response.json()) as SessionsResponse;
      setSessionIds(payload.sessionIds);
      setSelectedSessionId((currentSessionId) => currentSessionId ?? payload.sessionIds[0] ?? null);
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
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoadingFrames(false);
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
            sessionIds={sessionIds}
            selectedSessionId={selectedSessionId}
            isLoading={isLoadingSessions}
            onRefresh={() => void loadSessions()}
            onSelectSession={setSelectedSessionId}
          />
          <FrameTimeline
            sessionId={selectedSessionId}
            frames={frames}
            isLoading={isLoadingFrames}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
