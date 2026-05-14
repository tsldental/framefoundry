import { useState } from "react";
import type { ProjectContext, SessionSummary } from "../types";
import { formatTimestamp, shortSessionId } from "../utils";

interface SessionSidebarProps {
  project: ProjectContext | null;
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  isLoading: boolean;
  onRefresh: () => void;
  onSelectSession: (sessionId: string) => void;
}

interface SessionTreeNode extends SessionSummary {
  depth: number;
  children: SessionTreeNode[];
}

interface SessionTreeItemProps {
  node: SessionTreeNode;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
}

export function SessionSidebar({
  project,
  sessions,
  selectedSessionId,
  isLoading,
  onRefresh,
  onSelectSession,
}: SessionSidebarProps) {
  const [filter, setFilter] = useState("");
  const sessionTree = buildSessionTree(sessions, filter);

  const matchCount = filter
    ? sessions.filter(
        (s) =>
          s.headline.toLowerCase().includes(filter.toLowerCase()) ||
          s.sessionId.toLowerCase().includes(filter.toLowerCase()) ||
          s.latestSummary.toLowerCase().includes(filter.toLowerCase()),
      ).length
    : sessions.length;

  return (
    <aside className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl shadow-slate-950/30">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">
            Saved paths
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {project ? `${project.name} branch and recovery history` : "Your Copilot safety net history"}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200 transition hover:border-cyan-300 hover:bg-cyan-400/20"
        >
          Refresh
        </button>
      </div>

      {/* Search / filter */}
      <input
        type="search"
        placeholder="Filter sessions…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-cyan-500/60 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
      />

      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3">
        <div className="text-[11px] uppercase tracking-[0.25em] text-slate-500">
          {filter ? "Matches" : "Total"}
        </div>
        <div className="mt-1 text-lg font-semibold text-white">{matchCount}</div>
      </div>

      {project ? (
        <div
          className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3"
          title={`Project: ${project.projectPath}\nDatabase: ${project.dbPath}`}
        >
          <div className="text-[11px] uppercase tracking-[0.25em] text-cyan-300">Protected Project</div>
          <div className="mt-1 truncate text-sm font-semibold text-white">{project.name}</div>
          <div className="mt-1 truncate text-[11px] text-slate-400">{project.projectPath}</div>
          {project.retentionPolicy ? (
            <div className="mt-2 text-[11px] text-slate-400">
              Keeping {project.retentionPolicy.snapshotsPerSession} checkpoints / {project.retentionPolicy.backupsPerSession} recovery backups per session
            </div>
          ) : null}
          {project.handoff ? (
            <div className="mt-1 text-[11px] text-slate-400">
              Handoff: {project.handoff.provider === "github-copilot-vscode" ? "GitHub Copilot in VS Code" : "Manual"}
            </div>
          ) : null}
          {project.configPath ? (
            <div className="mt-1 truncate text-[11px] text-slate-500">{project.configPath}</div>
          ) : null}
        </div>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-slate-400">Loading saved paths...</p>
      ) : matchCount === 0 ? (
        <p className="text-sm text-slate-400">
          {filter
            ? "No saved paths match this filter."
            : "No saved paths yet. Start a recorded run and this becomes your recovery history."}
        </p>
      ) : (
        <div className="space-y-3 overflow-y-auto">
          {sessionTree.map((node) => (
            <SessionTreeItem
              key={node.sessionId}
              node={node}
              selectedSessionId={selectedSessionId}
              onSelectSession={onSelectSession}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

function SessionTreeItem({ node, selectedSessionId, onSelectSession }: SessionTreeItemProps) {
  const isSelected = node.sessionId === selectedSessionId;
  const indent = node.depth * 16;
  const tooltip = [node.sessionId, node.headline, node.latestSummary].join("\n\n");
  const timestamp = node.lastUpdatedAt || node.createdAt;
  const isBranch = node.branchRootFrameId !== null;
  const baseClass = isBranch
    ? "border-violet-500/30 bg-violet-500/8 text-slate-100 hover:border-violet-400/40 hover:bg-violet-500/14"
    : "border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-900";
  const selectedClass = isBranch
    ? "border-cyan-400/50 bg-violet-500/18 text-white shadow-lg shadow-violet-950/30"
    : "border-cyan-400/40 bg-cyan-400/10 text-white shadow-lg shadow-cyan-950/30";

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => onSelectSession(node.sessionId)}
        className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
          isSelected ? selectedClass : baseClass
        }`}
        style={{
          marginLeft: `${indent}px`,
          width: `calc(100% - ${indent}px)`,
        }}
        title={tooltip}
      >
        <div className="flex items-start gap-3">
          <div className="pt-0.5 font-mono text-xs text-cyan-400/80">
            {node.depth === 0 ? "●" : "└"}
          </div>
          <div className="min-w-0 flex-1">
            {/* Headline is now the primary display */}
            <div className="truncate font-semibold text-slate-100">{node.headline}</div>
            {/* Session ID as small secondary text */}
            <div className="mt-0.5 font-mono text-[10px] text-slate-500">
              …{shortSessionId(node.sessionId)}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-700 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-400">
                {node.frameCount} frames
              </span>
              {isBranch ? (
                <span className="rounded-full border border-violet-400/30 bg-violet-400/15 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-violet-100">
                  Forked
                </span>
              ) : (
                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-cyan-100">
                  Root Path
                </span>
              )}
              {node.childCount > 0 ? (
                <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-violet-200">
                  {node.childCount} branch{node.childCount === 1 ? "" : "es"}
                </span>
              ) : null}
              <span className="rounded-full border border-slate-700 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                {node.branchRootFrameId ? `Fork #${node.branchRootFrameId}` : "Root"}
              </span>
              {timestamp ? (
                <span className="ml-auto text-[10px] text-slate-600">
                  {formatTimestamp(timestamp)}
                </span>
              ) : null}
            </div>
            <div className="mt-2 line-clamp-2 text-[11px] leading-5 text-slate-500">
              {node.latestSummary}
            </div>
          </div>
        </div>
      </button>

      {node.children.map((childNode) => (
        <SessionTreeItem
          key={childNode.sessionId}
          node={childNode}
          selectedSessionId={selectedSessionId}
          onSelectSession={onSelectSession}
        />
      ))}
    </div>
  );
}

function buildSessionTree(sessions: SessionSummary[], filter = ""): SessionTreeNode[] {
  const lowerFilter = filter.toLowerCase();
  const filteredIds = filter
    ? new Set(
        sessions
          .filter(
            (s) =>
              s.headline.toLowerCase().includes(lowerFilter) ||
              s.sessionId.toLowerCase().includes(lowerFilter) ||
              s.latestSummary.toLowerCase().includes(lowerFilter),
          )
          .map((s) => s.sessionId),
      )
    : null;

  const nodes = new Map<string, SessionTreeNode>();

  for (const session of sessions) {
    if (filteredIds && !filteredIds.has(session.sessionId)) continue;
    nodes.set(session.sessionId, {
      ...session,
      depth: 0,
      children: [],
    });
  }

  const roots: SessionTreeNode[] = [];

  for (const node of nodes.values()) {
    const parentNode = node.parentSessionId ? nodes.get(node.parentSessionId) : undefined;

    if (parentNode) {
      parentNode.children.push(node);
      continue;
    }

    roots.push(node);
  }

  assignDepthsAndSort(roots, 0);
  return roots;
}

function assignDepthsAndSort(nodes: SessionTreeNode[], depth: number): void {
  nodes.sort((left, right) => {
    if (left.createdAt === right.createdAt) {
      return right.sessionId.localeCompare(left.sessionId);
    }

    return right.createdAt.localeCompare(left.createdAt);
  });

  for (const node of nodes) {
    node.depth = depth;
    assignDepthsAndSort(node.children, depth + 1);
  }
}
