CREATE TABLE IF NOT EXISTS frames (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  frame_type TEXT NOT NULL CHECK (
    frame_type IN ('llm_turn', 'tool_call', 'tool_result', 'system_event')
  ),
  parent_frame_id INTEGER REFERENCES frames(id),
  branch_root_frame_id INTEGER REFERENCES frames(id),
  role TEXT,
  tool_name TEXT,
  tool_call_id TEXT,
  content_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(session_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_frames_session_sequence
  ON frames(session_id, sequence);

CREATE INDEX IF NOT EXISTS idx_frames_parent
  ON frames(parent_frame_id);

CREATE INDEX IF NOT EXISTS idx_frames_branch_root
  ON frames(branch_root_frame_id);

CREATE INDEX IF NOT EXISTS idx_frames_tool_call
  ON frames(tool_call_id);

CREATE TABLE IF NOT EXISTS tool_registry_entries (
  tool_call_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_call_frame_id INTEGER REFERENCES frames(id),
  tool_result_frame_id INTEGER REFERENCES frames(id),
  tool_args_json TEXT NOT NULL,
  tool_result_json TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_tool_registry_session
  ON tool_registry_entries(session_id);

CREATE INDEX IF NOT EXISTS idx_tool_registry_call_frame
  ON tool_registry_entries(tool_call_frame_id);

CREATE INDEX IF NOT EXISTS idx_tool_registry_result_frame
  ON tool_registry_entries(tool_result_frame_id);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_notes_updated
  ON notes(updated_at DESC);
