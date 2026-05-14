import { useCallback, useEffect, useState } from "react";
import { CopyButton } from "./components/CopyButton";
import { ForkModal } from "./components/ForkModal";
import { FrameTimeline } from "./components/FrameTimeline";
import { NotesApp } from "./components/NotesApp";
import { ResumeModal } from "./components/ResumeModal";
import { SessionSidebar } from "./components/SessionSidebar";
import type {
  CopilotHandoffResult,
  Frame,
  ProjectContext,
  ResumeResult,
  SessionCompareResult,
  SessionFramesResponse,
  SessionSummary,
  SessionsResponse,
  WorkspaceRestoreResult,
} from "./types";

type Tab = "sessions" | "notes";

interface StatusNotice {
  message: string;
  resumeCommand?: string;
  restoredBranch?: string;
  backupRef?: string;
  handoff?: CopilotHandoffResult;
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("sessions");
  const [project, setProject] = useState<ProjectContext | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [compareResult, setCompareResult] = useState<SessionCompareResult | null>(null);
  const [selectedFrameId, setSelectedFrameId] = useState<number | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingFrames, setIsLoadingFrames] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<StatusNotice | null>(null);
  const [forkFrame, setForkFrame] = useState<Frame | null>(null);
  const [isResumeModalOpen, setIsResumeModalOpen] = useState(false);
  const selectedSession =
    sessions.find((session) => session.sessionId === selectedSessionId) ?? null;

  const loadSessions = useCallback(async (preferredSessionId?: string) => {
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

      if (normalizedSessions.length === 0) {
        setFrames([]);
        setCompareResult(null);
        setSelectedFrameId(null);
      }

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
  }, []);

  const loadCompare = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/compare`);

      if (!response.ok) {
        setCompareResult(null);
        return;
      }

      const payload = (await response.json()) as SessionCompareResult;
      setCompareResult(payload);
    } catch {
      setCompareResult(null);
    }
  }, []);

  const loadFrames = useCallback(async (sessionId: string) => {
    setIsLoadingFrames(true);
    setError(null);

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);

      if (!response.ok) {
        throw new Error(`Failed to load session ${sessionId}: ${response.status}`);
      }

      const payload = (await response.json()) as SessionFramesResponse;
      setFrames(payload.frames);
      await loadCompare(sessionId);
      setSelectedFrameId(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setCompareResult(null);
    } finally {
      setIsLoadingFrames(false);
    }
  }, [loadCompare]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadSessions();
    });
  }, [loadSessions]);

  useEffect(() => {
    const projectSuffix = project ? ` — ${project.name}` : "";
    document.title = `framefoundry${projectSuffix}`;
  }, [project]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }

    queueMicrotask(() => {
      void loadFrames(selectedSessionId);
    });
  }, [loadFrames, selectedSessionId]);

  async function forkFromFrame(frame: Frame) {
    setForkFrame(frame);
  }

  function resumeSession() {
    if (selectedSessionId) {
      setIsResumeModalOpen(true);
    }
  }

  async function handleForkConfirm(newPrompt: string, options: { launchHandoff: boolean }) {
    if (!selectedSessionId || !forkFrame) return;
    setForkFrame(null);
    setError(null);
    setStatusNotice(null);

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(selectedSessionId)}/fork`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          frameId: forkFrame.id,
          newPrompt,
          launchHandoff: options.launchHandoff,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `Failed to fork from frame ${forkFrame.id}`);
      }

      const payload = (await response.json()) as {
        forkSessionId: string;
        frames: Frame[];
        workspaceRestore?: WorkspaceRestoreResult;
        resumeCommand?: string;
        handoff?: CopilotHandoffResult;
      };

      setSelectedSessionId(payload.forkSessionId);
      setFrames(payload.frames);
      setSelectedFrameId(null);
      setStatusNotice(formatForkStatusNotice(payload.workspaceRestore, payload.resumeCommand, payload.handoff));
      await loadSessions(payload.forkSessionId);
    } catch (forkError) {
      setError(forkError instanceof Error ? forkError.message : String(forkError));
    }
  }

  async function handleResumeConfirm(newPrompt: string, options: { launchHandoff: boolean }) {
    if (!selectedSessionId) {
      return;
    }

    setIsResumeModalOpen(false);
    setError(null);
    setStatusNotice(null);

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(selectedSessionId)}/resume`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          newPrompt,
          launchHandoff: options.launchHandoff,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `Failed to resume session ${selectedSessionId}`);
      }

      const payload = (await response.json()) as ResumeResult;
      setSelectedSessionId(payload.resumedSessionId);
      setFrames(payload.frames);
      setSelectedFrameId(null);
      setStatusNotice({
        message: formatResumeStatusMessage(payload.resumedSessionId, payload.handoff),
        resumeCommand: payload.resumeCommand,
        handoff: payload.handoff,
      });
      await loadSessions(payload.resumedSessionId);
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : String(resumeError));
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-8 lg:px-8">
        <header className="mb-8 flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-8 shadow-2xl shadow-slate-950/40 backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.3em] text-cyan-400">
                Copilot Safety Net
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">
                {activeTab === "sessions" ? "Keep the good path, undo the bad one" : "Notes"}
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
                  {project.snapshotMode ? (
                    <span className="rounded-full border border-cyan-400/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.22em] text-cyan-200">
                      {project.snapshotMode} snapshots
                    </span>
                  ) : null}
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
              ? "FrameFoundry turns Copilot work into something you can safely revisit: save checkpoints, branch from the last good moment, and resume without losing momentum."
              : "Keep supporting notes next to your saved paths and recovery points."}
          </p>
        </header>

        {error ? (
          <div className="mb-6 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        {statusNotice ? (
          <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{statusNotice.message}</span>
              <div className="flex flex-wrap gap-2">
                {statusNotice.resumeCommand ? (
                  <CopyButton
                    value={statusNotice.resumeCommand}
                    label="Copy resume command"
                    className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-100 transition hover:border-emerald-300 hover:bg-emerald-500/20"
                  />
                ) : null}
                {statusNotice.restoredBranch ? (
                  <CopyButton
                    value={statusNotice.restoredBranch}
                    label="Copy branch"
                    className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-100 transition hover:border-emerald-300 hover:bg-emerald-500/20"
                  />
                ) : null}
                {statusNotice.backupRef ? (
                  <CopyButton
                    value={statusNotice.backupRef}
                    label="Copy backup ref"
                    className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-100 transition hover:border-emerald-300 hover:bg-emerald-500/20"
                  />
                ) : null}
                {statusNotice.handoff?.prompt ? (
                  <CopyButton
                    value={statusNotice.handoff.prompt}
                    label="Copy Copilot prompt"
                    className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-100 transition hover:border-emerald-300 hover:bg-emerald-500/20"
                  />
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "sessions" ? <SafetyNetPanel /> : null}

        <div className="grid flex-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          {activeTab === "notes" ? (
            <div className="lg:col-span-2">
              <NotesApp />
            </div>
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
                compareResult={compareResult}
                isLoading={isLoadingFrames}
                selectedFrameId={selectedFrameId}
                onSelectFrame={(frame) => setSelectedFrameId(frame.id)}
                onForkFromFrame={forkFromFrame}
                onResumeSession={resumeSession}
              />
            </>
          )}
        </div>
      </div>

      {forkFrame ? (
        <ForkModal
          sessionId={selectedSessionId ?? ""}
          frame={forkFrame}
          onConfirm={(prompt, options) => void handleForkConfirm(prompt, options)}
          onCancel={() => setForkFrame(null)}
        />
      ) : null}

      {isResumeModalOpen && selectedSession ? (
        <ResumeModal
          sessionHeadline={selectedSession.headline}
          onConfirm={(prompt, options) => void handleResumeConfirm(prompt, options)}
          onCancel={() => setIsResumeModalOpen(false)}
        />
      ) : null}
    </div>
  );
}

export default App;

function SafetyNetPanel() {
  return (
    <section className="mb-6 grid gap-4 rounded-3xl border border-slate-800 bg-slate-900/60 p-5 shadow-xl shadow-slate-950/20 lg:grid-cols-3">
      <SafetyNetCard
        title="1. Record your work"
        body="Start a Copilot run through FrameFoundry and it quietly keeps the path, checkpoints, and branch history for you."
        accent="cyan"
      />
      <SafetyNetCard
        title="2. Branch from the last good moment"
        body="If the agent drifts, pick the frame where things still looked right and branch safely from there."
        accent="emerald"
      />
      <SafetyNetCard
        title="3. Recover and keep going"
        body="Restore the matching workspace state, copy the resume command, and continue as if you had stayed on the better path all along."
        accent="violet"
      />
    </section>
  );
}

function SafetyNetCard({
  title,
  body,
  accent,
}: {
  title: string;
  body: string;
  accent: "cyan" | "emerald" | "violet";
}) {
  const accentClass =
    accent === "cyan"
      ? "border-cyan-400/20 bg-cyan-400/5"
      : accent === "emerald"
        ? "border-emerald-400/20 bg-emerald-400/5"
        : "border-violet-400/20 bg-violet-400/5";
  const titleClass =
    accent === "cyan"
      ? "text-cyan-200"
      : accent === "emerald"
        ? "text-emerald-200"
        : "text-violet-200";

  return (
    <div className={`rounded-2xl border p-4 ${accentClass}`}>
      <div className={`text-sm font-semibold ${titleClass}`}>{title}</div>
      <p className="mt-2 text-sm leading-6 text-slate-300">{body}</p>
    </div>
  );
}

function normalizeProjectContext(project: ProjectContext | undefined): ProjectContext | null {
  if (!project) {
    return null;
  }

  return {
    name: typeof project.name === "string" && project.name.trim() ? project.name : "unknown-project",
    projectPath: typeof project.projectPath === "string" ? project.projectPath : "",
    dbPath: typeof project.dbPath === "string" ? project.dbPath : "",
    configPath: typeof project.configPath === "string" ? project.configPath : null,
    snapshotMode:
      project.snapshotMode === "assistant" || project.snapshotMode === "off"
        ? project.snapshotMode
        : "prompt",
    retentionPolicy:
      project.retentionPolicy &&
      typeof project.retentionPolicy.snapshotsPerSession === "number" &&
      typeof project.retentionPolicy.backupsPerSession === "number"
        ? project.retentionPolicy
        : undefined,
    handoff:
      project.handoff &&
      (project.handoff.provider === "manual" || project.handoff.provider === "github-copilot-vscode")
        ? {
            provider: project.handoff.provider,
            editorCommand:
              typeof project.handoff.editorCommand === "string" ? project.handoff.editorCommand : null,
          }
        : undefined,
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

function formatForkStatusNotice(
  workspaceRestore: WorkspaceRestoreResult | undefined,
  resumeCommand?: string,
  handoff?: CopilotHandoffResult,
): StatusNotice | null {
  if (!workspaceRestore) {
    return {
      message: formatForkStatusMessage("Fork created.", handoff),
      resumeCommand,
      handoff,
    };
  }

  if (workspaceRestore.applied && workspaceRestore.restoredBranch && workspaceRestore.snapshotCommit) {
    return {
      message: formatForkStatusMessage(
        `Fork created on branch ${workspaceRestore.restoredBranch} from Git snapshot ${workspaceRestore.snapshotCommit.slice(0, 12)}.`,
        handoff,
      ),
      resumeCommand,
      restoredBranch: workspaceRestore.restoredBranch,
      backupRef: workspaceRestore.backupRef ?? undefined,
      handoff,
    };
  }

  if (workspaceRestore.reason) {
    return {
      message: formatForkStatusMessage(
        `Fork created without restoring files from Git: ${workspaceRestore.reason}`,
        handoff,
      ),
      resumeCommand,
      handoff,
    };
  }

  return {
    message: formatForkStatusMessage("Fork created.", handoff),
    resumeCommand,
    handoff,
  };
}

function formatForkStatusMessage(baseMessage: string, handoff?: CopilotHandoffResult): string {
  if (!handoff) {
    return baseMessage;
  }

  if (handoff.launched) {
    return `${baseMessage} Opened ${handoff.providerLabel} and copied the continuation prompt.`;
  }

  if (handoff.copiedPrompt) {
    return `${baseMessage} Copied a continuation prompt for ${handoff.providerLabel}.`;
  }

  if (handoff.launchRequested && handoff.reason) {
    return `${baseMessage} ${handoff.reason}`;
  }

  return baseMessage;
}

function formatResumeStatusMessage(resumedSessionId: string, handoff?: CopilotHandoffResult): string {
  const baseMessage = `Resumed into session ${resumedSessionId.slice(-12)}.`;

  if (!handoff) {
    return baseMessage;
  }

  if (handoff.launched) {
    return `${baseMessage} Opened ${handoff.providerLabel} and copied the continuation prompt.`;
  }

  if (handoff.copiedPrompt) {
    return `${baseMessage} Copied a continuation prompt for ${handoff.providerLabel}.`;
  }

  if (handoff.launchRequested && handoff.reason) {
    return `${baseMessage} ${handoff.reason}`;
  }

  return baseMessage;
}
