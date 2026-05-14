import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { DavmResolvedPaths } from "./db";

const SNAPSHOT_REF_PREFIX = "refs/framefoundry/snapshots";
const BACKUP_REF_PREFIX = "refs/framefoundry/backups";
const SNAPSHOT_AUTHOR_NAME = "FrameFoundry";
const SNAPSHOT_AUTHOR_EMAIL = "framefoundry@local";

export interface GitSnapshotMetadata {
  repoRoot: string;
  snapshotCommit: string;
  snapshotRef: string;
  headCommit: string | null;
  createdNewCommit: boolean;
  recordedAt: string;
}

export interface GitSnapshotCaptureResult {
  available: boolean;
  metadata: GitSnapshotMetadata | null;
  reason: string | null;
}

export interface GitWorkspaceRestoreResult {
  available: boolean;
  applied: boolean;
  repoRoot: string | null;
  snapshotCommit: string | null;
  snapshotRef: string | null;
  restoredBranch: string | null;
  backupRef: string | null;
  snapshotFrameId: number | null;
  reason: string | null;
}

export interface FramefoundryGitRef {
  kind: "snapshot" | "backup";
  refName: string;
  commit: string;
  createdAt: string | null;
  sessionId: string | null;
  frameId: number | null;
}

export interface FramefoundryRefQuery {
  kind?: "snapshot" | "backup" | "all";
  sessionId?: string;
}

export interface FramefoundryRefPruneOptions extends FramefoundryRefQuery {
  keep?: number;
}

export interface FramefoundryRefPruneResult {
  available: boolean;
  repoRoot: string | null;
  deletedRefs: string[];
  keptRefs: string[];
  reason: string | null;
}

export interface ForkRestorePlan {
  available: boolean;
  repoRoot: string | null;
  plannedBranch: string | null;
  backupRefPrefix: string | null;
  snapshotCommit: string | null;
  snapshotRef: string | null;
  snapshotFrameId: number | null;
  reason: string | null;
}

interface GitContext {
  repoRoot: string;
  excludedPaths: string[];
}

interface CreateSnapshotOptions {
  refName: string;
  message: string;
}

interface SnapshotCommitResult {
  snapshotCommit: string;
  headCommit: string | null;
  createdNewCommit: boolean;
}

export function captureGitSnapshot(
  paths: DavmResolvedPaths,
  sessionId: string,
  frameId: number,
  label: string,
): GitSnapshotCaptureResult {
  const context = resolveGitContext(paths);

  if (!context) {
    return {
      available: false,
      metadata: null,
      reason: "Project path is not inside a Git repository.",
    };
  }

  const snapshotRef = `${SNAPSHOT_REF_PREFIX}/${sanitizeRefSegment(sessionId)}/frame-${frameId}`;
  const snapshot = createSnapshotCommit(context, {
    refName: snapshotRef,
    message: `framefoundry snapshot ${label} (${sessionId} frame ${frameId})`,
  });
  applyRetentionPolicy(paths, "snapshot", sessionId, paths.retentionPolicy.snapshotsPerSession);

  return {
    available: true,
    metadata: {
      repoRoot: context.repoRoot,
      snapshotCommit: snapshot.snapshotCommit,
      snapshotRef,
      headCommit: snapshot.headCommit,
      createdNewCommit: snapshot.createdNewCommit,
      recordedAt: new Date().toISOString(),
    },
    reason: null,
  };
}

export function createManualGitSnapshot(
  paths: DavmResolvedPaths,
  sessionId: string,
  frameId: number,
  label = "manual checkpoint",
): GitSnapshotCaptureResult {
  return captureGitSnapshot(paths, sessionId, frameId, label);
}

