import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const DEFAULT_HEALTH_TIMEOUT_MS = 30_000;

export function buildJsonResult(ok, message, data = undefined) {
  return { ok, message, data };
}

export function normalizeRepoUrl(url) {
  const trimmed = String(url ?? "").trim().replace(/\/+$/, "");
  const withoutGit = trimmed.endsWith(".git") ? trimmed.slice(0, -4) : trimmed;
  return withoutGit.toLowerCase();
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

export async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

export function parseDotEnv(raw) {
  const values = {};
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export async function loadManifest(sourceDir) {
  return await readJson(path.join(sourceDir, "lobster.manifest.json"));
}

export function parseCliArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        args[key] = "true";
      } else {
        args[key] = next;
        index += 1;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

export function getOpenClawHome(env = process.env) {
  const home = String(env.OPENCLAW_HOME ?? "").trim();
  if (!home) {
    throw new Error("OPENCLAW_HOME is required.");
  }
  return home;
}

export function getReleasePaths(openclawHome) {
  return {
    home: openclawHome,
    releases: path.join(openclawHome, "releases"),
    shared: path.join(openclawHome, "shared"),
    staging: path.join(openclawHome, "staging"),
    currentLink: path.join(openclawHome, "current"),
    stateFile: path.join(openclawHome, "shared", "runtime", "state", "update-state.json"),
    logsDir: path.join(openclawHome, "shared", "runtime", "logs")
  };
}

export async function ensureRuntimeLayout(openclawHome) {
  const paths = getReleasePaths(openclawHome);
  await Promise.all([
    ensureDir(paths.releases),
    ensureDir(paths.shared),
    ensureDir(paths.staging),
    ensureDir(path.dirname(paths.stateFile)),
    ensureDir(paths.logsDir),
    ensureDir(path.join(paths.shared, "config"))
  ]);
  return paths;
}

export async function copyFile(sourcePath, targetPath) {
  await ensureDir(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath);
}

async function copyDirectory(sourceDir, targetDir) {
  await ensureDir(targetDir);
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
      continue;
    }
    if (entry.isSymbolicLink()) {
      const linkTarget = await fs.readlink(sourcePath);
      await ensureDir(path.dirname(targetPath));
      await fs.symlink(linkTarget, targetPath);
      continue;
    }
    await copyFile(sourcePath, targetPath);
  }
}

export async function copyPath(sourceDir, targetDir, relativePath) {
  const sourcePath = path.join(sourceDir, relativePath);
  const targetPath = path.join(targetDir, relativePath);
  const stat = await fs.lstat(sourcePath);
  if (stat.isDirectory()) {
    await copyDirectory(sourcePath, targetPath);
    return;
  }
  await copyFile(sourcePath, targetPath);
}

export async function safeRemove(targetPath) {
  if (!(await pathExists(targetPath))) {
    return;
  }
  await fs.rm(targetPath, { recursive: true, force: true });
}

function symlinkTypeForPlatform() {
  return process.platform === "win32" ? "junction" : "dir";
}

export async function createPathSymlink(realTargetPath, linkPath) {
  await safeRemove(linkPath);
  await ensureDir(path.dirname(linkPath));
  const stat = await fs.lstat(realTargetPath);
  const type = stat.isDirectory() ? symlinkTypeForPlatform() : "file";
  try {
    await fs.symlink(realTargetPath, linkPath, type);
  } catch (error) {
    const isPermissionIssue =
      process.platform === "win32" &&
      (error.code === "EPERM" || error.code === "UNKNOWN" || error.code === "EACCES");
    if (!isPermissionIssue) {
      throw error;
    }
    if (stat.isDirectory()) {
      await copyDirectory(realTargetPath, linkPath);
      return;
    }
    await copyFile(realTargetPath, linkPath);
  }
}

export async function loadState(openclawHome) {
  const { stateFile } = getReleasePaths(openclawHome);
  if (!(await pathExists(stateFile))) {
    return {
      status: "idle",
      targetRef: null,
      stagedRelease: null,
      currentRelease: null,
      previousRelease: null,
      startedAt: null,
      finishedAt: null,
      error: null
    };
  }
  return await readJson(stateFile);
}

export async function saveState(openclawHome, patch) {
  const next = {
    ...(await loadState(openclawHome)),
    ...patch
  };
  await writeJson(getReleasePaths(openclawHome).stateFile, next);
  return next;
}

