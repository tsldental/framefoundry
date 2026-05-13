import Database from "better-sqlite3";

export interface Note {
  id: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewNote {
  title?: string;
  body?: string;
}

export interface UpdateNote {
  title?: string;
  body?: string;
}

interface NoteRow {
  id: number;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

function mapNoteRow(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class NoteStore {
  private readonly db: Database.Database;
  private readonly listStatement: Database.Statement;
  private readonly getStatement: Database.Statement;
  private readonly insertStatement: Database.Statement;
  private readonly updateStatement: Database.Statement;
  private readonly deleteStatement: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;

    this.listStatement = this.db.prepare(`
      SELECT id, title, body, created_at, updated_at
      FROM notes
      ORDER BY updated_at DESC
    `);

    this.getStatement = this.db.prepare(`
      SELECT id, title, body, created_at, updated_at
      FROM notes
      WHERE id = ?
    `);

    this.insertStatement = this.db.prepare(`
      INSERT INTO notes (title, body)
      VALUES (@title, @body)
    `);

    this.updateStatement = this.db.prepare(`
      UPDATE notes
      SET title = @title,
          body  = @body,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = @id
    `);

    this.deleteStatement = this.db.prepare(`
      DELETE FROM notes WHERE id = ?
    `);
  }

  list(): Note[] {
    return (this.listStatement.all() as NoteRow[]).map(mapNoteRow);
  }

  get(id: number): Note | null {
    const row = this.getStatement.get(id) as NoteRow | undefined;
    return row ? mapNoteRow(row) : null;
  }

  create(input: NewNote): Note {
    const result = this.insertStatement.run({
      title: input.title ?? "",
      body: input.body ?? "",
    });
    return this.get(Number(result.lastInsertRowid)) as Note;
  }

  update(id: number, input: UpdateNote): Note | null {
    const existing = this.get(id);
    if (!existing) return null;

    this.updateStatement.run({
      id,
      title: input.title ?? existing.title,
      body: input.body ?? existing.body,
    });

    return this.get(id);
  }

  delete(id: number): boolean {
    const result = this.deleteStatement.run(id);
    return result.changes > 0;
  }
}
