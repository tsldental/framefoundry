interface SessionSidebarProps {
  sessionIds: string[];
  selectedSessionId: string | null;
  isLoading: boolean;
  onRefresh: () => void;
  onSelectSession: (sessionId: string) => void;
}

export function SessionSidebar({
  sessionIds,
  selectedSessionId,
  isLoading,
  onRefresh,
  onSelectSession,
}: SessionSidebarProps) {
  return (
    <aside className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl shadow-slate-950/30">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">
            Sessions
          </h2>
          <p className="mt-1 text-xs text-slate-500">Recorded SQLite timelines</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200 transition hover:border-cyan-300 hover:bg-cyan-400/20"
        >
          Refresh
        </button>
      </div>

      <div className="mb-4 rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3">
        <div className="text-[11px] uppercase tracking-[0.25em] text-slate-500">Total</div>
        <div className="mt-1 text-lg font-semibold text-white">{sessionIds.length}</div>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400">Loading sessions...</p>
      ) : sessionIds.length === 0 ? (
        <p className="text-sm text-slate-400">No sessions recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {sessionIds.map((sessionId) => (
            <button
              key={sessionId}
              type="button"
              onClick={() => onSelectSession(sessionId)}
              className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
                sessionId === selectedSessionId
                  ? "border-cyan-400/40 bg-cyan-400/10 text-white shadow-lg shadow-cyan-950/30"
                  : "border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-900"
              }`}
            >
              <div className="truncate font-medium">{sessionId}</div>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