export function planForkRestore(
  paths: DavmResolvedPaths,
  sessionId: string,
  startFrameId: number,
  snapshot: { frameId: number; metadata: GitSnapshotMetadata } | null,
): ForkRestorePlan {
  const context = resolveGitContext(paths);

  if (!context) {
    return {
      available: false,
      repoRoot: null,
      plannedBranch: null,
      backupRefPrefix: null,
      snapshotCommit: snapshot?.metadata.snapshotCommit ?? null,
      snapshotRef: snapshot?.metadata.snapshotRef ?? null,
      snapshotFrameId: snapshot?.frameId ?? null,
      reason: "Project path is not inside a Git repository.",
    };
  }

  if (!snapshot) {
    return {
      available: true,
      repoRoot: context.repoRoot,
      plannedBranch: getNextAvailableForkBranchName(context.repoRoot, sessionId, startFrameId),
      backupRefPrefix: `${BACKUP_REF_PREFIX}/${sanitizeRefSegment(sessionId)}/`,
      snapshotCommit: null,
      snapshotRef: null,
      snapshotFrameId: null,
      reason: `No Git snapshot was recorded at or before frame ${startFrameId}.`,
    };
  }

  if (tryRunGit(["cat-file", "-e", `${snapshot.metadata.snapshotCommit}^{commit}`], context.repoRoot) === null) {
    return {
      available: true,
      repoRoot: context.repoRoot,
      plannedBranch: getNextAvailableForkBranchName(context.repoRoot, sessionId, startFrameId),
      backupRefPrefix: `${BACKUP_REF_PREFIX}/${sanitizeRefSegment(sessionId)}/`,
      snapshotCommit: snapshot.metadata.snapshotCommit,
      snapshotRef: snapshot.metadata.snapshotRef,
      snapshotFrameId: snapshot.frameId,
      reason: `Recorded Git snapshot ${snapshot.metadata.snapshotCommit} is not available in this repository.`,
    };
  }

  return {
    available: true,
    repoRoot: context.repoRoot,
    plannedBranch: getNextAvailableForkBranchName(context.repoRoot, sessionId, startFrameId),
    backupRefPrefix: `${BACKUP_REF_PREFIX}/${sanitizeRefSegment(sessionId)}/`,
    snapshotCommit: snapshot.metadata.snapshotCommit,
    snapshotRef: snapshot.metadata.snapshotRef,
    snapshotFrameId: snapshot.frameId,
    reason: null,
  };
}

