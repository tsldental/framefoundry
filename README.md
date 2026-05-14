# framefoundry

**framefoundry** is a local-first **Deterministic Agent Virtual Machine (dAVM)** for recording, replaying, branching, and visualizing AI agent execution.

It captures every meaningful step of an agent session as a persistent SQLite timeline so you can:

- **record** agent turns and tool calls
- **replay** sessions deterministically from recorded tool outputs
- **fork** execution from an earlier frame and continue in a new direction
- **inspect** the full cognitive timeline in a local visualizer

<p align="center">
  <img src="docs/images/framefoundry-architecture.svg" alt="framefoundry architecture overview" width="900">
</p>

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

Any selected frame can become a branch point. A fork clones the historical state up to the selected frame, tags the new branch with `branch_root_frame_id`, restores the latest recorded Git snapshot at or before that frame into a new branch, and then continues from there with a new prompt.

<p align="center">
  <img src="docs/images/non-linear-debugging.svg" alt="Branching and forking from a historical frame in framefoundry" width="900">
</p>

### Local visualizer

The included React dashboard provides:

- session navigation
- nested branch navigation for forked sessions
- frame timeline inspection
- source-session compare summaries for forks and resumes
- tool call / tool result grouping
- raw JSON inspection
- frame selection and forking from the UI
- copy actions for planned branches, backup refs, and resume commands

<p align="center">
  <img src="docs/images/visualizer-snapshots.svg" alt="framefoundry visualizer showing session tree and cognitive snapshots" width="900">
</p>

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
- Git

### Install

```powershell
Set-Location 'C:\path\to\framefoundry'
npm install
npm --prefix visualizer install
```

### Build

```powershell
Set-Location 'C:\path\to\framefoundry'
npm run build
```

## Using framefoundry on a real project today

framefoundry can now target another project folder directly with `--project`, and it can start the built visualizer and API bridge together with a single command.

The key idea is:

- **framefoundry repo** = the runtime, recorder, replay engine, and visualizer
- **your project folder** = the working directory the agent operates in

Today, the simplest way to use framefoundry on a real project is to build it once, then point the CLI at your project with `--project`.

### What happens in a real-project run

When you do this correctly:

1. the agent runs with **your project folder** as its working directory
2. `davm.sqlite` is created in **your project folder**
3. the visualizer reads that project-specific SQLite file
4. live runs can record hidden Git checkpoints for later restore
5. forks and replays stay attached to that same project timeline

### Snapshot cadence controls

Recording commands now support:

- `--snapshot-mode prompt` — save a checkpoint after each completed prompt cycle
- `--snapshot-mode assistant` — save a checkpoint after each assistant message
- `--snapshot-mode off` — disable automatic checkpoints

If you want a checkpoint on demand, you can also create one manually with the CLI:

```powershell
node dist\index.js snapshot create <sessionId>
```

### Project config file

You can keep persistent defaults with your tracked project by creating `framefoundry.config.json` in the project root:

```json
{
  "snapshotMode": "assistant",
  "retention": {
    "snapshotsPerSession": 25,
    "backupsPerSession": 10
  }
}
```

Supported keys:

- `snapshotMode` — `prompt`, `assistant`, or `off`
- `retention.snapshotsPerSession` — how many internal snapshot refs to keep per session
- `retention.backupsPerSession` — how many internal backup refs to keep per session

CLI flags still override config values when you need a one-off run, and you can point to a different config file with `--config <path>`.

### Git-backed workspace restore

For Git repositories, framefoundry records internal snapshot refs under `refs/framefoundry/...` and uses them during fork.

Snapshot and backup retention now happens automatically after new internal refs are created, using the active project policy.

When you fork from the visualizer:

1. framefoundry finds the latest recorded Git snapshot at or before the selected frame
2. it saves the current workspace to a backup ref
3. it restores the selected snapshot into a new Git branch
4. it starts the forked Copilot continuation from that restored file state

If the project is not in Git, or the selected frame predates recorded snapshots, framefoundry still creates the forked session but reports that workspace restore was unavailable.

### Real-project quickstart

#### 1. Build framefoundry once

From the framefoundry repo:

```powershell
Set-Location 'C:\path\to\framefoundry'
npm install
npm --prefix visualizer install
npm run build
```

#### 2. Start the local app for your project

From any terminal, run:

```powershell
Set-Location 'C:\path\to\framefoundry'
node dist\index.js start --project 'C:\path\to\your-project' --open
```

That command:

- starts the API bridge
- serves the built visualizer on the same port
- opens the browser for you
- points the database at `C:\path\to\your-project\davm.sqlite`
- automatically uses the packaged `schema.sql` if your project does not already have one

By default the local app runs at:

```text
http://localhost:3001
```

#### 3. Record a session against that project

In another terminal:

```powershell
Set-Location 'C:\path\to\framefoundry'
node dist\index.js record --project 'C:\path\to\your-project' "Inspect this project and propose the next build step."
```

That run will use your project folder as the agent working directory and record into that project's `davm.sqlite`.

### Recommended terminal layout

For the easiest ongoing workflow:

