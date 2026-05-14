import { execFile } from "node:child_process";
import { platform } from "node:os";
import chalk from "chalk";
import { Command } from "commander";
import { runAgentDemo } from "./agent";
import { openFrameStore, resolveDavmPaths, type DavmRuntimeOptions, type JsonValue } from "./db";
import { launchCopilotHandoff } from "./handoff";
import {
  createManualGitSnapshot,
  listFramefoundryRefs,
  pruneFramefoundryRefs,
} from "./git";
import { getForkPreview, runFork, runReplay, runResume } from "./replay";
import { startServer } from "./server";

const program = new Command();

program
  .name("davm")
  .description("Deterministic Agent Virtual Machine for recording and replaying agent sessions.")
  .version("0.1.0");

program
  .command("record")
  .argument("<prompt>", "Prompt to record")
  .option("--project <path>", "Project path")
  .option("--db-path <path>", "Database path")
  .option("--schema-path <path>", "Schema path")
  .option("--config <path>", "Path to a FrameFoundry project config file")
  .option("--snapshot-mode <mode>", "Snapshot cadence: prompt, assistant, or off")
  .action(async (prompt: string, commandOptions: CliOptions) => {
    const result = await runAgentDemo(prompt, toRuntimeOptions(commandOptions));
    printJson(result);
  });

program
  .command("replay")
  .argument("<sessionId>", "Session ID")
  .option("--project <path>", "Project path")
  .option("--db-path <path>", "Database path")
  .option("--schema-path <path>", "Schema path")
  .option("--config <path>", "Path to a FrameFoundry project config file")
  .action(async (sessionId: string, commandOptions: CliOptions) => {
    const result = await runReplay(sessionId, toRuntimeOptions(commandOptions));
    printJson(result);
  });

program
  .command("fork")
  .argument("<sessionId>", "Original session ID")
  .argument("<frameId>", "Frame ID to fork from")
  .argument("<prompt>", "Prompt for the forked continuation")
  .option("--project <path>", "Project path")
  .option("--db-path <path>", "Database path")
  .option("--schema-path <path>", "Schema path")
  .option("--config <path>", "Path to a FrameFoundry project config file")
  .option("--snapshot-mode <mode>", "Snapshot cadence: prompt, assistant, or off")
  .option("--launch-handoff", "Open the restored workspace in VS Code and copy a Copilot continuation prompt")
  .option("--handoff-provider <provider>", "Handoff provider: github-copilot-vscode or manual")
  .option("--editor-command <command>", "Editor command to use for handoff launch")
  .action(async (sessionId: string, frameId: string, prompt: string, commandOptions: CliOptions) => {
    const runtimeOptions = toRuntimeOptions(commandOptions);
    const result = await runFork(
      sessionId,
      Number(frameId),
      prompt,
      runtimeOptions,
    );
    const paths = resolveDavmPaths(runtimeOptions);
    printJson({
      ...result,
      handoff: launchCopilotHandoff(paths, {
        sessionId: result.forkSessionId,
        source: "fork",
        prompt,
        branchName: result.workspaceRestore.restoredBranch,
        launch: commandOptions.launchHandoff ?? false,
        providerId: commandOptions.handoffProvider,
        editorCommand: commandOptions.editorCommand,
      }),
    });
  });

program
  .command("fork-preview")
  .argument("<sessionId>", "Original session ID")
  .argument("<frameId>", "Frame ID to inspect")
  .option("--project <path>", "Project path")
  .option("--db-path <path>", "Database path")
  .option("--schema-path <path>", "Schema path")
  .option("--config <path>", "Path to a FrameFoundry project config file")
  .action((sessionId: string, frameId: string, commandOptions: CliOptions) => {
    const result = getForkPreview(sessionId, Number(frameId), toRuntimeOptions(commandOptions));
    printJson(result);
  });

