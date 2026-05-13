import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type FrameType =
  | "llm_turn"
  | "tool_call"
  | "tool_result"
  | "system_event";

export type FrameRole = "user" | "assistant" | "system" | "tool";

export interface Frame {
  id: number;
  sessionId: string;
  sequence: number;
  frameType: FrameType;
  parentFrameId: number | null;
  branchRootFrameId: number | null;
  role: FrameRole | null;
  toolName: string | null;
  toolCallId: string | null;
  content: JsonValue;
  metadata: JsonValue;
  createdAt: string;
}

export interface NewFrame {
  sessionId: string;
  frameType: FrameType;
  content: JsonValue;
  sequence?: number;
  parentFrameId?: number | null;
  branchRootFrameId?: number | null;
  role?: FrameRole | null;
  toolName?: string | null;
  toolCallId?: string | null;
  metadata?: JsonValue;
}

export interface RecordAgentTurnInput {
  sessionId: string;
  role: Exclude<FrameRole, "tool">;
  content: string;
  prompt?: JsonValue;
  response?: JsonValue;
  parentFrameId?: number | null;
  branchRootFrameId?: number | null;
  metadata?: JsonValue;
  sequence?: number;
}

export interface RecordToolCallInput {
  sessionId: string;
  toolName: string;
  args: JsonValue;
  toolCallId?: string;
  parentFrameId?: number | null;
  branchRootFrameId?: number | null;
  metadata?: JsonValue;
  sequence?: number;
}

export interface RecordToolResultInput {
  sessionId: string;
  toolName: string;
  result: JsonValue;
  toolCallId?: string;
  parentFrameId?: number | null;
  branchRootFrameId?: number | null;
  metadata?: JsonValue;
  sequence?: number;
}

interface FrameRow {
  id: number;
  session_id: string;
  sequence: number;
  frame_type: FrameType;
  parent_frame_id: number | null;
  branch_root_frame_id: number | null;
  role: FrameRole | null;
  tool_name: string | null;
  tool_call_id: string | null;
  content_json: string;
  metadata_json: string;
  created_at: string;
}

export interface FrameStoreOptions {
  dbPath?: string;
  schemaPath?: string;
}

export interface ToolRegistryEntry {
  toolCallId: string;
  sessionId: string;
  toolName: string;
  toolCallFrameId: number | null;
  toolResultFrameId: number | null;
  toolArgs: JsonValue;
  toolResult: JsonValue | null;
  metadata: JsonValue;
  createdAt: string;
  updatedAt: string;
}

