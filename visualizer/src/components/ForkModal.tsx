import { useEffect, useRef, useState } from "react";
import { CopyButton } from "./CopyButton";
import type { ForkPreviewResult, Frame } from "../types";

interface ForkModalProps {
  sessionId: string;
  frame: Frame;
  onConfirm: (prompt: string, options: { launchHandoff: boolean }) => void;
  onCancel: () => void;
}

export function ForkModal({ sessionId, frame, onConfirm, onCancel }: ForkModalProps) {
  const [prompt, setPrompt] = useState("Take this in a new direction.");
  const [launchHandoff, setLaunchHandoff] = useState(true);
  const [preview, setPreview] = useState<ForkPreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.select();
  }, []);

  useEffect(() => {
    let cancelled = false;

    void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/fork-preview?frameId=${frame.id}`)
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? `Failed to preview fork from frame ${frame.id}`);
        }

        return (await response.json()) as ForkPreviewResult;
      })
      .then((payload) => {
        if (!cancelled) {
          setPreview(payload);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPreviewError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [frame.id, sessionId]);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      onCancel();
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      const trimmed = prompt.trim();
      if (trimmed) onConfirm(trimmed, { launchHandoff });
    }
  }

  function handleConfirm() {
    const trimmed = prompt.trim();
    if (trimmed) onConfirm(trimmed, { launchHandoff });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl shadow-slate-950/60">
        <div className="mb-5">
          <div className="mb-2 text-xs uppercase tracking-[0.25em] text-cyan-400">Fork Session</div>
          <h2 className="text-lg font-semibold text-white">
            Continue from Frame #{frame.sequence}
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            Start a new branch from this snapshot with a fresh prompt. FrameFoundry restores the
            latest recorded Git checkpoint at or before this frame, then continues with the full
            recorded context up to this point.
          </p>
        </div>

        <div className="mb-1 flex items-center gap-2">
          <FrameTypeBadge type={frame.frameType} />
          {frame.toolName ? (
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-xs text-cyan-200">
              {frame.toolName}
            </span>
          ) : null}
        </div>

        <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
          <div className="text-[11px] uppercase tracking-[0.25em] text-cyan-300">Restore Preview</div>
          {previewError ? (
            <p className="mt-2 text-rose-300">{previewError}</p>
          ) : preview ? (
            <div className="mt-2 space-y-1 text-xs leading-5 text-slate-300">
              <p>
                <span className="text-slate-500">Branch:</span>{" "}
                <span className="font-mono">{preview.restorePlan.plannedBranch ?? "Unavailable"}</span>
                {preview.restorePlan.plannedBranch ? (
                  <CopyButton
                    value={preview.restorePlan.plannedBranch}
                    label="Copy"
                    className="ml-2 rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-300 transition hover:border-slate-600 hover:text-white"
                  />
                ) : null}
              </p>
              <p>
                <span className="text-slate-500">Snapshot:</span>{" "}
                <span className="font-mono">
                  {preview.restorePlan.snapshotCommit
                    ? preview.restorePlan.snapshotCommit.slice(0, 12)
                    : "No recorded snapshot"}
                </span>
              </p>
              <p>
                <span className="text-slate-500">Snapshot frame:</span>{" "}
                {preview.latestSnapshotFrameId ?? "None"}
              </p>
              <p>
                <span className="text-slate-500">Backup refs:</span>{" "}
                <span className="font-mono">{preview.restorePlan.backupRefPrefix ?? "Unavailable"}</span>
                {preview.restorePlan.backupRefPrefix ? (
                  <CopyButton
                    value={preview.restorePlan.backupRefPrefix}
                    label="Copy"
                    className="ml-2 rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-300 transition hover:border-slate-600 hover:text-white"
                  />
                ) : null}
              </p>
              {preview.restorePlan.reason ? (
                <p className="text-amber-300">{preview.restorePlan.reason}</p>
              ) : (
                <p className="text-emerald-300">Workspace files will be restored before the fork continues.</p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-slate-500">Loading preview…</p>
          )}
        </div>

        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={4}
          placeholder="Enter your new direction…"
          className="mt-3 w-full resize-none rounded-2xl border border-slate-700 bg-slate-800/80 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/60 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
          autoFocus
        />

        <label className="mt-3 flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={launchHandoff}
            onChange={(event) => setLaunchHandoff(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-900 text-cyan-400 focus:ring-cyan-500/40"
          />
          <span>
            <span className="font-medium text-slate-100">Open GitHub Copilot in VS Code after branching</span>
            <span className="mt-1 block text-xs leading-5 text-slate-500">
              FrameFoundry will open the restored workspace in a new VS Code window and copy a continuation prompt for Copilot Chat.
            </span>
          </span>
        </label>

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">⌘↵ to confirm · Esc to cancel</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-slate-700 px-4 py-1.5 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!prompt.trim()}
              className="rounded-full border border-cyan-400/40 bg-cyan-400/15 px-4 py-1.5 text-sm font-medium text-cyan-100 transition hover:border-cyan-300 hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Fork
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FrameTypeBadge({ type }: { type: Frame["frameType"] }) {
  const cls =
    type === "llm_turn"
      ? "border-sky-500/30 bg-sky-500/10 text-sky-200"
      : type === "tool_call"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
        : type === "tool_result"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
          : "border-slate-700 bg-slate-800 text-slate-200";

  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>{type}</span>
  );
}