1. **Terminal A** — `node dist\index.js start --project 'C:\path\to\your-project' --open`
2. **Terminal B** — `node dist\index.js record --project 'C:\path\to\your-project' "..."`

### What is manual right now

framefoundry does **not** yet automatically attach itself to a normal GitHub Copilot chat window or every Copilot CLI session on your machine.

At the moment you must:

- launch the session through framefoundry's CLI
- keep the local app running while you want to browse the project timeline

### Current limitations

- The visualizer only shows the database exposed by the currently running local app.
- Recording still happens through framefoundry's CLI, not by auto-attaching to every Copilot session.
- `davm start` serves the built visualizer, so you should run `npm run build` after making frontend changes.
- File restore is only as granular as the Git checkpoints that were recorded for that session.
- Snapshot and backup refs are internal Git refs, so you should use the provided cleanup commands rather than editing them manually.
- Automatic retention only manages internal framefoundry refs; it does not touch your branches, tags, or normal Git history.

The next natural improvement is a deeper Copilot integration that can attach to a live coding workflow with less manual launching.

## CLI usage

The CLI entry point is `davm`.

### Record a session

```powershell
node dist\index.js record "Explain deterministic replay."
```

To record against a specific project:

```powershell
node dist\index.js record --project 'C:\path\to\your-project' "Build the next feature."
```

To use an explicit project config file:

```powershell
node dist\index.js record --project 'C:\path\to\your-project' --config 'C:\path\to\your-project\framefoundry.config.json' "Build the next feature."
```

With explicit checkpoint cadence:

```powershell
node dist\index.js record --project 'C:\path\to\your-project' --snapshot-mode assistant "Build the next feature."
```

### Replay a session

```powershell
node dist\index.js replay <sessionId>
```

To replay a session for a specific project:

```powershell
node dist\index.js replay --project 'C:\path\to\your-project' <sessionId>
```

Example:

```powershell
Set-Location 'C:\path\to\framefoundry'
node dist\index.js replay --project 'C:\path\to\your-project' 3289b7d4-b710-4a59-91c9-3abbadcb0300
```

What replay does:

1. loads the recorded session frames
2. re-runs the session using recorded tool results instead of fresh live tool output
3. writes a **new replay session** into the same project database

What to do after replay finishes:

1. open framefoundry for that project
2. click **Refresh**
3. look for the new replay session
4. open it and compare it against the original

What you should expect to see in the visualizer:

- a separate new session, not an overwrite of the original
- replay-tagged frames
- the same general path as the original run, but driven by recorded tool data

### Inspect a session log

```powershell
node dist\index.js log <sessionId>
```

### Preview a fork

```powershell
node dist\index.js fork-preview <sessionId> <frameId> --project 'C:\path\to\your-project'
```

### Fork from the CLI

```powershell
node dist\index.js fork <sessionId> <frameId> "Take this in a new direction." --project 'C:\path\to\your-project'
```

### Resume from an existing session

```powershell
node dist\index.js resume <sessionId> "Continue from here." --project 'C:\path\to\your-project'
```

### Manage internal Git refs

List internal refs:

```powershell
node dist\index.js snapshot list --project 'C:\path\to\your-project'
```

Prune all but the newest matching ref:

```powershell
node dist\index.js snapshot prune --project 'C:\path\to\your-project' --kind snapshot --keep 1
```

### Start the local app

```powershell
node dist\index.js start --project 'C:\path\to\your-project' --open
```

### Start only the API bridge

```powershell
node dist\index.js serve --project 'C:\path\to\your-project' --port 3001
```

## Running the visualizer

If you use `davm start`, you do not need a separate Vite dev server. The built visualizer is served automatically on the same port as the API bridge.

### Start the API bridge manually

```powershell
Set-Location 'C:\path\to\framefoundry'
npm run serve
```

### Start the frontend in development mode

In a second terminal:

```powershell
Set-Location 'C:\path\to\framefoundry'
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

### `GET /api/sessions/:id/compare`

Returns the detected source session, inherited/new frame counts, and high-level divergence metrics for the selected session.

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

### `GET /api/sessions/:id/fork-preview?frameId=<id>`

Returns the planned branch name, latest matching snapshot, and whether workspace restore is available before a fork runs.

### `POST /api/sessions/:id/resume`

Starts a new continuation from the latest frame in an existing session.

Request body:

```json
{
  "newPrompt": "Continue from here."
}
```

### `GET /api/git/refs`

Lists internal framefoundry snapshot and backup refs.

### `POST /api/git/refs/prune`

Prunes matching internal framefoundry refs.

## Example workflow

1. Record a session with the CLI.
2. Open the visualizer and inspect the timeline.
3. Select a frame.
4. Check the fork preview to confirm the planned branch and snapshot.
5. Click **Fork from here**.
6. FrameFoundry restores the latest recorded Git snapshot at or before that frame into a new branch.
7. Continue the session with a new prompt, or later use `davm resume` to keep going from the resulting session.

## Repository layout

```text
src/
  agent.ts
  db.ts
  git.ts
  index.ts
  replay.ts
  server.ts
tests/
  git.test.js
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
