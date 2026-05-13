import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface Note {
  id: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export function openDb(dbPath = "notes.sqlite"): Database.Database {
  const db = new Database(resolve(dbPath));
  db.pragma("journal_mode = WAL");
  db.exec(readFileSync(resolve(__dirname, "schema.sql"), "utf8"));
  return db;
}

export function listNotes(db: Database.Database): Note[] {
  return db
    .prepare("SELECT id, title, body, created_at, updated_at FROM notes ORDER BY updated_at DESC")
    .all()
    .map(mapRow);
}

export function getNote(db: Database.Database, id: number): Note | null {
  const row = db
    .prepare("SELECT id, title, body, created_at, updated_at FROM notes WHERE id = ?")
    .get(id);
  return row ? mapRow(row) : null;
}

export function createNote(db: Database.Database, title: string, body: string): Note {
  const result = db
    .prepare("INSERT INTO notes (title, body) VALUES (?, ?)")
    .run(title, body);
  return getNote(db, Number(result.lastInsertRowid)) as Note;
}

export function updateNote(
  db: Database.Database,
  id: number,
  title: string,
  body: string,
): Note | null {
  db.prepare(
    "UPDATE notes SET title = ?, body = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
  ).run(title, body, id);
  return getNote(db, id);
}

export function deleteNote(db: Database.Database, id: number): boolean {
  return db.prepare("DELETE FROM notes WHERE id = ?").run(id).changes > 0;
}

function mapRow(row: unknown): Note {
  const r = row as { id: number; title: string; body: string; created_at: string; updated_at: string };
  return { id: r.id, title: r.title, body: r.body, createdAt: r.created_at, updatedAt: r.updated_at };
}
