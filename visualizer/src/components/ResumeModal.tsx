import { useEffect, useRef, useState } from "react";

interface ResumeModalProps {
  sessionHeadline: string;
  onConfirm: (prompt: string) => void;
  onCancel: () => void;
}

export function ResumeModal({ sessionHeadline, onConfirm, onCancel }: ResumeModalProps) {
  const [prompt, setPrompt] = useState("Continue from the current session state.");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.select();
  }, []);

  function handleConfirm() {
    const trimmed = prompt.trim();

    if (trimmed) {
      onConfirm(trimmed);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl shadow-slate-950/60">
        <div className="mb-5">
          <div className="mb-2 text-xs uppercase tracking-[0.25em] text-cyan-400">Resume Session</div>
          <h2 className="text-lg font-semibold text-white">{sessionHeadline}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            Start a new Copilot continuation from the latest frame in this session, using the
            recorded history as context.
          </p>
        </div>

        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={4}
          placeholder="Enter your continuation prompt…"
          className="mt-3 w-full resize-none rounded-2xl border border-slate-700 bg-slate-800/80 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/60 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
          autoFocus
        />

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">This creates a new session branch from the latest recorded frame.</p>
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
              Resume
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
