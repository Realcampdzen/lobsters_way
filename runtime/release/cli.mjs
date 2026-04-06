#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import {
  appendLog,
  buildJsonResult,
  buildRelease,
  createTempHome,
  ensureRequiredEnv,
  ensureRequiredPaths,
  ensureRuntimeLayout,
  formatRunSummary,
  getOpenClawHome,
  listReleases,
  loadManifest,
  loadReleaseMetadata,
  loadState,
  normalizeRepoUrl,
  parseCliArgs,
  resolveCurrentRelease,
  resolveRollbackTarget,
  restartGateway,
  runValidationCommands,
  saveState,
  sendNotification,
  stageGitSource,
  switchCurrentRelease,
  useLocalSource,
  waitForGatewayHealth
} from "./lib.mjs";

function ensureArg(args, key, fallback = "") {
  return String(args[key] ?? fallback).trim();
}

async function resolveSource(args, manifest) {
  const localSource = ensureArg(args, "source");
  if (localSource) {
    return await useLocalSource(path.resolve(localSource));
  }

  const openclawHome = getOpenClawHome();
  const repoUrl = ensureArg(args, "repo-url", manifest.repoUrl);
  const ref = ensureArg(args, "ref", manifest.defaultRef);
  if (!repoUrl) {
    throw new Error("Missing --repo-url.");
  }
  if (normalizeRepoUrl(repoUrl) !== normalizeRepoUrl(manifest.repoUrl)) {
    throw new Error(`Only the canonical repo is allowed: ${manifest.repoUrl}`);
  }
  return await stageGitSource(openclawHome, repoUrl, ref);
}

async function cmdValidateLocal(args) {
  const sourceDir = path.resolve(ensureArg(args, "source", process.cwd()));
  const manifest = await loadManifest(sourceDir);
  await ensureRequiredPaths(sourceDir, manifest);
  return buildJsonResult(true, "Local manifest and required paths are valid.", {
    sourceDir
  });
}

async function cmdStatus() {
  const openclawHome = getOpenClawHome();
  const state = await loadState(openclawHome);
  const current = await resolveCurrentRelease(openclawHome);
  const releases = await listReleases(openclawHome);
  const currentCommit = current?.metadata?.commitSha ?? null;
  return buildJsonResult(true, "Release status ready.", {
    ...state,
    currentRelease: current?.releaseId ?? state.currentRelease,
    currentCommit,
    releases
  });
}

async function cmdRun(args) {
  const workspaceRoot = path.resolve(ensureArg(args, "workspace", process.cwd()));
  const sourceForManifest = ensureArg(args, "source", workspaceRoot);
  const currentManifest = await loadManifest(path.resolve(sourceForManifest));
  const mode = ensureArg(args, "mode", "dry-run");
  const ref = ensureArg(args, "ref", currentManifest.defaultRef);
  const repoUrl = ensureArg(args, "repo-url", currentManifest.repoUrl);
  const openclawHome = getOpenClawHome();
  const notify = {
    channel: ensureArg(args, "notify-channel"),
    target: ensureArg(args, "notify-target"),
    accountId: ensureArg(args, "notify-account"),
    threadId: ensureArg(args, "notify-thread")
  };

  if (mode !== "dry-run" && mode !== "apply") {
    throw new Error("Mode must be dry-run or apply.");
  }

  await ensureRuntimeLayout(openclawHome);
  await saveState(openclawHome, {
    status: "starting",
    targetRef: ref,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null
  });

  const currentBefore = await resolveCurrentRelease(openclawHome);
  let stagedManifest = currentManifest;

  try {
    const { sourceDir, commit } = await resolveSource(args, currentManifest);
    const normalizedSource = path.resolve(sourceDir);
    stagedManifest = await loadManifest(normalizedSource);

    await ensureRequiredPaths(normalizedSource, stagedManifest);
    await ensureRequiredEnv(normalizedSource, openclawHome, stagedManifest);
    await runValidationCommands(normalizedSource, stagedManifest);

    const { releaseId, releaseDir } = await buildRelease({
      sourceDir: normalizedSource,
      openclawHome,
      manifest: stagedManifest,
      commitSha: commit,
      ref,
      repoUrl
    });

    if (mode === "dry-run") {
      await saveState(openclawHome, {
        status: "dry-run-ok",
        stagedRelease: releaseId,
        currentRelease: currentBefore?.releaseId ?? null,
        previousRelease: currentBefore?.releaseId ?? null,
        finishedAt: new Date().toISOString(),
        error: null
      });
      return buildJsonResult(true, formatRunSummary({
        mode,
        releaseId,
        ref,
        commitSha: commit,
        releaseDir
      }), {
        releaseId,
        releaseDir,
        ref,
        commitSha: commit
      });
    }

    await saveState(openclawHome, {
      status: "cutover",
      stagedRelease: releaseId,
      previousRelease: currentBefore?.releaseId ?? null
    });

    await switchCurrentRelease(openclawHome, releaseId);
    await saveState(openclawHome, {
      status: "restarting",
      currentRelease: releaseId
    });
    await restartGateway(stagedManifest);
    await waitForGatewayHealth();
    const state = await saveState(openclawHome, {
      status: "healthy",
      currentRelease: releaseId,
      previousRelease: currentBefore?.releaseId ?? null,
      stagedRelease: releaseId,
      finishedAt: new Date().toISOString(),
      error: null
    });
    const message = formatRunSummary({
      mode,
      releaseId,
      ref,
      commitSha: commit,
      releaseDir
    });
    await appendLog(openclawHome, "release.ndjson", JSON.stringify({
      ts: new Date().toISOString(),
      action: "apply",
      releaseId,
      ref,
      commitSha: commit,
      status: state.status
    }));
    await sendNotification({
      ...notify,
      message
    });
    return buildJsonResult(true, message, {
      releaseId,
      releaseDir,
      ref,
      commitSha: commit
    });
  } catch (error) {
    const currentState = await loadState(openclawHome);
    const rollbackTarget = currentBefore?.releaseId ?? currentState.previousRelease ?? null;
    let rollbackMessage = "";
    if (mode === "apply" && rollbackTarget) {
      try {
        await switchCurrentRelease(openclawHome, rollbackTarget);
        await restartGateway(stagedManifest);
        await waitForGatewayHealth();
        rollbackMessage = ` Rolled back to ${rollbackTarget}.`;
        await saveState(openclawHome, {
          status: "rolled-back",
          currentRelease: rollbackTarget,
          finishedAt: new Date().toISOString(),
          error: String(error.message ?? error)
        });
      } catch (rollbackError) {
        rollbackMessage = ` Rollback failed: ${String(rollbackError.message ?? rollbackError)}`;
      }
    } else {
      await saveState(openclawHome, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: String(error.message ?? error)
      });
    }
    const message = `Release ${mode} failed: ${String(error.message ?? error)}${rollbackMessage}`;
    await appendLog(openclawHome, "release.ndjson", JSON.stringify({
      ts: new Date().toISOString(),
      action: mode,
      status: "failed",
      error: String(error.message ?? error),
      rollbackMessage
    }));
    await sendNotification({
      ...notify,
      message
    });
    return buildJsonResult(false, message);
  }
}