export async function appendLog(openclawHome, fileName, lines) {
  const logPath = path.join(getReleasePaths(openclawHome).logsDir, fileName);
  await ensureDir(path.dirname(logPath));
  await fs.appendFile(logPath, `${lines}\n`, "utf8");
}

export async function runCommand(argv, options = {}) {
  const { cwd, env, allowFailure = false, stdin = "", timeoutMs = 120_000 } = options;
  return await new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          if (!settled) {
            settled = true;
            child.kill("SIGTERM");
            reject(new Error(`Command timed out after ${timeoutMs}ms: ${argv.join(" ")}`));
          }
        }, timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (settled) {
        return;
      }
      settled = true;
      const result = { code: code ?? 0, stdout, stderr };
      if (!allowFailure && result.code !== 0) {
        reject(
          new Error(
            `Command failed (${result.code}): ${argv.join(" ")}\n${stderr.trim() || stdout.trim()}`
          )
        );
        return;
      }
      resolve(result);
    });

    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

export async function ensureRequiredPaths(sourceDir, manifest) {
  for (const relativePath of manifest.requiredPaths ?? []) {
    if (!(await pathExists(path.join(sourceDir, relativePath)))) {
      throw new Error(`Missing required path: ${relativePath}`);
    }
  }
}

export async function ensureRequiredEnv(sourceDir, openclawHome, manifest, env = process.env) {
  const sharedEnvPath = path.join(openclawHome, "shared", ".env");
  const envFromFile = parseDotEnv(await readTextIfExists(sharedEnvPath));
  const missing = [];

  for (const key of manifest.requiredEnv ?? []) {
    const processValue = String(env[key] ?? "").trim();
    const fileValue = String(envFromFile[key] ?? "").trim();
    if (!processValue && !fileValue) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required env keys: ${missing.join(", ")}`);
  }
}

export async function syncSeedPath(sourceDir, sharedDir, seed) {
  const sourcePath = path.join(sourceDir, seed.source);
  const targetPath = path.join(sharedDir, seed.target);

  if (seed.sync === "mirror") {
    await safeRemove(targetPath);
    await copyPath(sourceDir, sharedDir, seed.source);
    if (seed.source !== seed.target) {
      await safeRemove(targetPath);
      await fs.rename(path.join(sharedDir, seed.source), targetPath);
    }
    return;
  }

  if (!(await pathExists(targetPath))) {
    await copyPath(sourceDir, sharedDir, seed.source);
    if (seed.source !== seed.target) {
      await safeRemove(targetPath);
      await fs.rename(path.join(sharedDir, seed.source), targetPath);
    }
  }
}

export async function ensureAdminAllowlist(openclawHome) {
  const allowlistPath = path.join(openclawHome, "shared", "config", "admin-allowlist.json");
  if (await pathExists(allowlistPath)) {
    return;
  }
  const ids = String(process.env.OPENCLAW_RELEASE_ADMIN_IDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  await writeJson(allowlistPath, {
    telegram: ids
  });
}

export async function ensureSharedSeeds(sourceDir, openclawHome, manifest) {
  const { shared } = getReleasePaths(openclawHome);
  await ensureDir(shared);
  for (const seed of manifest.sharedSeeds ?? []) {
    await syncSeedPath(sourceDir, shared, seed);
  }
  await ensureAdminAllowlist(openclawHome);
  const statePath = path.join(shared, "runtime", "state", "update-state.json");
  if (!(await pathExists(statePath))) {
    await writeJson(statePath, {
      status: "idle",
      targetRef: null,
      stagedRelease: null,
      currentRelease: null,
      previousRelease: null,
      startedAt: null,
      finishedAt: null,
      error: null
    });
  }
}

export async function materializeWorkspaceFiles(sourceDir, releaseDir, openclawHome, manifest) {
  for (const entry of manifest.workspaceFiles ?? []) {
    const sourcePath = path.join(sourceDir, entry.source);
    const targetPath = path.join(releaseDir, entry.target);
    if (entry.mode === "repo") {
      await copyFile(sourcePath, targetPath);
      continue;
    }
    const sharedPath = path.join(openclawHome, "shared", entry.target);
    if (!(await pathExists(sharedPath))) {
      await copyFile(sourcePath, sharedPath);
    }
    await createPathSymlink(sharedPath, targetPath);
  }
}

export async function materializeSharedOverlays(releaseDir, openclawHome, manifest) {
  for (const relativePath of manifest.sharedOverlayPaths ?? []) {
    const sharedPath = path.join(openclawHome, "shared", relativePath);
    const releasePath = path.join(releaseDir, relativePath);
    if (!(await pathExists(sharedPath))) {
      continue;
    }
    await createPathSymlink(sharedPath, releasePath);
  }
}

export function buildReleaseId(commitSha) {
  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${String(commitSha).slice(0, 7)}`;
}

export async function writeReleaseMetadata(releaseDir, metadata) {
  await writeJson(path.join(releaseDir, "runtime", "release-meta.json"), metadata);
}

export async function stageGitSource(openclawHome, repoUrl, ref) {
  const { staging } = getReleasePaths(openclawHome);
  const workDir = await fs.mkdtemp(path.join(staging, "repo-"));
  await runCommand(["git", "clone", "--filter=blob:none", "--no-checkout", repoUrl, workDir], {
    timeoutMs: 180_000
  });
  await runCommand(["git", "-C", workDir, "fetch", "--depth", "1", "origin", ref], {
    timeoutMs: 180_000
  });
  await runCommand(["git", "-C", workDir, "checkout", "--detach", "FETCH_HEAD"]);
  const commit = (await runCommand(["git", "-C", workDir, "rev-parse", "HEAD"])).stdout.trim();
  return {
    sourceDir: workDir,
    commit
  };
}

export async function useLocalSource(sourceDir) {
  const commit = (await runCommand(["git", "-C", sourceDir, "rev-parse", "HEAD"])).stdout.trim();
  return { sourceDir, commit };
}

export async function buildRelease({ sourceDir, openclawHome, manifest, commitSha, ref, repoUrl }) {
  const paths = await ensureRuntimeLayout(openclawHome);
  await ensureSharedSeeds(sourceDir, openclawHome, manifest);
  const releaseId = buildReleaseId(commitSha);
  const releaseDir = path.join(paths.releases, releaseId);
  const tempDir = `${releaseDir}.tmp`;

  await safeRemove(tempDir);
  await ensureDir(tempDir);

  for (const relativePath of manifest.repoOwnedPaths ?? []) {
    if (relativePath === "lobster.manifest.json") {
      await copyFile(path.join(sourceDir, relativePath), path.join(tempDir, "lobster.manifest.json"));
      continue;
    }
    await copyPath(sourceDir, tempDir, relativePath);
  }

  await materializeWorkspaceFiles(sourceDir, tempDir, openclawHome, manifest);
  await materializeSharedOverlays(tempDir, openclawHome, manifest);
  await writeReleaseMetadata(tempDir, {
    builtAt: new Date().toISOString(),
    repoUrl,
    ref,
    commitSha,
    releaseId
  });

  await safeRemove(releaseDir);
  await fs.rename(tempDir, releaseDir);
  return { releaseId, releaseDir };
}

export async function resolveCurrentRelease(openclawHome) {
  const { currentLink } = getReleasePaths(openclawHome);
  if (!(await pathExists(currentLink))) {
    return null;
  }
  const target = await fs.readlink(currentLink);
  const resolved = path.resolve(path.dirname(currentLink), target);
  const releaseId = path.basename(resolved);
  const metaPath = path.join(resolved, "runtime", "release-meta.json");
  const metadata = (await pathExists(metaPath)) ? await readJson(metaPath) : {};
  return {
    linkPath: currentLink,
    releaseId,
    releaseDir: resolved,
    metadata
  };
}

export async function switchCurrentRelease(openclawHome, releaseId) {
  const paths = getReleasePaths(openclawHome);
  const releaseDir = path.join(paths.releases, releaseId);
  if (!(await pathExists(releaseDir))) {
    throw new Error(`Release not found: ${releaseId}`);
  }
  const nextLink = `${paths.currentLink}.next`;
  const oldLink = `${paths.currentLink}.old`;
  await safeRemove(nextLink);
  await safeRemove(oldLink);
  await fs.symlink(releaseDir, nextLink, symlinkTypeForPlatform());
  if (await pathExists(paths.currentLink)) {
    await fs.rename(paths.currentLink, oldLink);
  }
  await fs.rename(nextLink, paths.currentLink);
  await safeRemove(oldLink);
  return releaseDir;
}

async function tryRunOpenClaw(argv, options = {}) {
  const openclawBin = String(process.env.OPENCLAW_BIN ?? "openclaw").trim() || "openclaw";
  return await runCommand([openclawBin, ...argv], options);
}

export async function restartGateway(manifest) {
  const restartBin = String(process.env.OPENCLAW_RESTART_BIN ?? "openclaw-restart").trim();
  const restartMode = manifest.restartMode === "full" ? "full" : "gateway";

  try {
    if (restartMode === "gateway") {
      await runCommand([restartBin, "--gateway"], { timeoutMs: 120_000 });
    } else {
      await runCommand([restartBin], { timeoutMs: 120_000 });
    }
    return;
  } catch (error) {
    const message = String(error.message ?? error);
    if (error.code !== "ENOENT" && !message.includes("not recognized")) {
      throw error;
    }
  }

  await tryRunOpenClaw(["gateway", "restart"], { timeoutMs: 120_000 });
}

export async function waitForGatewayHealth(timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const probe = await tryRunOpenClaw(["health", "--json"], {
        timeoutMs: 10_000,
        allowFailure: true
      });
      if (probe.code === 0) {
        return true;
      }
      const status = await tryRunOpenClaw(["gateway", "status", "--json"], {
        timeoutMs: 10_000,
        allowFailure: true
      });
      if (status.code === 0) {
        return true;
      }
      lastError = status.stderr || probe.stderr || status.stdout || probe.stdout;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(`Gateway health check failed: ${String(lastError ?? "timeout")}`);
}

export async function sendNotification({ channel, target, message, accountId, threadId }) {
  if (!channel || !target || !message) {
    return;
  }
  const argv = ["message", "send", "--channel", channel, "--target", target, "--message", message];
  if (accountId) {
    argv.push("--account", accountId);
  }
  if (threadId) {
    argv.push("--thread-id", threadId);
  }
  await tryRunOpenClaw(argv, { timeoutMs: 30_000, allowFailure: true });
}

export async function runValidationCommands(sourceDir, manifest) {
  const results = [];
  for (const command of manifest.validationCommands ?? []) {
    const argv = [...command.argv];
    const normalized = argv.map((token) => (token === "." ? sourceDir : token));
    let result;
    try {
      result = await runCommand(normalized, {
        cwd: sourceDir,
        allowFailure: true,
        timeoutMs: 180_000
      });
    } catch (error) {
      const isPython3Missing =
        normalized[0] === "python3" &&
        (error.code === "ENOENT" || String(error.message ?? error).includes("not recognized"));
      if (!isPython3Missing) {
        throw error;
      }
      result = await runCommand(["python", ...normalized.slice(1)], {
        cwd: sourceDir,
        allowFailure: true,
        timeoutMs: 180_000
      });
    }
    const shouldRetryWithPython =
      normalized[0] === "python3" &&
      result.code !== 0 &&
      !result.stdout.includes("usage: analyze_metrics.py");
    if (shouldRetryWithPython) {
      result = await runCommand(["python", ...normalized.slice(1)], {
        cwd: sourceDir,
        allowFailure: true,
        timeoutMs: 180_000
      });
    }
    results.push({
      id: command.id,
      code: result.code,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim()
    });
  }
  const failed = results.filter((item) => item.code !== 0);
  if (failed.length > 0) {
    const summary = failed
      .map((item) => `${item.id}: ${item.stderr || item.stdout || `exit ${item.code}`}`)
      .join("\n");
    throw new Error(`Validation commands failed:\n${summary}`);
  }
  return results;
}

export function formatRunSummary({ mode, releaseId, ref, commitSha, releaseDir }) {
  const lines = [
    `${mode === "apply" ? "Release applied" : "Dry run passed"}: ${releaseId}`,
    `ref: ${ref}`,
    `commit: ${commitSha}`,
    `path: ${releaseDir}`
  ];
  return lines.join("\n");
}

export async function listReleases(openclawHome) {
  const releasesDir = getReleasePaths(openclawHome).releases;
  if (!(await pathExists(releasesDir))) {
    return [];
  }
  const entries = await fs.readdir(releasesDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export async function loadReleaseMetadata(openclawHome, releaseId) {
  const metadataPath = path.join(getReleasePaths(openclawHome).releases, releaseId, "runtime", "release-meta.json");
  return (await pathExists(metadataPath)) ? await readJson(metadataPath) : null;
}

export async function resolveRollbackTarget(openclawHome, target) {
  const state = await loadState(openclawHome);
  if (!target || target === "previous") {
    if (!state.previousRelease) {
      throw new Error("No previous release recorded.");
    }
    return state.previousRelease;
  }
  return target;
}

export async function createTempHome(prefix = "lobster-openclaw-home-") {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}
