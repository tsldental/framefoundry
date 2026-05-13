# framefoundry

**framefoundry** is a local-first **Deterministic Agent Virtual Machine (dAVM)** for recording, replaying, branching, and visualizing AI agent execution.

It captures every meaningful step of an agent session as a persistent SQLite timeline so you can:

- **record** agent turns and tool calls
- **replay** sessions deterministically from recorded tool outputs
- **fork** execution from an earlier frame and continue in a new direction
- **inspect** the full cognitive timeline in a local visualizer

## Why framefoundry exists

Modern agent workflows are powerful, but they are hard to debug. Once a tool call has executed or a model response has streamed back, the exact execution path is often gone.

framefoundry treats agent execution like a navigable runtime:

- each LLM turn becomes a **Frame**
- each tool invocation becomes a **Frame**
- each tool result is stored for deterministic reuse
- each branch preserves its origin through **`branch_root_frame_id`**

The result is an environment where agent behavior can be replayed, inspected, and evolved instead of merely observed once.

## Core capabilities

### Recording

The runtime stores agent activity in SQLite using a `frames` table plus a tool registry:

- `llm_turn`
- `tool_call`
- `tool_result`
- `system_event`

Tool inputs and outputs are persisted so replay can short-circuit live execution.

### Deterministic replay

Recorded sessions can be replayed using the saved tool registry instead of making live tool calls. This allows the runtime to reconstruct prior execution using recorded data.

### Forking

framefoundry turns branching into **Non-Linear Debugging**: developers can **rewind and refactor** agent reasoning by forking from any historical frame.

Any selected frame can become a branch point. A fork clones the historical state up to the selected frame, tags the new branch with `branch_root_frame_id`, and then continues from there with a new prompt.

### Local visualizer

The included React dashboard provides:

- session navigation
- nested branch navigation for forked sessions
- frame timeline inspection
- tool call / tool result grouping
- raw JSON inspection
- frame selection and forking from the UI

## Architecture

### SQLite persistence

The SQLite layer is the foundation of the runtime.

- **`frames`** stores ordered session state
- **`tool_registry_entries`** stores replayable tool I/O

### Runtime services

- **`src/db.ts`** — typed SQLite persistence and frame registry
- **`src/agent.ts`** — Copilot SDK orchestration and recording hooks
- **`src/replay.ts`** — replay and fork execution logic
- **`src/server.ts`** — Express bridge for the visualizer
- **`src/index.ts`** — CLI entry point

### Frontend

- **`visualizer/`** — Vite + React + Tailwind visualizer

## Getting started

### Prerequisites

- Node.js 24+
- npm

### Install

```powershell
Set-Location 'C:\Users\Todd\dAVM'
npm install
npm --prefix visualizer install
```

### Build

```powershell
Set-Location 'C:\Users\Todd\dAVM'
npm run build
```

## CLI usage

The CLI entry point is `davm`.

### Record a session

```powershell
node dist\index.js record "Explain deterministic replay."
```

### Replay a session

```powershell
node dist\index.js replay <sessionId>
```

### Inspect a session log

```powershell
node dist\index.js log <sessionId>
```

## Running the visualizer

### Start the API bridge

```powershell
Set-Location 'C:\Users\Todd\dAVM'
npm run serve
```

### Start the frontend

In a second terminal:

```powershell
Set-Location 'C:\Users\Todd\dAVM'
npm run visualizer:dev
```

Then open:

```text
http://localhost:5173
```

## HTTP API

The Express bridge exposes:

### `GET /api/sessions`

Returns all known session IDs.

### `GET /api/sessions/:id`

Returns all frames for a session ordered by sequence.

### `POST /api/sessions/:id/replay`

Runs deterministic replay for a recorded session.

### `POST /api/sessions/:id/fork`

Forks execution from a selected frame.

Request body:

```json
{
  "frameId": 42,
  "newPrompt": "Take this in a different direction."
}
```

## Example workflow

1. Record a session with the CLI.
2. Open the visualizer and inspect the timeline.
3. Select a frame.
4. Click **Fork from here**.
5. Continue the session with a new prompt.

## Repository layout

```text
src/
  agent.ts
  db.ts
  index.ts
  replay.ts
  server.ts
visualizer/
  src/
schema.sql
```

## Status

framefoundry already includes the core dAVM loop:

- recording
- deterministic replay
- branching / forking
- local visualization

The next natural layer is deeper state navigation, richer frame filtering, and more advanced replay controls.
