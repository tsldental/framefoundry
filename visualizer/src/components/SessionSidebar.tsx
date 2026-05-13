import type { SessionSummary } from "../types";

interface SessionSidebarProps {
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
  sessions,
  selectedSessionId,
  isLoading,
  onRefresh,
  onSelectSession,
}: SessionSidebarProps) {
  const sessionTree = buildSessionTree(sessions);

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
        <div className="mt-1 text-lg font-semibold text-white">{sessions.length}</div>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400">Loading sessions...</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-slate-400">No sessions recorded yet.</p>
      ) : (
        <div className="space-y-2">
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

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => onSelectSession(node.sessionId)}
        className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
          isSelected
            ? "border-cyan-400/40 bg-cyan-400/10 text-white shadow-lg shadow-cyan-950/30"
            : "border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-900"
        }`}
        style={{
          marginLeft: `${indent}px`,
          width: `calc(100% - ${indent}px)`,
        }}
      >
        <div className="flex items-start gap-3">
          <div className="pt-0.5 font-mono text-xs text-cyan-400/80">
            {node.depth === 0 ? "●" : "└"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{node.sessionId}</div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.22em] text-slate-500">
              {node.branchRootFrameId ? `Forked at frame #${node.branchRootFrameId}` : "Root session"}
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

function buildSessionTree(sessions: SessionSummary[]): SessionTreeNode[] {
  const nodes = new Map<string, SessionTreeNode>();

  for (const session of sessions) {
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
