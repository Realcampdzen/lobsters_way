import path from "node:path";
import { spawn } from "node:child_process";
import type { OpenClawPluginApi, PluginCommandContext } from "openclaw/plugin-sdk";

type CliResult = {
  ok: boolean;
  message: string;
  data?: Record<string, unknown>;
};

type AdminAllowlist = {
  telegram?: string[];
};

function getWorkspaceRoot(api: OpenClawPluginApi, ctx: PluginCommandContext): string {
  const agents = (ctx.config as { agents?: { list?: Array<{ workspace?: string }> } }).agents?.list;
  if (Array.isArray(agents) && agents.length === 1) {
    const workspace = agents[0]?.workspace?.trim();
    if (workspace) {
      return workspace;
    }
  }
  return path.resolve(api.resolvePath("."), "..", "..", "..");
}

function getManifestPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, "lobster.manifest.json");
}

function getCliPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, "runtime", "release", "cli.mjs");
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function splitArgs(input: string): string[] {
  return input.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function normalizeRepoUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return trimmed.endsWith(".git") ? trimmed.slice(0, -4).toLowerCase() : trimmed.toLowerCase();
}

function resolveRequestedRefAndMode(tokens: string[]): { repoUrl: string; ref: string; mode: string } {
  const repoUrl = tokens[0] ?? "";
  let ref = "main";
  let mode = "dry-run";

  if (tokens.length >= 2) {
    const second = tokens[1].toLowerCase();
    if (second === "dry-run" || second === "apply") {
      mode = second;
    } else {
      ref = tokens[1];
    }
  }

  if (tokens.length >= 3) {
    mode = tokens[2].toLowerCase();
  }

  return { repoUrl, ref, mode };
}

function formatStatus(result: CliResult): string {
  if (!result.data) {
    return result.message;
  }

  const currentRelease = String(result.data.currentRelease ?? "(none)");
  const previousRelease = String(result.data.previousRelease ?? "(none)");
  const targetRef = String(result.data.targetRef ?? "(none)");
  const status = String(result.data.status ?? "unknown");
  const currentCommit = String(result.data.currentCommit ?? "(unknown)");

  return [
    result.message,
    "",
    `status: ${status}`,
    `current: ${currentRelease}`,
    `previous: ${previousRelease}`,
    `ref: ${targetRef}`,
    `commit: ${currentCommit}`
  ].join("\n");
}

async function loadAdminAllowlist(workspaceRoot: string): Promise<AdminAllowlist> {
  const envHome = process.env.OPENCLAW_HOME?.trim();
  const candidatePaths = [
    envHome ? path.join(envHome, "shared", "config", "admin-allowlist.json") : "",
    path.join(workspaceRoot, "config", "admin-allowlist.json")
  ].filter(Boolean);

  for (const candidate of candidatePaths) {
    const allowlist = await readJsonFile<AdminAllowlist>(candidate);
    if (allowlist) {
      return allowlist;
    }
  }

  const envAdmins = (process.env.OPENCLAW_RELEASE_ADMIN_IDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return envAdmins.length > 0 ? { telegram: envAdmins } : {};
}

async function isTelegramAdmin(workspaceRoot: string, ctx: PluginCommandContext): Promise<boolean> {
  if (!ctx.isAuthorizedSender) {
    return false;
  }
  if (ctx.channel !== "telegram") {
    return false;
  }
  const senderId = ctx.senderId?.trim();
  if (!senderId) {
    return false;
  }
  const allowlist = await loadAdminAllowlist(workspaceRoot);
  const telegramAdmins = allowlist.telegram ?? [];
  return telegramAdmins.includes(senderId);
}

async function runCliSync(workspaceRoot: string, args: string[]): Promise<CliResult> {
  const cliPath = getCliPath(workspaceRoot);
  return await new Promise<CliResult>((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args, "--json"], {
      cwd: workspaceRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({
        ok: false,
        message: `Release CLI failed to start: ${error.message}`
      });
    });
    child.on("close", () => {
      const body = stdout.trim() || stderr.trim();
      if (!body) {
        resolve({
          ok: false,
          message: "Release CLI returned no output."
        });
        return;
      }
      try {
        resolve(JSON.parse(body) as CliResult);
      } catch {
        resolve({
          ok: false,
          message: body
        });
      }
    });
  });
}

