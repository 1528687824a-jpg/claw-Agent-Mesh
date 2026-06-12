import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 5000;
const PROBE_MAX_BUFFER = 1024 * 1024;
const CACHE_TTL_MS = 30_000;
const HONEYCOMB_CONTAINER_FILTER = "agent-openclaw";

export type HostDiagnosticStatus = "ok" | "warning" | "error";

export type WslDistroInfo = {
  name: string;
  state: string;
  version: string;
  isDefault: boolean;
};

export type WslRuntimeDiagnostics = {
  applicable: boolean;
  wslAvailable: boolean;
  configuredDistro: string;
  distroFound: boolean;
  distroState: string | null;
  distros: WslDistroInfo[];
  status: HostDiagnosticStatus;
  summary: string;
  nextActions: string[];
  error: string | null;
};

export type DockerContainerInfo = {
  name: string;
  state: string;
  status: string;
};

export type DockerRuntimeDiagnostics = {
  applicable: boolean;
  dockerCliAvailable: boolean;
  daemonReachable: boolean;
  serverVersion: string | null;
  honeycombContainers: DockerContainerInfo[];
  status: HostDiagnosticStatus;
  summary: string;
  nextActions: string[];
  error: string | null;
};

// wsl.exe prints UTF-16LE by default; docker and most other tools print UTF-8.
export function decodeWindowsCommandOutput(buffer: Buffer): string {
  if (buffer.length >= 2) {
    let zeroBytes = 0;
    const sample = Math.min(buffer.length, 256);
    for (let index = 1; index < sample; index += 2) {
      if (buffer[index] === 0) {
        zeroBytes += 1;
      }
    }
    if (zeroBytes > sample / 4) {
      return buffer.toString("utf16le").replace(/^﻿/, "");
    }
  }
  return buffer.toString("utf8").replace(/^﻿/, "");
}

export function parseWslListOutput(output: string): WslDistroInfo[] {
  const distros: WslDistroInfo[] = [];
  const lines = output.split(/\r?\n/);
  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const isDefault = trimmed.startsWith("*");
    const columns = trimmed.replace(/^\*\s*/, "").split(/\s{2,}/);
    if (columns.length < 2) {
      continue;
    }
    distros.push({
      name: columns[0].trim(),
      state: columns[1]?.trim() ?? "",
      version: columns[2]?.trim() ?? "",
      isDefault
    });
  }
  return distros;
}

export function parseDockerPsJsonLines(output: string): DockerContainerInfo[] {
  const containers: DockerContainerInfo[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const name = typeof parsed.Names === "string" ? parsed.Names : "";
      if (!name) {
        continue;
      }
      containers.push({
        name,
        state: typeof parsed.State === "string" ? parsed.State : "",
        status: typeof parsed.Status === "string" ? parsed.Status : ""
      });
    } catch {
      continue;
    }
  }
  return containers;
}

function configuredWslDistro() {
  return process.env.OPENCLAW_WSL_DISTRO ?? "Ubuntu-24.04";
}

function runningInsideContainer() {
  return process.env.HONEYCOMB_RUNTIME_CONTAINER === "true" || existsSync("/.dockerenv");
}

type ProbeResult = {
  ok: boolean;
  output: string;
  error: string | null;
};

async function probeCommand(file: string, args: string[]): Promise<ProbeResult> {
  try {
    const result = await execFileAsync(file, args, {
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: PROBE_MAX_BUFFER,
      windowsHide: true,
      encoding: "buffer"
    });
    return {
      ok: true,
      output: decodeWindowsCommandOutput(result.stdout),
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      output: "",
      error: error instanceof Error ? error.message.slice(0, 500) : String(error)
    };
  }
}

