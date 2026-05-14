const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const {
  captureGitSnapshot,
  createManualGitSnapshot,
  listFramefoundryRefs,
  planForkRestore,
  pruneFramefoundryRefs,
  restoreGitSnapshotForFork,
} = require("../dist/git.js");

const { buildCopilotHandoff } = require("../dist/handoff.js");
const { resolveDavmPaths: resolveRuntimePaths } = require("../dist/db.js");

function createTempRepo() {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "framefoundry-test-"));
  cp.execFileSync("git", ["init"], { cwd: repoDir, stdio: "pipe" });

  return repoDir;
}

function createPaths(repoDir) {
  return {
    projectPath: repoDir,
    dbPath: path.join(repoDir, "davm.sqlite"),
    schemaPath: path.join(repoDir, "schema.sql"),
    configPath: null,
    snapshotMode: "prompt",
    retentionPolicy: {
      snapshotsPerSession: 25,
      backupsPerSession: 10,
    },
  };
}

test("capture and restore Git snapshots across a fork branch", () => {
  const repoDir = createTempRepo();

  try {
    fs.writeFileSync(path.join(repoDir, "note.txt"), "one\n");
    const paths = createPaths(repoDir);
    const firstSnapshot = captureGitSnapshot(paths, "session-a", 1, "first");

    assert.equal(firstSnapshot.available, true);
    assert.ok(firstSnapshot.metadata);

    fs.writeFileSync(path.join(repoDir, "note.txt"), "two\n");
    const secondSnapshot = createManualGitSnapshot(paths, "session-a", 2, "second");

    assert.equal(secondSnapshot.available, true);
    assert.ok(secondSnapshot.metadata);

    const plan = planForkRestore(paths, "session-a", 1, {
      frameId: 1,
      metadata: firstSnapshot.metadata,
    });

    assert.equal(plan.reason, null);
    assert.ok(plan.plannedBranch);
    assert.equal(plan.snapshotFrameId, 1);

    const restoreResult = restoreGitSnapshotForFork(paths, "session-a", 1, {
      frameId: 1,
      metadata: firstSnapshot.metadata,
    });

    assert.equal(restoreResult.applied, true);
    assert.equal(fs.readFileSync(path.join(repoDir, "note.txt"), "utf8").trim(), "one");
    assert.equal(
      cp.execFileSync("git", ["branch", "--show-current"], { cwd: repoDir, encoding: "utf8" }).trim(),
      restoreResult.restoredBranch,
    );
    assert.ok(restoreResult.backupRef);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test("project config drives snapshot mode and automatic retention", () => {
  const repoDir = createTempRepo();

  try {
    fs.writeFileSync(
      path.join(repoDir, "framefoundry.config.json"),
      JSON.stringify(
        {
          snapshotMode: "assistant",
          retention: {
            snapshotsPerSession: 1,
            backupsPerSession: 1,
          },
        },
        null,
        2,
      ),
    );

    fs.writeFileSync(path.join(repoDir, "note.txt"), "one\n");
    const paths = resolveRuntimePaths({ projectPath: repoDir });

    assert.equal(paths.snapshotMode, "assistant");
    assert.equal(paths.retentionPolicy.snapshotsPerSession, 1);
    assert.equal(paths.retentionPolicy.backupsPerSession, 1);

    const firstSnapshot = captureGitSnapshot(paths, "session-a", 1, "first");
    assert.ok(firstSnapshot.metadata);

    fs.writeFileSync(path.join(repoDir, "note.txt"), "two\n");
    const secondSnapshot = createManualGitSnapshot(paths, "session-a", 2, "second");
    assert.ok(secondSnapshot.metadata);

    const snapshotRefs = listFramefoundryRefs(paths, { kind: "snapshot", sessionId: "session-a" });
    assert.equal(snapshotRefs.refs.length, 1);

    restoreGitSnapshotForFork(paths, "session-a", 2, {
      frameId: 2,
      metadata: secondSnapshot.metadata,
    });

    fs.writeFileSync(path.join(repoDir, "note.txt"), "three\n");
    const thirdSnapshot = createManualGitSnapshot(paths, "session-a", 3, "third");
    assert.ok(thirdSnapshot.metadata);

    restoreGitSnapshotForFork(paths, "session-a", 3, {
      frameId: 3,
      metadata: thirdSnapshot.metadata,
    });

    const backupRefs = listFramefoundryRefs(paths, { kind: "backup", sessionId: "session-a" });
    assert.equal(backupRefs.refs.length, 1);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test("project config can force manual handoff mode", () => {
  const repoDir = createTempRepo();

  try {
    fs.writeFileSync(
      path.join(repoDir, "framefoundry.config.json"),
      JSON.stringify(
        {
          handoff: {
            provider: "manual",
          },
        },
        null,
        2,
      ),
    );

    const paths = resolveRuntimePaths({ projectPath: repoDir });
    const handoff = buildCopilotHandoff(paths, {
      sessionId: "session-a",
      source: "fork",
      prompt: "Keep building from this branch.",
      branchName: "framefoundry/fork-session-a-frame-2",
    });

    assert.equal(paths.handoff.provider, "manual");
    assert.equal(handoff.providerId, "manual");
    assert.equal(handoff.canLaunch, false);
    assert.match(handoff.prompt, /Keep building from this branch/);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test("list and prune internal framefoundry refs", () => {
  const repoDir = createTempRepo();

  try {
    fs.writeFileSync(path.join(repoDir, "a.txt"), "a\n");
    const paths = createPaths(repoDir);

    const snapshotOne = captureGitSnapshot(paths, "session-a", 1, "first");
    assert.ok(snapshotOne.metadata);

    fs.writeFileSync(path.join(repoDir, "a.txt"), "b\n");
    const snapshotTwo = createManualGitSnapshot(paths, "session-a", 2, "second");
    assert.ok(snapshotTwo.metadata);

    let refs = listFramefoundryRefs(paths, { kind: "snapshot", sessionId: "session-a" });
    assert.equal(refs.available, true);
    assert.equal(refs.refs.length, 2);

    const pruneResult = pruneFramefoundryRefs(paths, {
      kind: "snapshot",
      sessionId: "session-a",
      keep: 1,
    });

    assert.equal(pruneResult.deletedRefs.length, 1);
    assert.equal(pruneResult.keptRefs.length, 1);

    refs = listFramefoundryRefs(paths, { kind: "snapshot", sessionId: "session-a" });
    assert.equal(refs.refs.length, 1);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});