program
  .command("resume")
  .argument("<sessionId>", "Session ID to resume from")
  .argument("<prompt>", "Prompt for the resumed continuation")
  .option("--project <path>", "Project path")
  .option("--db-path <path>", "Database path")
  .option("--schema-path <path>", "Schema path")
  .option("--config <path>", "Path to a FrameFoundry project config file")
  .option("--snapshot-mode <mode>", "Snapshot cadence: prompt, assistant, or off")
  .option("--launch-handoff", "Open the restored workspace in VS Code and copy a Copilot continuation prompt")
  .option("--handoff-provider <provider>", "Handoff provider: github-copilot-vscode or manual")
  .option("--editor-command <command>", "Editor command to use for handoff launch")
  .action(async (sessionId: string, prompt: string, commandOptions: CliOptions) => {
    const runtimeOptions = toRuntimeOptions(commandOptions);
    const result = await runResume(sessionId, prompt, runtimeOptions);
    const paths = resolveDavmPaths(runtimeOptions);
    printJson({
      ...result,
      handoff: launchCopilotHandoff(paths, {
        sessionId: result.resumedSessionId,
        source: "resume",
        prompt,
        launch: commandOptions.launchHandoff ?? false,
        providerId: commandOptions.handoffProvider,
        editorCommand: commandOptions.editorCommand,
      }),
    });
  });

program
  .command("log")
  .argument("<sessionId>", "Session ID")
  .option("--project <path>", "Project path")
  .option("--db-path <path>", "Database path")
  .option("--schema-path <path>", "Schema path")
  .option("--config <path>", "Path to a FrameFoundry project config file")
  .action((sessionId: string, commandOptions: CliOptions) => {
    const db = openFrameStore(toRuntimeOptions(commandOptions));

    try {
      const frames = db.listFrames(sessionId);
      printJson({ sessionId, frames });
    } finally {
      db.close();
    }
  });

program
  .command("start")
  .option("--project <path>", "Project path")
  .option("--db-path <path>", "Database path")
  .option("--schema-path <path>", "Schema path")
  .option("--config <path>", "Path to a FrameFoundry project config file")
  .option("--port <port>", "Port", parseInteger)
  .option("--open", "Open in the default browser")
  .option("--snapshot-mode <mode>", "Snapshot cadence: prompt, assistant, or off")
  .action(async (commandOptions: CliOptions & { port?: number; open?: boolean }) => {
    const runtimeOptions = toRuntimeOptions(commandOptions);
    const port = commandOptions.port ?? 3001;

    await startServer({
      ...runtimeOptions,
      port,
      serveVisualizer: true,
    });

    if (commandOptions.open) {
      openUrl(`http://localhost:${port}`);
    }
  });

program
  .command("serve")
  .option("--project <path>", "Project path")
  .option("--db-path <path>", "Database path")
  .option("--schema-path <path>", "Schema path")
  .option("--config <path>", "Path to a FrameFoundry project config file")
  .option("--port <port>", "Port", parseInteger)
  .option("--snapshot-mode <mode>", "Snapshot cadence: prompt, assistant, or off")
  .action(async (commandOptions: CliOptions & { port?: number }) => {
    await startServer({
      ...toRuntimeOptions(commandOptions),
      port: commandOptions.port ?? 3001,
      serveVisualizer: false,
    });
  });

const snapshotCommand = program
  .command("snapshot")
  .description("Manage internal framefoundry Git snapshots and backups.");

snapshotCommand
  .command("create")
  .argument("<sessionId>", "Session ID")
  .argument("[frameId]", "Frame ID to checkpoint; defaults to the latest frame in the session")
  .option("--project <path>", "Project path")
  .option("--db-path <path>", "Database path")
  .option("--schema-path <path>", "Schema path")
  .option("--config <path>", "Path to a FrameFoundry project config file")
  .action((sessionId: string, frameId: string | undefined, commandOptions: CliOptions) => {
    const runtimeOptions = toRuntimeOptions(commandOptions);
    const db = openFrameStore(runtimeOptions);

    try {
      const frames = db.listFrames(sessionId);

      if (frames.length === 0) {
        throw new Error(`No recorded frames found for session "${sessionId}"`);
      }

      const targetFrameId = frameId ? Number(frameId) : frames.at(-1)?.id;

      if (!targetFrameId) {
        throw new Error("No frame could be selected for the snapshot.");
      }

      const targetFrame = db.getFrame(targetFrameId);

      if (!targetFrame || targetFrame.sessionId !== sessionId) {
        throw new Error(`Frame ${targetFrameId} was not found in session "${sessionId}"`);
      }

      const result = createManualGitSnapshot(resolveDavmPaths(runtimeOptions), sessionId, targetFrameId);

      if (result.available && result.metadata) {
        db.updateFrameMetadata(targetFrameId, {
          ...(typeof targetFrame.metadata === "object" && targetFrame.metadata !== null && !Array.isArray(targetFrame.metadata)
            ? targetFrame.metadata
            : {}),
          git_snapshot: toJsonObject(result.metadata),
        });
      }

      printJson(result);
    } finally {
      db.close();
    }
  });