export async function getWslRuntimeDiagnostics(): Promise<WslRuntimeDiagnostics> {
  const configuredDistro = configuredWslDistro();
  if (process.platform !== "win32" || runningInsideContainer()) {
    return {
      applicable: false,
      wslAvailable: false,
      configuredDistro,
      distroFound: false,
      distroState: null,
      distros: [],
      status: "ok",
      summary: "WSL checks are skipped because this process is not running on the Windows host.",
      nextActions: [],
      error: null
    };
  }

  const probe = await probeCommand("wsl.exe", ["-l", "-v"]);
  if (!probe.ok) {
    return {
      applicable: true,
      wslAvailable: false,
      configuredDistro,
      distroFound: false,
      distroState: null,
      distros: [],
      status: "error",
      summary: "wsl.exe is not available or WSL is not installed.",
      nextActions: ["Install or repair WSL before using the real OpenClaw runtime."],
      error: probe.error
    };
  }

  const distros = parseWslListOutput(probe.output);
  const matched = distros.find((distro) => distro.name === configuredDistro) ?? null;
  return {
    applicable: true,
    wslAvailable: true,
    configuredDistro,
    distroFound: Boolean(matched),
    distroState: matched?.state ?? null,
    distros,
    status: matched ? "ok" : "warning",
    summary: matched
      ? `Configured WSL distro ${configuredDistro} is ${matched.state || "registered"}.`
      : `Configured WSL distro ${configuredDistro} was not found.`,
    nextActions: matched
      ? []
      : [
          `Install WSL distro ${configuredDistro} or set OPENCLAW_WSL_DISTRO to an installed distro.`
        ],
    error: null
  };
}

export async function getDockerRuntimeDiagnostics(): Promise<DockerRuntimeDiagnostics> {
  if (runningInsideContainer()) {
    return {
      applicable: false,
      dockerCliAvailable: false,
      daemonReachable: false,
      serverVersion: null,
      honeycombContainers: [],
      status: "ok",
      summary: "Docker host checks are skipped inside the API container.",
      nextActions: [],
      error: null
    };
  }

  const versionProbe = await probeCommand("docker", [
    "version",
    "--format",
    "{{.Server.Version}}"
  ]);
  if (!versionProbe.ok) {
    const cliMissing = /ENOENT|not recognized|no such file/i.test(versionProbe.error ?? "");
    return {
      applicable: true,
      dockerCliAvailable: !cliMissing,
      daemonReachable: false,
      serverVersion: null,
      honeycombContainers: [],
      status: cliMissing ? "warning" : "error",
      summary: cliMissing
        ? "Docker CLI is not installed; Docker-based deployment checks are unavailable."
        : "Docker CLI is installed but the Docker daemon is not reachable.",
      nextActions: cliMissing
        ? ["Install Docker Desktop if you want the Docker-based Honeycomb stack."]
        : ["Start Docker Desktop so the Honeycomb containers can run."],
      error: versionProbe.error
    };
  }

  const psProbe = await probeCommand("docker", [
    "ps",
    "--all",
    "--filter",
    `name=${HONEYCOMB_CONTAINER_FILTER}`,
    "--format",
    "{{json .}}"
  ]);
  const containers = psProbe.ok ? parseDockerPsJsonLines(psProbe.output) : [];
  const runningContainers = containers.filter((container) => container.state === "running");
  return {
    applicable: true,
    dockerCliAvailable: true,
    daemonReachable: true,
    serverVersion: versionProbe.output.trim() || null,
    honeycombContainers: containers,
    status: "ok",
    summary:
      containers.length === 0
        ? "Docker daemon is reachable; no Honeycomb containers are present (dev mode or Docker stack not started)."
        : `Docker daemon is reachable; ${runningContainers.length}/${containers.length} Honeycomb container(s) running.`,
    nextActions: [],
    error: psProbe.ok ? null : psProbe.error
  };
}

type HostDiagnosticsBundle = {
  wsl: WslRuntimeDiagnostics;
  docker: DockerRuntimeDiagnostics;
  checkedAt: number;
};

let hostDiagnosticsCache: HostDiagnosticsBundle | null = null;

// Probes shell out to wsl.exe/docker; cache briefly so panel polling does not
// spawn host processes on every diagnostics request.
export async function getHostRuntimeDiagnostics(input: { forceRefresh?: boolean } = {}): Promise<{
  wsl: WslRuntimeDiagnostics;
  docker: DockerRuntimeDiagnostics;
}> {
  const now = Date.now();
  if (!input.forceRefresh && hostDiagnosticsCache && now - hostDiagnosticsCache.checkedAt < CACHE_TTL_MS) {
    return { wsl: hostDiagnosticsCache.wsl, docker: hostDiagnosticsCache.docker };
  }
  const [wsl, docker] = await Promise.all([getWslRuntimeDiagnostics(), getDockerRuntimeDiagnostics()]);
  hostDiagnosticsCache = { wsl, docker, checkedAt: now };
  return { wsl, docker };
}

export function clearHostRuntimeDiagnosticsCache() {
  hostDiagnosticsCache = null;
}