async function cmdRollback(args) {
  const workspaceRoot = path.resolve(ensureArg(args, "workspace", process.cwd()));
  const manifest = await loadManifest(workspaceRoot);
  const openclawHome = getOpenClawHome();
  const targetArg = ensureArg(args, "target", "previous");
  const notify = {
    channel: ensureArg(args, "notify-channel"),
    target: ensureArg(args, "notify-target"),
    accountId: ensureArg(args, "notify-account"),
    threadId: ensureArg(args, "notify-thread")
  };

  const target = await resolveRollbackTarget(openclawHome, targetArg);
  await switchCurrentRelease(openclawHome, target);
  await restartGateway(manifest);
  await waitForGatewayHealth();
  const metadata = await loadReleaseMetadata(openclawHome, target);
  await saveState(openclawHome, {
    status: "healthy",
    currentRelease: target,
    finishedAt: new Date().toISOString(),
    error: null
  });
  const message = `Rollback complete: ${target}\ncommit: ${metadata?.commitSha ?? "(unknown)"}`;
  await appendLog(openclawHome, "release.ndjson", JSON.stringify({
    ts: new Date().toISOString(),
    action: "rollback",
    target
  }));
  await sendNotification({
    ...notify,
    message
  });
  return buildJsonResult(true, message, {
    target,
    commitSha: metadata?.commitSha ?? null
  });
}

async function cmdBootstrap(args) {
  const sourceDir = path.resolve(ensureArg(args, "source", process.cwd()));
  const openclawHome = ensureArg(args, "openclaw-home");
  if (openclawHome) {
    process.env.OPENCLAW_HOME = openclawHome;
  }
  const manifest = await loadManifest(sourceDir);
  const result = await cmdRun({
    ...args,
    source: sourceDir,
    mode: ensureArg(args, "mode", "dry-run"),
    "repo-url": manifest.repoUrl,
    ref: ensureArg(args, "ref", manifest.defaultRef),
    workspace: sourceDir
  });
  return buildJsonResult(result.ok, `${result.message}\n\nOPENCLAW_HOME: ${getOpenClawHome()}`, result.data);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const command = args._[0] ?? "status";

  let result;
  switch (command) {
    case "validate-local":
      result = await cmdValidateLocal(args);
      break;
    case "status":
      result = await cmdStatus(args);
      break;
    case "run":
      result = await cmdRun(args);
      break;
    case "rollback":
      result = await cmdRollback(args);
      break;
    case "bootstrap":
      result = await cmdBootstrap(args);
      break;
    case "temp-home":
      result = buildJsonResult(true, await createTempHome());
      break;
    default:
      throw new Error(`Unknown release command: ${command}`);
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.log(JSON.stringify(buildJsonResult(false, String(error.message ?? error)), null, 2));
  process.exit(1);
});
