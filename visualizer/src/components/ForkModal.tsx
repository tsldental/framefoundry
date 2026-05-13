import { useEffect, useRef, useState } from "react";
import type { Frame } from "../types";

interface ForkModalProps {
  frame: Frame;
  onConfirm: (prompt: string) => void;
  onCancel: () => void;
}

export function ForkModal({ frame, onConfirm, onCancel }: ForkModalProps) {
  const [prompt, setPrompt] = useState("Take this in a new direction.");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.select();
  }, []);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      onCancel();
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      const trimmed = prompt.trim();
      if (trimmed) onConfirm(trimmed);
    }
  }

  function handleConfirm() {
    const trimmed = prompt.trim();
    if (trimmed) onConfirm(trimmed);
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
            Start a new branch from this snapshot with a fresh prompt. The forked session inherits
            all context up to this frame.
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
