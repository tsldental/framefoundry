import { useEffect, useMemo, useState } from "react";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

interface Frame {
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

interface SessionsResponse {
  sessionIds: string[];
}

interface SessionFramesResponse {
  sessionId: string;
  frames: Frame[];
}

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

  const replayFrames = useMemo(
    () => frames.filter((frame) => isReplayFrame(frame.metadata)),
    [frames],
  );
  const liveFrames = useMemo(
    () => frames.filter((frame) => !isReplayFrame(frame.metadata)),
    [frames],
  );

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
          <aside className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl shadow-slate-950/30">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">
                Sessions
              </h2>
              <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                {sessionIds.length}
              </span>
            </div>

            {isLoadingSessions ? (
              <p className="text-sm text-slate-400">Loading sessions...</p>
            ) : sessionIds.length === 0 ? (
              <p className="text-sm text-slate-400">No sessions recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {sessionIds.map((sessionId) => (
                  <button
                    key={sessionId}
                    type="button"
                    onClick={() => setSelectedSessionId(sessionId)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
                      sessionId === selectedSessionId
                        ? "border-cyan-400/40 bg-cyan-400/10 text-white"
                        : "border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-900"
                    }`}
                  >
                    <div className="truncate font-medium">{sessionId}</div>
                  </button>
                ))}
              </div>
            )}
          </aside>

          <main className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/30">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                  Active Session
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  {selectedSessionId ?? "Select a session"}
                </h2>
              </div>
              <div className="flex gap-3 text-xs text-slate-300">
                <Metric label="Frames" value={frames.length} />
                <Metric label="Live" value={liveFrames.length} />
                <Metric label="Replay" value={replayFrames.length} />
              </div>
            </div>

            {!selectedSessionId ? (
              <EmptyState message="Choose a session to inspect its recorded timeline." />
            ) : isLoadingFrames ? (
              <EmptyState message="Loading cognitive snapshot..." />
            ) : frames.length === 0 ? (
              <EmptyState message="This session has no frames yet." />
            ) : (
              <div className="space-y-4">
                {frames.map((frame) => (
                  <article
                    key={frame.id}
                    className="rounded-3xl border border-slate-800 bg-slate-950/70 p-5"
                  >
                    <div className="mb-4 flex flex-wrap items-center gap-3">
                      <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200">
                        #{frame.sequence}
                      </span>
                      <FrameBadge type={frame.frameType} />
                      {frame.role ? (
                        <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
                          {frame.role}
                        </span>
                      ) : null}
                      {frame.toolName ? (
                        <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200">
                          {frame.toolName}
                        </span>
                      ) : null}
                      {isReplayFrame(frame.metadata) ? (
                        <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">
                          replay
                        </span>
                      ) : null}
                      <span className="ml-auto text-xs text-slate-500">{frame.createdAt}</span>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                      <Panel title="Content" value={frame.content} />
                      <Panel title="Metadata" value={frame.metadata} />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-right">
      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[320px] items-center justify-center rounded-3xl border border-dashed border-slate-800 bg-slate-950/40 p-8 text-center text-sm text-slate-400">
      {message}
    </div>
  );
}

function FrameBadge({ type }: { type: Frame["frameType"] }) {
  const badgeClass =
    type === "llm_turn"
      ? "border-sky-500/30 bg-sky-500/10 text-sky-200"
      : type === "tool_call"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
        : type === "tool_result"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
          : "border-slate-700 bg-slate-800 text-slate-200";

  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-medium ${badgeClass}`}>
      {type}
    </span>
  );
}

function Panel({ title, value }: { title: string; value: JsonValue }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
        {title}
      </h3>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

function isReplayFrame(metadata: JsonValue): boolean {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return false;
  }

  return metadata.is_replay === true;
}

export default App;
