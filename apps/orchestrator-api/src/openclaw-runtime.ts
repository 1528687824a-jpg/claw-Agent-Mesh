import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type OpenClawRuntimeCandidate = {
  rootPath: string;
  source: string;
  exists: boolean;
  status: "ready" | "partial" | "missing";
  agentsDir: {
    path: string;
    exists: boolean;
    count: number;
  };
  workspaceDir: {
    path: string;
    exists: boolean;
    count: number;
  };
  configFiles: Array<{
    path: string;
    exists: boolean;
  }>;
  notes: string[];
};

export type OpenClawRuntimeDiscovery = {
  checkedAt: string;
  selected: OpenClawRuntimeCandidate | null;
  candidates: OpenClawRuntimeCandidate[];
  nextActions: string[];
};

async function pathExists(target: string) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function countDirectories(target: string) {
  try {
    const dirents = await fs.readdir(target, { withFileTypes: true });
    return dirents.filter((dirent) => dirent.isDirectory()).length;
  } catch {
    return 0;
  }
}

function uniqueCandidates(candidates: Array<{ rootPath?: string | null; source: string }>) {
  const seen = new Set<string>();
  const result: Array<{ rootPath: string; source: string }> = [];
  for (const candidate of candidates) {
    if (!candidate.rootPath) {
      continue;
    }
    const rootPath = path.resolve(candidate.rootPath);
    const key = rootPath.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ rootPath, source: candidate.source });
  }
  return result;
}

function buildCandidates(rootPath?: string) {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  const userName = process.env.USERNAME || "administrator";
  return uniqueCandidates([
    { rootPath, source: "query" },
    { rootPath: process.env.OPENCLAW_HOME, source: "OPENCLAW_HOME" },
    { rootPath: process.env.OPENCLAW_ROOT, source: "OPENCLAW_ROOT" },
    { rootPath: process.env.OPENCLAW_CONFIG_DIR, source: "OPENCLAW_CONFIG_DIR" },
    { rootPath: path.join(home, ".openclaw"), source: "home" },
    { rootPath: path.join(appData, "openclaw"), source: "APPDATA/openclaw" },
    { rootPath: path.join(appData, "OpenClaw"), source: "APPDATA/OpenClaw" },
    {
      rootPath: path.join(appData, "io.agentopenclaw.desktop", "openclaw-runtime"),
      source: "desktop-runtime"
    },
    { rootPath: path.resolve(".runtime", "openclaw"), source: "workspace-runtime" },
    {
      rootPath: `\\\\wsl.localhost\\Ubuntu\\home\\${userName.toLowerCase()}\\.openclaw`,
      source: "wsl-ubuntu-unc"
    },
    {
      rootPath: `\\\\wsl$\\Ubuntu\\home\\${userName.toLowerCase()}\\.openclaw`,
      source: "wsl-ubuntu-legacy-unc"
    },
    {
      rootPath: "\\\\wsl.localhost\\Ubuntu\\home\\administrator\\.openclaw",
      source: "wsl-ubuntu-administrator-unc"
    },
    {
      rootPath: "\\\\wsl$\\Ubuntu\\home\\administrator\\.openclaw",
      source: "wsl-ubuntu-administrator-legacy-unc"
    }
  ]);
}

export async function inspectOpenClawCandidate(input: {
  rootPath: string;
  source: string;
}): Promise<OpenClawRuntimeCandidate> {
  const rootExists = await pathExists(input.rootPath);
  const agentsPath = path.join(input.rootPath, "agents");
  const workspacePath = path.join(input.rootPath, "workspace");
  const configPaths = [
    "config.json",
    "settings.json",
    "models.json",
    path.join("config", "openclaw.json"),
    path.join("config", "models.json")
  ].map((relativePath) => path.join(input.rootPath, relativePath));

  const [agentsExists, workspaceExists, ...configExists] = await Promise.all([
    pathExists(agentsPath),
    pathExists(workspacePath),
    ...configPaths.map(pathExists)
  ]);
  const [agentCount, workspaceCount] = await Promise.all([
    agentsExists ? countDirectories(agentsPath) : Promise.resolve(0),
    workspaceExists ? countDirectories(workspacePath) : Promise.resolve(0)
  ]);
  const notes: string[] = [];
  if (!rootExists) {
    notes.push("runtime_root_missing");
  }
  if (rootExists && !agentsExists && !workspaceExists) {
    notes.push("no_agents_or_workspace_directory");
  }
  if (rootExists && !configExists.some(Boolean)) {
    notes.push("no_known_config_file_found");
  }

  const status = !rootExists
    ? "missing"
    : agentsExists || workspaceExists || configExists.some(Boolean)
      ? "ready"
      : "partial";

  return {
    rootPath: input.rootPath,
    source: input.source,
    exists: rootExists,
    status,
    agentsDir: {
      path: agentsPath,
      exists: agentsExists,
      count: agentCount
    },
    workspaceDir: {
      path: workspacePath,
      exists: workspaceExists,
      count: workspaceCount
    },
    configFiles: configPaths.map((configPath, index) => ({
      path: configPath,
      exists: configExists[index] ?? false
    })),
    notes
  };
}

export async function discoverOpenClawRuntime(rootPath?: string): Promise<OpenClawRuntimeDiscovery> {
  const candidates = await Promise.all(buildCandidates(rootPath).map(inspectOpenClawCandidate));
  const selected =
    candidates.find((candidate) => candidate.status === "ready") ??
    candidates.find((candidate) => candidate.status === "partial") ??
    null;

  return {
    checkedAt: new Date().toISOString(),
    selected,
    candidates,
    nextActions: selected
      ? [
          "Validate required Honeycomb agents exist in OpenClaw",
          "Sync provider and agent registry records against this runtime",
          "Run an OpenClaw real-agent smoke test"
        ]
      : [
          "Install OpenClaw or set OPENCLAW_HOME",
          "Open Honeycomb settings and choose the OpenClaw runtime path",
          "Run runtime discovery again"
        ]
  };
}
