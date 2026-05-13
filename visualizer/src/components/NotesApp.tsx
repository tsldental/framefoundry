import { useEffect, useRef, useState } from "react";
import type { Note } from "../types";

type DraftNote = { title: string; body: string };

const EMPTY_DRAFT: DraftNote = { title: "", body: "" };

export function NotesApp() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftNote>(EMPTY_DRAFT);
  const [isNew, setIsNew] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadNotes();
  }, []);

  async function loadNotes() {
    try {
      const res = await fetch("/api/notes");
      if (!res.ok) throw new Error(`Failed to load notes: ${res.status}`);
      const payload = (await res.json()) as { notes: Note[] };
      setNotes(payload.notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function selectNote(note: Note) {
    setSelectedId(note.id);
    setDraft({ title: note.title, body: note.body });
    setIsNew(false);
    setError(null);
  }

  function startNew() {
    setSelectedId(null);
    setDraft(EMPTY_DRAFT);
    setIsNew(true);
    setError(null);
    setTimeout(() => titleRef.current?.focus(), 0);
  }

  async function save() {
    if (!draft.title.trim() && !draft.body.trim()) return;
    setIsSaving(true);
    setError(null);

    try {
      if (isNew) {
        const res = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        if (!res.ok) throw new Error(`Save failed: ${res.status}`);
        const payload = (await res.json()) as { note: Note };
        setNotes((prev) => [payload.note, ...prev]);
        setSelectedId(payload.note.id);
        setIsNew(false);
      } else if (selectedId !== null) {
        const res = await fetch(`/api/notes/${selectedId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        if (!res.ok) throw new Error(`Save failed: ${res.status}`);
        const payload = (await res.json()) as { note: Note };
        setNotes((prev) => prev.map((n) => (n.id === selectedId ? payload.note : n)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteNote() {
    if (selectedId === null) return;
    if (!window.confirm("Delete this note?")) return;
    setError(null);

    try {
      const res = await fetch(`/api/notes/${selectedId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setNotes((prev) => prev.filter((n) => n.id !== selectedId));
      setSelectedId(null);
      setDraft(EMPTY_DRAFT);
      setIsNew(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const hasEditor = isNew || selectedId !== null;
  const isDirty =
    hasEditor &&
    (() => {
      if (isNew) return draft.title !== "" || draft.body !== "";
      const original = notes.find((n) => n.id === selectedId);
      return original ? draft.title !== original.title || draft.body !== original.body : false;
    })();

  return (
    <div className="flex flex-1 gap-6 overflow-hidden">
      {/* Sidebar — note list */}
      <aside className="flex w-64 flex-shrink-0 flex-col gap-3 rounded-3xl border border-slate-800 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 backdrop-blur">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Notes
          </span>
          <button
            type="button"
            onClick={startNew}
            className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200 transition hover:border-cyan-300 hover:bg-cyan-400/20"
          >
            + New
          </button>
        </div>

        {notes.length === 0 ? (
          <p className="mt-4 text-center text-xs text-slate-500">No notes yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 overflow-y-auto">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => selectNote(note)}
                  className={`w-full rounded-xl px-3 py-2 text-left transition ${
                    selectedId === note.id
                      ? "border border-cyan-500/40 bg-cyan-500/10 text-white"
                      : "border border-transparent text-slate-300 hover:bg-slate-800/60"
                  }`}
                >
                  <p className="truncate text-sm font-medium">
                    {note.title || <span className="italic text-slate-500">Untitled</span>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {note.body || <span className="italic">No content</span>}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* Editor pane */}
      <div className="flex flex-1 flex-col rounded-3xl border border-slate-800 bg-slate-900/70 shadow-2xl shadow-slate-950/40 backdrop-blur">
        {!hasEditor ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-slate-500">Select a note or create a new one.</p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-0 overflow-hidden">
            <div className="border-b border-slate-800 p-6 pb-4">
              <input
                ref={titleRef}
                type="text"
                placeholder="Title"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                className="w-full bg-transparent text-2xl font-semibold text-white placeholder:text-slate-600 focus:outline-none"
              />
            </div>

            <textarea
              placeholder="Start writing…"
              value={draft.body}
              onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              className="flex-1 resize-none bg-transparent p-6 text-sm leading-relaxed text-slate-200 placeholder:text-slate-600 focus:outline-none"
            />

            <div className="flex items-center justify-between border-t border-slate-800 px-6 py-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={isSaving || !isDirty}
                  className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-4 py-1.5 text-sm font-medium text-cyan-200 transition hover:border-cyan-300 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSaving ? "Saving…" : "Save"}
                </button>
                {!isNew && selectedId !== null && (
                  <button
                    type="button"
                    onClick={() => void deleteNote()}
                    className="rounded-full border border-rose-500/40 bg-rose-500/10 px-4 py-1.5 text-sm font-medium text-rose-300 transition hover:border-rose-400 hover:bg-rose-500/20"
                  >
                    Delete
                  </button>
                )}
              </div>

              {error && <p className="text-xs text-rose-400">{error}</p>}

              {!isNew && selectedId !== null && (
                <p className="text-xs text-slate-600">
                  {notes.find((n) => n.id === selectedId)?.updatedAt.slice(0, 10) ?? ""}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
