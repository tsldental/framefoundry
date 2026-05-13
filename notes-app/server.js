const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3456;

// Initialize DB from schema
const db = new Database(path.join(__dirname, 'notes.sqlite'));
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// List all notes
app.get('/notes', (req, res) => {
  res.json(db.prepare('SELECT * FROM notes ORDER BY updated_at DESC').all());
});

// Get one note
app.get('/notes/:id', (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  note ? res.json(note) : res.status(404).json({ error: 'Not found' });
});

// Create a note
app.post('/notes', (req, res) => {
  const { title = '', body = '' } = req.body;
  const result = db.prepare('INSERT INTO notes (title, body) VALUES (?, ?)').run(title, body);
  res.status(201).json(db.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid));
});

// Update a note
app.put('/notes/:id', (req, res) => {
  const { title, body } = req.body;
  db.prepare(
    "UPDATE notes SET title = ?, body = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
  ).run(title, body, req.params.id);
  res.json(db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id));
});

// Delete a note
app.delete('/notes/:id', (req, res) => {
  db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

app.listen(PORT, () => console.log(`Notes app running at http://localhost:${PORT}`));
