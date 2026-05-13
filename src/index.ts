#!/usr/bin/env node

import chalk from "chalk";
import { Command } from "commander";
import { runAgentDemo } from "./agent";
import { openFrameStore, type Frame, type JsonValue } from "./db";
import { runReplay } from "./replay";

export * from "./db";
export * from "./agent";
export * from "./replay";

export async function runCli(argv = process.argv): Promise<void> {
  const program = new Command();

  program
    .name("davm")
    .description("Deterministic Agent Virtual Machine for recording, replaying, and inspecting agent sessions.")
    .showHelpAfterError()
    .version("0.1.0");

  program
    .command("record")
    .description("Record a new agent run for the given prompt.")
    .argument("<prompt>", "Prompt to send to the agent")
    .action(async (prompt: string) => {
      const result = await runAgentDemo(prompt);
      console.log(
        `${chalk.green("Recorded session")} ${chalk.bold.cyan(result.sessionId)}`,
      );
    });

  program
    .command("replay")
    .description("Replay a recorded session deterministically from saved tool results.")
    .argument("<sessionId>", "Recorded session ID to replay")
    .action(async (sessionId: string) => {
      await runReplay(sessionId);
      console.log(
        `${chalk.cyan("Replaying Session...")} ${chalk.bold.green("[SUCCESS]")}`,
      );
    });

  program
    .command("log")
    .description("Show the cognitive snapshot history for a recorded session.")
    .argument("<sessionId>", "Session ID to inspect")
    .action((sessionId: string) => {
      const db = openFrameStore();

      try {
        const frames = db.listFrames(sessionId);

        if (frames.length === 0) {
          throw new Error(`No frames found for session "${sessionId}"`);
        }

        console.log(
          `${chalk.bold.white("Cognitive Snapshot")} ${chalk.dim(sessionId)}`,
        );

        for (const frame of frames) {
          console.log(formatFrameLine(frame));
        }
      } finally {
        db.close();
      }
    });

  await program.parseAsync(argv);
}

function formatFrameLine(frame: Frame): string {
  const sequence = chalk.bold.white(`#${String(frame.sequence).padStart(3, "0")}`);
  const frameType = colorizeFrameType(frame.frameType);
  const role = frame.role ? chalk.magenta(frame.role) : chalk.dim("n/a");
  const tool = frame.toolName ? chalk.yellow(frame.toolName) : chalk.dim("-");
  const createdAt = chalk.dim(frame.createdAt);
  const summary = chalk.white(summarizeFrameContent(frame));

  return `${sequence} ${frameType} ${role} ${tool} ${createdAt}\n  ${summary}`;
}

function colorizeFrameType(frameType: Frame["frameType"]): string {
  switch (frameType) {
    case "llm_turn":
      return chalk.blue("llm_turn");
    case "tool_call":
      return chalk.yellow("tool_call");
    case "tool_result":
      return chalk.green("tool_result");
    case "system_event":
      return chalk.gray("system_event");
    default:
      return chalk.white(frameType);
  }
}

function summarizeFrameContent(frame: Frame): string {
  if (frame.frameType === "llm_turn") {
    return truncateString(extractStringField(frame.content, "content"));
  }

  if (frame.frameType === "tool_call") {
    return `args=${truncateString(JSON.stringify(extractValueField(frame.content, "args")))}`;
  }

  if (frame.frameType === "tool_result") {
    return `result=${truncateString(JSON.stringify(extractValueField(frame.content, "result")))}`;
  }

  return truncateString(JSON.stringify(frame.content));
}

function extractStringField(value: JsonValue, fieldName: string): string {
  const fieldValue = extractValueField(value, fieldName);

  if (typeof fieldValue !== "string") {
    return JSON.stringify(fieldValue);
  }

  return fieldValue;
}

function extractValueField(value: JsonValue, fieldName: string): JsonValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }

  return value[fieldName] ?? null;
}

function truncateString(value: string, maxLength = 140): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

if (require.main === module) {
  void runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.bold.red("Error:"), chalk.red(message));
    process.exitCode = 1;
  });
}