interface ToolRegistryEntryRow {
  tool_call_id: string;
  session_id: string;
  tool_name: string;
  tool_call_frame_id: number | null;
  tool_result_frame_id: number | null;
  tool_args_json: string;
  tool_result_json: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export class FrameStore {
  readonly db: Database.Database;
  private readonly insertFrameStatement: Database.Statement;
  private readonly selectFrameStatement: Database.Statement;
  private readonly selectFramesBySessionStatement: Database.Statement;
  private readonly selectSessionIdsStatement: Database.Statement;
  private readonly nextSequenceStatement: Database.Statement;
  private readonly upsertToolCallRegistryStatement: Database.Statement;
  private readonly updateToolResultRegistryStatement: Database.Statement;
  private readonly selectRegistryEntryStatement: Database.Statement;
  private readonly selectRegistryEntriesBySessionStatement: Database.Statement;

  constructor(options: FrameStoreOptions = {}) {
    const dbPath = resolve(options.dbPath ?? "davm.sqlite");
    const schemaPath = resolve(options.schemaPath ?? "schema.sql");

    ensureParentDirectory(dbPath);

    this.db = new Database(dbPath);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.exec(readFileSync(schemaPath, "utf8"));

    this.insertFrameStatement = this.db.prepare(`
      INSERT INTO frames (
        session_id,
        sequence,
        frame_type,
        parent_frame_id,
        branch_root_frame_id,
        role,
        tool_name,
        tool_call_id,
        content_json,
        metadata_json
      ) VALUES (
        @sessionId,
        @sequence,
        @frameType,
        @parentFrameId,
        @branchRootFrameId,
        @role,
        @toolName,
        @toolCallId,
        @contentJson,
        @metadataJson
      )
    `);

    this.selectFrameStatement = this.db.prepare(`
      SELECT
        id,
        session_id,
        sequence,
        frame_type,
        parent_frame_id,
        branch_root_frame_id,
        role,
        tool_name,
        tool_call_id,
        content_json,
        metadata_json,
        created_at
      FROM frames
      WHERE id = ?
    `);

    this.selectFramesBySessionStatement = this.db.prepare(`
      SELECT
        id,
        session_id,
        sequence,
        frame_type,
        parent_frame_id,
        branch_root_frame_id,
        role,
        tool_name,
        tool_call_id,
        content_json,
        metadata_json,
        created_at
      FROM frames
      WHERE session_id = ?
      ORDER BY sequence ASC
    `);

    this.selectSessionIdsStatement = this.db.prepare(`
      SELECT DISTINCT session_id
      FROM frames
      ORDER BY created_at DESC
    `);

    this.nextSequenceStatement = this.db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS nextSequence
      FROM frames
      WHERE session_id = ?
    `);

    this.upsertToolCallRegistryStatement = this.db.prepare(`
      INSERT INTO tool_registry_entries (
        tool_call_id,
        session_id,
        tool_name,
        tool_call_frame_id,
        tool_args_json,
        metadata_json
      ) VALUES (
        @toolCallId,
        @sessionId,
        @toolName,
        @toolCallFrameId,
        @toolArgsJson,
        @metadataJson
      )
      ON CONFLICT(tool_call_id) DO UPDATE SET
        session_id = excluded.session_id,
        tool_name = excluded.tool_name,
        tool_call_frame_id = excluded.tool_call_frame_id,
        tool_args_json = excluded.tool_args_json,
        metadata_json = excluded.metadata_json,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `);

    this.updateToolResultRegistryStatement = this.db.prepare(`
      UPDATE tool_registry_entries
      SET
        tool_result_frame_id = @toolResultFrameId,
        tool_result_json = @toolResultJson,
        metadata_json = @metadataJson,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE tool_call_id = @toolCallId
    `);

    this.selectRegistryEntryStatement = this.db.prepare(`
      SELECT
        tool_call_id,
        session_id,
        tool_name,
        tool_call_frame_id,
        tool_result_frame_id,
        tool_args_json,
        tool_result_json,
        metadata_json,
        created_at,
        updated_at
      FROM tool_registry_entries
      WHERE tool_call_id = ?
    `);

    this.selectRegistryEntriesBySessionStatement = this.db.prepare(`
      SELECT
        tool_call_id,
        session_id,
        tool_name,
        tool_call_frame_id,
        tool_result_frame_id,
        tool_args_json,
        tool_result_json,
        metadata_json,
        created_at,
        updated_at
      FROM tool_registry_entries
      WHERE session_id = ?
      ORDER BY created_at ASC, tool_call_id ASC
    `);
  }

  close(): void {
    this.db.close();
  }

  getNextSequence(sessionId: string): number {
    const row = this.nextSequenceStatement.get(sessionId) as {
      nextSequence: number;
    };

    return row.nextSequence;
  }

  getFrame(frameId: number): Frame | null {
    const row = this.selectFrameStatement.get(frameId) as FrameRow | undefined;
    return row ? mapFrameRow(row) : null;
  }

  listFrames(sessionId: string): Frame[] {
    const rows = this.selectFramesBySessionStatement.all(sessionId) as FrameRow[];
    return rows.map(mapFrameRow);
  }

  listSessionIds(): string[] {
    const rows = this.selectSessionIdsStatement.all() as Array<{ session_id: string }>;
    return rows.map((row) => row.session_id);
  }

  getRegistryEntry(toolCallId: string): ToolRegistryEntry | null {
    const row = this.selectRegistryEntryStatement.get(toolCallId) as
      | ToolRegistryEntryRow
      | undefined;
    return row ? mapToolRegistryEntryRow(row) : null;
  }

  listRegistryEntries(sessionId: string): ToolRegistryEntry[] {
    const rows = this.selectRegistryEntriesBySessionStatement.all(
      sessionId,
    ) as ToolRegistryEntryRow[];
    return rows.map(mapToolRegistryEntryRow);
  }

  recordFrame(frame: NewFrame): Frame {
    return this.db.transaction((candidate: NewFrame) => {
      const sequence = candidate.sequence ?? this.getNextSequence(candidate.sessionId);
      const result = this.insertFrameStatement.run({
        sessionId: candidate.sessionId,
        sequence,
        frameType: candidate.frameType,
        parentFrameId: candidate.parentFrameId ?? null,
        branchRootFrameId: candidate.branchRootFrameId ?? null,
        role: candidate.role ?? null,
        toolName: candidate.toolName ?? null,
        toolCallId: candidate.toolCallId ?? null,
        contentJson: serializeJson(candidate.content),
        metadataJson: serializeJson(candidate.metadata ?? {}),
      });

      return this.getFrame(Number(result.lastInsertRowid)) as Frame;
    })(frame);
  }

  recordAgentTurn(input: RecordAgentTurnInput): Frame {
    return this.recordFrame({
      sessionId: input.sessionId,
      frameType: "llm_turn",
      role: input.role,
      sequence: input.sequence,
      parentFrameId: input.parentFrameId,
      branchRootFrameId: input.branchRootFrameId,
      metadata: input.metadata ?? {},
      content: {
        content: input.content,
        prompt: input.prompt ?? null,
        response: input.response ?? null,
      },
    });
  }

  recordToolCall(input: RecordToolCallInput): Frame {
    const toolCallId = input.toolCallId ?? randomUUID();

    return this.db.transaction((candidate: RecordToolCallInput) => {
      const frame = this.recordFrame({
        sessionId: candidate.sessionId,
        frameType: "tool_call",
        role: "tool",
        toolName: candidate.toolName,
        toolCallId,
        sequence: candidate.sequence,
        parentFrameId: candidate.parentFrameId,
        branchRootFrameId: candidate.branchRootFrameId,
        metadata: candidate.metadata ?? {},
        content: {
          args: candidate.args,
        },
      });

      this.upsertToolCallRegistryStatement.run({
        toolCallId,
        sessionId: candidate.sessionId,
        toolName: candidate.toolName,
        toolCallFrameId: frame.id,
        toolArgsJson: serializeJson(candidate.args),
        metadataJson: serializeJson(candidate.metadata ?? {}),
      });

      return frame;
    })(input);
  }

  recordToolResult(input: RecordToolResultInput): Frame {
    if (!input.toolCallId) {
      throw new Error("toolCallId is required to record a tool result");
    }

    return this.db.transaction((candidate: RecordToolResultInput) => {
      const frame = this.recordFrame({
        sessionId: candidate.sessionId,
        frameType: "tool_result",
        role: "tool",
        toolName: candidate.toolName,
        toolCallId: candidate.toolCallId,
        sequence: candidate.sequence,
        parentFrameId: candidate.parentFrameId,
        branchRootFrameId: candidate.branchRootFrameId,
        metadata: candidate.metadata ?? {},
        content: {
          result: candidate.result,
        },
      });

      const updateResult = this.updateToolResultRegistryStatement.run({
        toolCallId: candidate.toolCallId,
        toolResultFrameId: frame.id,
        toolResultJson: serializeJson(candidate.result),
        metadataJson: serializeJson(candidate.metadata ?? {}),
      });

      if (updateResult.changes === 0) {
        throw new Error(
          `No tool registry entry found for toolCallId "${candidate.toolCallId}"`,
        );
      }

      return frame;
    })(input);
  }
}

export function openFrameStore(options: FrameStoreOptions = {}): FrameStore {
  return new FrameStore(options);
}

function ensureParentDirectory(filePath: string): void {
  const parentDirectory = dirname(filePath);

  if (!existsSync(parentDirectory)) {
    mkdirSync(parentDirectory, { recursive: true });
  }
}

function serializeJson(value: JsonValue): string {
  return JSON.stringify(value);
}

function parseJson(value: string): JsonValue {
  return JSON.parse(value) as JsonValue;
}

function mapFrameRow(row: FrameRow): Frame {
  return {
    id: row.id,
    sessionId: row.session_id,
    sequence: row.sequence,
    frameType: row.frame_type,
    parentFrameId: row.parent_frame_id,
    branchRootFrameId: row.branch_root_frame_id,
    role: row.role,
    toolName: row.tool_name,
    toolCallId: row.tool_call_id,
    content: parseJson(row.content_json),
    metadata: parseJson(row.metadata_json),
    createdAt: row.created_at,
  };
}

function mapToolRegistryEntryRow(row: ToolRegistryEntryRow): ToolRegistryEntry {
  return {
    toolCallId: row.tool_call_id,
    sessionId: row.session_id,
    toolName: row.tool_name,
    toolCallFrameId: row.tool_call_frame_id,
    toolResultFrameId: row.tool_result_frame_id,
    toolArgs: parseJson(row.tool_args_json),
    toolResult: row.tool_result_json ? parseJson(row.tool_result_json) : null,
    metadata: parseJson(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
