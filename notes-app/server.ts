import express from "express";
import type Database from "better-sqlite3";
import { listNotes, getNote, createNote, updateNote, deleteNote } from "./store";

export function createNotesServer(db: Database.Database) {
  const app = express();
  app.use(express.json());

  app.get("/notes", (_req, res) => {
    res.json(listNotes(db));
  });

  app.get("/notes/:id", (req, res) => {
    const note = getNote(db, Number(req.params.id));
    note ? res.json(note) : res.status(404).json({ error: "Not found" });
  });

  app.post("/notes", (req, res) => {
    const { title = "", body = "" } = req.body ?? {};
    res.status(201).json(createNote(db, String(title), String(body)));
  });

  app.put("/notes/:id", (req, res) => {
    const note = getNote(db, Number(req.params.id));
    if (!note) { res.status(404).json({ error: "Not found" }); return; }
    const { title = note.title, body = note.body } = req.body ?? {};
    res.json(updateNote(db, Number(req.params.id), String(title), String(body)));
  });

  app.delete("/notes/:id", (req, res) => {
    deleteNote(db, Number(req.params.id))
      ? res.status(204).end()
      : res.status(404).json({ error: "Not found" });
  });

  return app;
}