export function restoreGitSnapshotForFork(
  paths: DavmResolvedPaths,
  sessionId: string,
  startFrameId: number,
  snapshot: { frameId: number; metadata: GitSnapshotMetadata } | null,
): GitWorkspaceRestoreResult {
  const plan = planForkRestore(paths, sessionId, startFrameId, snapshot);

  if (!plan.available || !plan.repoRoot) {
    return {
      available: plan.available,
      applied: false,
      repoRoot: plan.repoRoot,
      snapshotCommit: plan.snapshotCommit,
      snapshotRef: plan.snapshotRef,
      restoredBranch: null,
      backupRef: null,
      snapshotFrameId: plan.snapshotFrameId,
      reason: plan.reason,
    };
  }

  if (plan.reason || !snapshot || !plan.plannedBranch) {
    return {
      available: plan.available,
      applied: false,
      repoRoot: plan.repoRoot,
      snapshotCommit: plan.snapshotCommit,
      snapshotRef: plan.snapshotRef,
      restoredBranch: null,
      backupRef: null,
      snapshotFrameId: plan.snapshotFrameId,
      reason: plan.reason,
    };
  }

  const context = resolveGitContext(paths);

  if (!context) {
    return {
      available: false,
      applied: false,
      repoRoot: null,
      snapshotCommit: plan.snapshotCommit,
      snapshotRef: plan.snapshotRef,
      restoredBranch: null,
      backupRef: null,
      snapshotFrameId: plan.snapshotFrameId,
      reason: "Project path is not inside a Git repository.",
    };
  }

  const currentHeadCommit = tryRunGit(["rev-parse", "--verify", "HEAD"], context.repoRoot);
  const backupRef = createBackupRef(sessionId);
  const backupSnapshot = createSnapshotCommit(context, {
    refName: backupRef,
    message: `framefoundry workspace backup before fork (${sessionId} frame ${startFrameId})`,
  });
  applyRetentionPolicy(paths, "backup", sessionId, paths.retentionPolicy.backupsPerSession);

  verifyCommitExists(context.repoRoot, backupSnapshot.snapshotCommit, `workspace backup at ${backupRef}`);

  const cleanArgs = createCleanArgs(context);

  try {
    if (currentHeadCommit) {
      runGit(["reset", "--hard", currentHeadCommit], context.repoRoot);
    }

    runGit(cleanArgs, context.repoRoot);
    runGit(["checkout", "-B", plan.plannedBranch, snapshot.metadata.snapshotCommit], context.repoRoot);
    runGit(cleanArgs, context.repoRoot);

    return {
      available: true,
      applied: true,
      repoRoot: context.repoRoot,
      snapshotCommit: snapshot.metadata.snapshotCommit,
      snapshotRef: snapshot.metadata.snapshotRef,
      restoredBranch: plan.plannedBranch,
      backupRef,
      snapshotFrameId: snapshot.frameId,
      reason: null,
    };
  } catch (error) {
    try {
      runGit(["checkout", "--detach", backupRef], context.repoRoot);
      runGit(cleanArgs, context.repoRoot);
    } catch {
      // Preserve the original restore failure and surface the backup ref for manual recovery.
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to restore Git snapshot. Workspace backup was saved to ${backupRef}. ${message}`);
  }
}

export function listFramefoundryRefs(
  paths: DavmResolvedPaths,
  query: FramefoundryRefQuery = {},
): { available: boolean; repoRoot: string | null; refs: FramefoundryGitRef[]; reason: string | null } {
  const context = resolveGitContext(paths);

  if (!context) {
    return {
      available: false,
      repoRoot: null,
      refs: [],
      reason: "Project path is not inside a Git repository.",
    };
  }

  const allRefs = collectFramefoundryRefs(context.repoRoot);
  const filteredRefs = allRefs.filter((ref) => matchesRefQuery(ref, query));

  return {
    available: true,
    repoRoot: context.repoRoot,
    refs: filteredRefs,
    reason: null,
  };
}

export function pruneFramefoundryRefs(
  paths: DavmResolvedPaths,
  options: FramefoundryRefPruneOptions = {},
): FramefoundryRefPruneResult {
  const listed = listFramefoundryRefs(paths, options);

  if (!listed.available || !listed.repoRoot) {
    return {
      available: listed.available,
      repoRoot: listed.repoRoot,
      deletedRefs: [],
      keptRefs: [],
      reason: listed.reason,
    };
  }

  const keep = Math.max(0, options.keep ?? 0);
  const refsToKeep = listed.refs.slice(0, keep);
  const refsToDelete = listed.refs.slice(keep);

  for (const ref of refsToDelete) {
    runGit(["update-ref", "-d", ref.refName], listed.repoRoot);
  }

  return {
    available: true,
    repoRoot: listed.repoRoot,
    deletedRefs: refsToDelete.map((ref) => ref.refName),
    keptRefs: refsToKeep.map((ref) => ref.refName),
    reason: null,
  };
}

export function getNextAvailableForkBranchName(repoRoot: string, sessionId: string, startFrameId: number): string {
  const baseName = createForkBranchBaseName(sessionId, startFrameId);

  if (!refExists(repoRoot, `refs/heads/${baseName}`)) {
    return baseName;
  }

  let suffix = 2;

  while (refExists(repoRoot, `refs/heads/${baseName}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseName}-${suffix}`;
}

function resolveGitContext(paths: DavmResolvedPaths): GitContext | null {
  try {
    const repoRoot = resolve(runGit(["rev-parse", "--show-toplevel"], paths.projectPath));
    return {
      repoRoot,
      excludedPaths: collectExcludedPaths(paths, repoRoot),
    };
  } catch {
    return null;
  }
}

function collectExcludedPaths(paths: DavmResolvedPaths, repoRoot: string): string[] {
  const candidates = [paths.dbPath].map((filePath) => normalizeGitPath(relative(repoRoot, filePath)));

  return candidates.filter((candidate) => candidate && candidate !== "." && !candidate.startsWith("../"));
}

function createSnapshotCommit(context: GitContext, options: CreateSnapshotOptions): SnapshotCommitResult {
  const tempDirectory = mkdtempSync(join(tmpdir(), "framefoundry-git-"));
  const tempIndexPath = join(tempDirectory, "index");
  const env = {
    ...process.env,
    GIT_INDEX_FILE: tempIndexPath,
    GIT_AUTHOR_NAME: SNAPSHOT_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: SNAPSHOT_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: SNAPSHOT_AUTHOR_NAME,
    GIT_COMMITTER_EMAIL: SNAPSHOT_AUTHOR_EMAIL,
  };

  try {
    const headCommit = tryRunGit(["rev-parse", "--verify", "HEAD"], context.repoRoot);

    if (headCommit) {
      runGit(["read-tree", headCommit], context.repoRoot, env);
    }

    const addArgs = ["add", "--all", "--", "."];

    for (const excludedPath of context.excludedPaths) {
      addArgs.push(`:(exclude)${excludedPath}`);
    }

    runGit(addArgs, context.repoRoot, env);

    const treeId = runGit(["write-tree"], context.repoRoot, env);
    const headTreeId = headCommit
      ? tryRunGit(["rev-parse", `${headCommit}^{tree}`], context.repoRoot)
      : null;

    let snapshotCommit = headCommit;
    let createdNewCommit = false;

    if (!snapshotCommit || headTreeId !== treeId) {
      const commitArgs = ["commit-tree", treeId];

      if (headCommit) {
        commitArgs.push("-p", headCommit);
      }

      commitArgs.push("-m", options.message);
      snapshotCommit = runGit(commitArgs, context.repoRoot, env);
      createdNewCommit = true;
    }

    if (!snapshotCommit) {
      throw new Error("Could not determine a Git commit for the workspace snapshot.");
    }

    runGit(["update-ref", options.refName, snapshotCommit], context.repoRoot);

    return {
      snapshotCommit,
      headCommit: headCommit ?? null,
      createdNewCommit,
    };
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

function collectFramefoundryRefs(repoRoot: string): FramefoundryGitRef[] {
  const output = runGit(
    [
      "for-each-ref",
      "--sort=-creatordate",
      "--format=%(refname)%09%(objectname)%09%(creatordate:iso8601-strict)",
      SNAPSHOT_REF_PREFIX,
      BACKUP_REF_PREFIX,
    ],
    repoRoot,
  );

  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => parseFramefoundryRef(line))
    .filter((ref): ref is FramefoundryGitRef => ref !== null);
}

function parseFramefoundryRef(line: string): FramefoundryGitRef | null {
  const [refName, commit, createdAt] = line.split("\t");

  if (!refName || !commit) {
    return null;
  }

  if (refName.startsWith(SNAPSHOT_REF_PREFIX)) {
    const suffix = refName.slice(`${SNAPSHOT_REF_PREFIX}/`.length);
    const [sessionId, frameSegment] = suffix.split("/");
    const frameIdMatch = frameSegment?.match(/^frame-(\d+)$/);

    return {
      kind: "snapshot",
      refName,
      commit,
      createdAt: createdAt || null,
      sessionId: sessionId ? unsanitizeRefSegment(sessionId) : null,
      frameId: frameIdMatch ? Number(frameIdMatch[1]) : null,
    };
  }

  if (refName.startsWith(BACKUP_REF_PREFIX)) {
    const suffix = refName.slice(`${BACKUP_REF_PREFIX}/`.length);
    const [sessionId] = suffix.split("/");

    return {
      kind: "backup",
      refName,
      commit,
      createdAt: createdAt || null,
      sessionId: sessionId ? unsanitizeRefSegment(sessionId) : null,
      frameId: null,
    };
  }

  return null;
}

function matchesRefQuery(ref: FramefoundryGitRef, query: FramefoundryRefQuery): boolean {
  const normalizedKind = query.kind ?? "all";

  if (normalizedKind !== "all" && ref.kind !== normalizedKind) {
    return false;
  }

  if (query.sessionId && ref.sessionId !== query.sessionId) {
    return false;
  }

  return true;
}

function createCleanArgs(context: GitContext): string[] {
  const cleanArgs = ["clean", "-fd"];

  for (const excludedPath of context.excludedPaths) {
    cleanArgs.push("-e", excludedPath);
  }

  return cleanArgs;
}

function verifyCommitExists(repoRoot: string, commit: string, label: string): void {
  if (tryRunGit(["cat-file", "-e", `${commit}^{commit}`], repoRoot) === null) {
    throw new Error(`Failed to create a valid ${label}.`);
  }
}

function createForkBranchBaseName(sessionId: string, startFrameId: number): string {
  const shortSessionId = sanitizeRefSegment(sessionId).slice(0, 12) || "session";
  return `framefoundry/fork-${shortSessionId}-frame-${startFrameId}`;
}

function createBackupRef(sessionId: string): string {
  return `${BACKUP_REF_PREFIX}/${sanitizeRefSegment(sessionId)}/${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function refExists(repoRoot: string, refName: string): boolean {
  return tryRunGit(["show-ref", "--verify", "--quiet", refName], repoRoot) !== null;
}

function sanitizeRefSegment(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || "snapshot";
}

function unsanitizeRefSegment(value: string): string {
  return value;
}

function normalizeGitPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function applyRetentionPolicy(
  paths: DavmResolvedPaths,
  kind: "snapshot" | "backup",
  sessionId: string,
  keep: number,
): void {
  pruneFramefoundryRefs(paths, {
    kind,
    sessionId,
    keep,
  });
}

function runGit(args: string[], cwd: string, env?: NodeJS.ProcessEnv): string {
  return execFileSync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryRunGit(args: string[], cwd: string, env?: NodeJS.ProcessEnv): string | null {
  try {
    return runGit(args, cwd, env);
  } catch {
    return null;
  }
}
