import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import type { DavmResolvedPaths, FramefoundryHandoffConfig } from "./db";

export interface CopilotHandoffPlan {
  providerId: FramefoundryHandoffConfig["provider"];
  providerLabel: string;
  workspacePath: string;
  sessionId: string;
  source: "fork" | "resume";
  prompt: string;
  branchName: string | null;
  editorCommand: string | null;
  launchCommand: string | null;
  canLaunch: boolean;
  reason: string | null;
  instructions: string[];
}

export interface CopilotHandoffResult extends CopilotHandoffPlan {
  launchRequested: boolean;
  launched: boolean;
  copiedPrompt: boolean;
}

interface HandoffInput {
  sessionId: string;
  source: "fork" | "resume";
  prompt: string;
  branchName?: string | null;
  providerId?: FramefoundryHandoffConfig["provider"];
  editorCommand?: string | null;
}

export function buildCopilotHandoff(
  paths: DavmResolvedPaths,
  input: HandoffInput,
): CopilotHandoffPlan {
  const providerId = input.providerId ?? paths.handoff.provider;

  if (providerId === "manual") {
    return {
      providerId,
      providerLabel: "Manual editor handoff",
      workspacePath: paths.projectPath,
      sessionId: input.sessionId,
      source: input.source,
      prompt: buildCopilotContinuationPrompt(input),
      branchName: input.branchName ?? null,
      editorCommand: null,
      launchCommand: null,
      canLaunch: false,
      reason: "Manual handoff is configured for this project.",
      instructions: [
        "Open your editor on the restored project workspace.",
        "Open GitHub Copilot Chat.",
        "Paste the copied continuation prompt to keep coding from this branch.",
      ],
    };
  }

  const editorCommand = detectEditorCommand(input.editorCommand ?? paths.handoff.editorCommand);

  if (!editorCommand) {
    return {
      providerId,
      providerLabel: "GitHub Copilot in VS Code",
      workspacePath: paths.projectPath,
      sessionId: input.sessionId,
      source: input.source,
      prompt: buildCopilotContinuationPrompt(input),
      branchName: input.branchName ?? null,
      editorCommand: null,
      launchCommand: null,
      canLaunch: false,
      reason: "VS Code could not be found on PATH. Install the `code` CLI or set handoff.editorCommand.",
      instructions: [
        "Open VS Code on the restored project folder.",
        "Open GitHub Copilot Chat.",
        "Paste the copied continuation prompt to keep coding from this branch.",
      ],
    };
  }

  return {
    providerId,
    providerLabel: "GitHub Copilot in VS Code",
    workspacePath: paths.projectPath,
    sessionId: input.sessionId,
    source: input.source,
    prompt: buildCopilotContinuationPrompt(input),
    branchName: input.branchName ?? null,
    editorCommand,
    launchCommand: `${editorCommand} --new-window ${quoteCommandArg(paths.projectPath)}`,
    canLaunch: true,
    reason: null,
    instructions: [
      "FrameFoundry can open VS Code on the restored workspace in a new window.",
      "The continuation prompt is copied to your clipboard.",
      "Open GitHub Copilot Chat in that window and paste the prompt to keep coding.",
    ],
  };
}

export function launchCopilotHandoff(
  paths: DavmResolvedPaths,
  input: HandoffInput & { launch?: boolean },
): CopilotHandoffResult {
  const plan = buildCopilotHandoff(paths, input);
  const launchRequested = input.launch ?? false;
  const copiedPrompt = launchRequested ? copyTextToClipboard(plan.prompt) : false;
  let launched = false;
  let reason = plan.reason;

  if (launchRequested && plan.canLaunch && plan.editorCommand) {
    try {
      const child = spawn(plan.editorCommand, ["--new-window", paths.projectPath], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        shell: platform() === "win32",
      });
      child.unref();
      launched = true;
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    ...plan,
    launchRequested,
    launched,
    copiedPrompt,
    reason,
  };
}

function buildCopilotContinuationPrompt(input: HandoffInput): string {
  const branchContext = input.branchName
    ? `The workspace is already restored on branch "${input.branchName}".`
    : "The workspace is already restored to the selected FrameFoundry path.";
  const sourceContext =
    input.source === "fork"
      ? "Continue coding from the selected FrameFoundry branch point."
      : "Continue coding from the latest saved FrameFoundry path.";

  return `${sourceContext} ${branchContext}\nTreat the current files as the source of truth.\n\nNext task:\n${input.prompt}`;
}

function detectEditorCommand(explicitCommand?: string | null): string | null {
  const candidates = explicitCommand ? [explicitCommand] : ["code", "code-insiders"];

  for (const candidate of candidates) {
    if (commandExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function commandExists(command: string): boolean {
  if ((command.includes("\\") || command.includes("/") || command.includes(":")) && existsSync(command)) {
    return true;
  }

  try {
    if (platform() === "win32") {
      execFileSync("where", [command], {
        stdio: "ignore",
      });
      return true;
    }

    execFileSync("which", [command], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function copyTextToClipboard(value: string): boolean {
  try {
    const targetPlatform = platform();

    if (targetPlatform === "win32") {
      execFileSync("cmd", ["/c", "clip"], {
        input: value,
        encoding: "utf8",
        stdio: ["pipe", "ignore", "ignore"],
      });
      return true;
    }

    if (targetPlatform === "darwin") {
      execFileSync("pbcopy", [], {
        input: value,
        encoding: "utf8",
        stdio: ["pipe", "ignore", "ignore"],
      });
      return true;
    }

    for (const command of ["wl-copy", "xclip", "xsel"]) {
      if (!commandExists(command)) {
        continue;
      }

      const args =
        command === "xclip" ? ["-selection", "clipboard"] : command === "xsel" ? ["--clipboard", "--input"] : [];

      execFileSync(command, args, {
        input: value,
        encoding: "utf8",
        stdio: ["pipe", "ignore", "ignore"],
      });
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

function quoteCommandArg(value: string): string {
  if (platform() === "win32") {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}