snapshotCommand
  .command("list")
  .option("--project <path>", "Project path")
  .option("--db-path <path>", "Database path")
  .option("--schema-path <path>", "Schema path")
  .option("--config <path>", "Path to a FrameFoundry project config file")
  .option("--kind <kind>", "snapshot, backup, or all", "all")
  .option("--session <sessionId>", "Filter by session ID")
  .action((commandOptions: CliOptions & { kind?: "snapshot" | "backup" | "all"; session?: string }) => {
    const result = listFramefoundryRefs(resolveDavmPaths(toRuntimeOptions(commandOptions)), {
      kind: commandOptions.kind ?? "all",
      sessionId: commandOptions.session,
    });
    printJson(result);
  });

snapshotCommand
  .command("prune")
  .option("--project <path>", "Project path")
  .option("--db-path <path>", "Database path")
  .option("--schema-path <path>", "Schema path")
  .option("--config <path>", "Path to a FrameFoundry project config file")
  .option("--kind <kind>", "snapshot, backup, or all", "all")
  .option("--session <sessionId>", "Filter by session ID")
  .option("--keep <count>", "Number of matching refs to keep", parseInteger, 0)
  .action((commandOptions: CliOptions & { kind?: "snapshot" | "backup" | "all"; session?: string; keep?: number }) => {
    const result = pruneFramefoundryRefs(resolveDavmPaths(toRuntimeOptions(commandOptions)), {
      kind: commandOptions.kind ?? "all",
      sessionId: commandOptions.session,
      keep: commandOptions.keep ?? 0,
    });
    printJson(result);
  });

void program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red(message));
  process.exitCode = 1;
});

interface CliOptions {
  project?: string;
  dbPath?: string;
  schemaPath?: string;
  configPath?: string;
  snapshotMode?: "prompt" | "assistant" | "off";
  launchHandoff?: boolean;
  handoffProvider?: "github-copilot-vscode" | "manual";
  editorCommand?: string;
}

function toRuntimeOptions(options: CliOptions): DavmRuntimeOptions {
  const snapshotMode =
    options.snapshotMode === "assistant" ||
    options.snapshotMode === "off" ||
    options.snapshotMode === "prompt"
      ? options.snapshotMode
      : undefined;

  return {
    projectPath: options.project,
    dbPath: options.dbPath,
    schemaPath: options.schemaPath,
    configPath: options.configPath,
    snapshotMode,
    handoff: {
      provider: options.handoffProvider,
      editorCommand: options.editorCommand,
    },
  };
}

function parseInteger(value: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Error(`Expected an integer but received "${value}"`);
  }

  return parsed;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function openUrl(url: string): void {
  const targetPlatform = platform();

  if (targetPlatform === "win32") {
    execFile("cmd", ["/c", "start", "", url], { windowsHide: true });
    return;
  }

  if (targetPlatform === "darwin") {
    execFile("open", [url]);
    return;
  }

  execFile("xdg-open", [url]);
}

function toJsonObject(value: object): JsonValue {
  const normalizedObject: Record<string, JsonValue> = {};

  for (const [key, entry] of Object.entries(value)) {
    normalizedObject[key] = toJsonValue(entry);
  }

  return normalizedObject;
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    return toJsonObject(value);
  }

  return String(value);
}