function spawnCliDetached(workspaceRoot: string, args: string[]): void {
  const cliPath = getCliPath(workspaceRoot);
  const child = spawn(process.execPath, [cliPath, ...args, "--json"], {
    cwd: workspaceRoot,
    env: process.env,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

export default function register(api: OpenClawPluginApi) {
  api.registerCommand({
    name: "release_status",
    description: "Show Kot Bro release status.",
    handler: async (ctx) => {
      const workspaceRoot = getWorkspaceRoot(api, ctx);
      if (!(await isTelegramAdmin(workspaceRoot, ctx))) {
        return { text: "Release commands are available only to the Telegram admin allowlist." };
      }
      const result = await runCliSync(workspaceRoot, ["status", "--workspace", workspaceRoot]);
      return { text: formatStatus(result) };
    }
  });

  api.registerCommand({
    name: "self_rebuild",
    description: "Stage or apply a repo-driven self rebuild.",
    acceptsArgs: true,
    handler: async (ctx) => {
      const workspaceRoot = getWorkspaceRoot(api, ctx);
      if (!(await isTelegramAdmin(workspaceRoot, ctx))) {
        return { text: "Release commands are available only to the Telegram admin allowlist." };
      }

      const manifest = await readJsonFile<{ repoUrl?: string }>(getManifestPath(workspaceRoot));
      const tokens = splitArgs(ctx.args ?? "");
      if (tokens.length === 0) {
        return {
          text: "Usage: /self_rebuild <github-url> [ref] [dry-run|apply]"
        };
      }

      const { repoUrl, ref, mode } = resolveRequestedRefAndMode(tokens);
      if (!repoUrl) {
        return {
          text: "Usage: /self_rebuild <github-url> [ref] [dry-run|apply]"
        };
      }
      if (mode !== "dry-run" && mode !== "apply") {
        return {
          text: "Mode must be dry-run or apply."
        };
      }

      const expectedRepo = normalizeRepoUrl(manifest?.repoUrl ?? "");
      const requestedRepo = normalizeRepoUrl(repoUrl);
      if (!expectedRepo || requestedRepo !== expectedRepo) {
        return {
          text: `Only the canonical repo is allowed: ${manifest?.repoUrl ?? "(missing in manifest)"}`
        };
      }

      const cliArgs = [
        "run",
        "--workspace",
        workspaceRoot,
        "--repo-url",
        repoUrl,
        "--ref",
        ref,
        "--mode",
        mode
      ];

      if (mode === "dry-run") {
        const result = await runCliSync(workspaceRoot, cliArgs);
        return { text: result.message };
      }

      cliArgs.push(
        "--notify-channel",
        ctx.channel,
        "--notify-target",
        ctx.senderId?.trim() || ctx.from?.trim() || ctx.to?.trim() || ""
      );
      if (ctx.accountId?.trim()) {
        cliArgs.push("--notify-account", ctx.accountId.trim());
      }
      if (ctx.messageThreadId != null) {
        cliArgs.push("--notify-thread", String(ctx.messageThreadId));
      }

      spawnCliDetached(workspaceRoot, cliArgs);
      return {
        text: `Self rebuild started for ${ref}. I will send a follow-up after cutover or rollback.`
      };
    }
  });

  api.registerCommand({
    name: "rollback_release",
    description: "Rollback the active release to the previous or named release.",
    acceptsArgs: true,
    handler: async (ctx) => {
      const workspaceRoot = getWorkspaceRoot(api, ctx);
      if (!(await isTelegramAdmin(workspaceRoot, ctx))) {
        return { text: "Release commands are available only to the Telegram admin allowlist." };
      }

      const target = (ctx.args?.trim() || "previous").trim();
      const cliArgs = [
        "rollback",
        "--workspace",
        workspaceRoot,
        "--target",
        target,
        "--notify-channel",
        ctx.channel,
        "--notify-target",
        ctx.senderId?.trim() || ctx.from?.trim() || ctx.to?.trim() || ""
      ];
      if (ctx.accountId?.trim()) {
        cliArgs.push("--notify-account", ctx.accountId.trim());
      }
      if (ctx.messageThreadId != null) {
        cliArgs.push("--notify-thread", String(ctx.messageThreadId));
      }

      spawnCliDetached(workspaceRoot, cliArgs);
      return {
        text: `Rollback started for ${target}. I will report back after restart and health check.`
      };
    }
  });
}
