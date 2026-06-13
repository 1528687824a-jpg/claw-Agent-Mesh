import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rm, stat, unlink, writeFile, type FileHandle } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import net from "node:net";
import path from "node:path";

declare const WebSocket: any;

const root = path.resolve(__dirname, "..");
const desktopDir = path.join(root, "apps", "desktop-app");
const runtimeDir = path.join(root, ".runtime", "desktop-ui-smoke");
const apiUrl = "http://127.0.0.1:3000";
const mode = process.argv.includes("--prod") ? "prod" : "dev";
const skipApiStart = process.argv.includes("--skip-api-start");
const onboardingMode = process.argv.includes("--onboarding");
const memoryMode = process.argv.includes("--memory");
const uiPort = Number(process.env.DESKTOP_UI_SMOKE_PORT ?? (mode === "prod" ? 5174 : 5173));
const uiUrl = `http://127.0.0.1:${uiPort}`;
const flowName = onboardingMode ? "onboarding-" : memoryMode ? "memory-" : "";
const screenshotPath = path.join(runtimeDir, `desktop-ui-${flowName}${mode}-smoke.png`);
let apiAuthToken = process.env.HONEYCOMB_API_TOKEN?.trim() ?? "";

type CdpResponse = {
  id?: number;
  result?: any;
  error?: { message?: string };
};

type SmokeLock = {
  path: string;
  handle: FileHandle;
};

type SmokeLockMetadata = {
  pid?: unknown;
  startedAt?: unknown;
  command?: unknown;
};

function logStep(message: string) {
  console.log(`[desktop-ui-smoke] ${message}`);
}

function npmCommand() {
  return "npm";
}

function cleanEnv(env: NodeJS.ProcessEnv) {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key && !key.includes("=") && typeof value === "string") {
      output[key] = value;
    }
  }
  return output;
}

async function ensureApiAuthToken() {
  if (apiAuthToken) {
    process.env.HONEYCOMB_API_TOKEN = apiAuthToken;
    process.env.VITE_HONEYCOMB_API_TOKEN = apiAuthToken;
    return apiAuthToken;
  }

  const appDataDir = process.env.APPDATA || path.join(root, ".runtime");
  const tokenPath = path.join(appDataDir, "io.agentopenclaw.desktop", "honeycomb-api-token.txt");
  await mkdir(path.dirname(tokenPath), { recursive: true });

  try {
    apiAuthToken = (await readFile(tokenPath, "utf8")).trim();
  } catch {
    apiAuthToken = randomBytes(32).toString("base64url");
    await writeFile(tokenPath, `${apiAuthToken}\n`, "utf8");
  }

  if (!apiAuthToken) {
    throw new Error(`Honeycomb API token is empty: ${tokenPath}`);
  }

  process.env.HONEYCOMB_API_TOKEN = apiAuthToken;
  process.env.VITE_HONEYCOMB_API_TOKEN = apiAuthToken;
  return apiAuthToken;
}

function browserCandidates() {
  if (process.env.BROWSER_PATH) {
    return [process.env.BROWSER_PATH];
  }

  if (process.platform === "win32") {
    return [
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
    ];
  }

  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"];
}

async function pathExists(candidate: string) {
  try {
    await import("node:fs/promises").then((fs) => fs.access(candidate));
    return true;
  } catch {
    return false;
  }
}

async function findBrowser() {
  for (const candidate of browserCandidates()) {
    if (path.isAbsolute(candidate)) {
      if (await pathExists(candidate)) {
        return candidate;
      }
    } else {
      const probe = spawnSync(process.platform === "win32" ? "where.exe" : "which", [candidate], {
        stdio: "ignore"
      });
      if (probe.status === 0) {
        return candidate;
      }
    }
  }

  throw new Error("No supported Edge/Chrome browser found. Set BROWSER_PATH to run smoke:desktop-ui.");
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean } = {}
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: cleanEnv(options.env ?? process.env),
      stdio: "inherit",
      shell: options.shell ?? false
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
}

function spawnManaged(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    shell?: boolean;
    stdio?: "ignore" | "pipe";
  } = {}
) {
  return spawn(command, args, {
    cwd: options.cwd ?? root,
    env: cleanEnv(options.env ?? process.env),
    stdio: options.stdio === "ignore" ? "ignore" : ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: options.shell ?? false
  });
}

async function waitForHttp(url: string, timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function isHttpReady(url: string) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

function contentTypeFor(filePath: string) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

async function startStaticServer(distDir: string, port: number) {
  const indexPath = path.join(distDir, "index.html");
  await stat(indexPath);

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      const requestedPath = decodeURIComponent(requestUrl.pathname);
      const normalized = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
      const candidate = path.join(distDir, normalized === "/" ? "index.html" : normalized);
      const resolvedDist = path.resolve(distDir);
      const resolvedCandidate = path.resolve(candidate);

      let finalPath = resolvedCandidate.startsWith(resolvedDist) ? resolvedCandidate : indexPath;
      try {
        const fileStat = await stat(finalPath);
        if (fileStat.isDirectory()) {
          finalPath = indexPath;
        }
      } catch {
        finalPath = indexPath;
      }

      response.writeHead(200, { "content-type": contentTypeFor(finalPath) });
      createReadStream(finalPath).pipe(response);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  return server;
}

async function acquireSmokeLock(name: string): Promise<SmokeLock> {
  const lockDir = path.join(root, ".runtime", "locks");
  const lockPath = path.join(lockDir, `${name}.lock`);
  await mkdir(lockDir, { recursive: true });

  const writeLockMetadata = async (handle: FileHandle) => {
    await handle.writeFile(
      JSON.stringify(
        {
          pid: process.pid,
          startedAt: new Date().toISOString(),
          command: process.argv.join(" ")
        },
        null,
        2
      )
    );
  };

  try {
    const handle = await open(lockPath, "wx");
    await writeLockMetadata(handle);
    logStep(`acquired smoke lock '${name}'`);
    return { path: lockPath, handle };
  } catch (error: any) {
    if (error?.code === "EEXIST" && await removeStaleSmokeLock(lockPath)) {
      const handle = await open(lockPath, "wx");
      await writeLockMetadata(handle);
      logStep(`removed stale smoke lock and acquired '${name}'`);
      return { path: lockPath, handle };
    }

    let owner = "";
    try {
      owner = await readFile(lockPath, "utf8");
    } catch {
      // Ignore missing or unreadable lock metadata.
    }
    throw new Error(`Smoke lock '${name}' is already held. Lock file: ${lockPath}\n${owner || error.message}`);
  }
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === "EPERM";
  }
}

async function removeStaleSmokeLock(lockPath: string) {
  let owner: SmokeLockMetadata | null = null;
  try {
    owner = JSON.parse(await readFile(lockPath, "utf8")) as SmokeLockMetadata;
  } catch {
    await rm(lockPath, { force: true });
    return true;
  }

  const pid = typeof owner.pid === "number" ? owner.pid : null;
  if (!pid || !isProcessAlive(pid)) {
    await rm(lockPath, { force: true });
    return true;
  }

  return false;
}

async function releaseSmokeLock(lock: SmokeLock | null) {
  if (!lock) return;
  await lock.handle.close();
  await unlink(lock.path).catch(() => undefined);
}

async function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate TCP port")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

class CdpClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private ws: any;

  constructor(private readonly wsUrl: string) {}

  connect() {
    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (event: any) => reject(new Error(`CDP WebSocket error: ${String(event?.message ?? event)}`));
      this.ws.onmessage = (event: any) => {
        const message = JSON.parse(String(event.data)) as CdpResponse;
        if (!message.id) {
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) {
          return;
        }
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message ?? "CDP command failed"));
        } else {
          pending.resolve(message.result);
        }
      };
    });
  }

  send(method: string, params: Record<string, unknown> = {}, timeoutMs = 20_000) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`Timed out waiting for CDP method ${method} after ${timeoutMs}ms`));
        }
      }, timeoutMs);
    });
  }

  close() {
    this.ws?.close();
  }
}

async function openPage(browserPort: number, targetUrl: string) {
  const response = await fetch(
    `http://127.0.0.1:${browserPort}/json/new?${encodeURIComponent(targetUrl)}`,
    { method: "PUT" }
  );
  if (!response.ok) {
    throw new Error(`Failed to create browser tab: ${response.status}`);
  }
  const target = (await response.json()) as { webSocketDebuggerUrl?: string };
  if (!target.webSocketDebuggerUrl) {
    throw new Error("Browser tab did not expose a webSocketDebuggerUrl");
  }

  const page = new CdpClient(target.webSocketDebuggerUrl);
  await page.connect();
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("Page.navigate", { url: targetUrl });
  await page.send(
    "Runtime.evaluate",
    {
      expression: String.raw`
        new Promise((resolve) => {
          if (document.readyState === "complete" || document.readyState === "interactive") {
            resolve(document.readyState);
            return;
          }
          document.addEventListener("DOMContentLoaded", () => resolve(document.readyState), { once: true });
          setTimeout(() => resolve(document.readyState), 5000);
        })
      `,
      awaitPromise: true
    },
    10_000
  );
  return page;
}

async function runUiFlow(page: CdpClient) {
  const expression = String.raw`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (fn, message, timeoutMs = 60000) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const value = fn();
          if (value) return value;
          await sleep(250);
        }
        throw new Error(message);
      };
      const setNativeValue = (element, value) => {
        const prototype = Object.getPrototypeOf(element);
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        descriptor.set.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const formatDateTimeLocal = (date) => {
        const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
        return local.toISOString().slice(0, 16);
      };

      window.__agentOpenClawFetchUrls = [];
      window.__agentOpenClawJobRequests = [];
      window.__honeycombRepairRequests = [];
      const originalFetch = window.fetch.bind(window);
      window.fetch = (...args) => {
        const target = args[0];
        const url = typeof target === "string" ? target : target?.url ?? String(target);
        window.__agentOpenClawFetchUrls.push(url);
        const method = (args[1]?.method || target?.method || "GET").toUpperCase();
        const body = args[1]?.body;
        if (url.endsWith("/jobs") && method === "POST" && typeof body === "string") {
          try {
            window.__agentOpenClawJobRequests.push(JSON.parse(body));
          } catch {
            window.__agentOpenClawJobRequests.push({ parseFailed: true, body });
          }
        }
        if (url.endsWith("/runtime/repair") && method === "POST" && typeof body === "string") {
          try {
            window.__honeycombRepairRequests.push(JSON.parse(body));
          } catch {
            window.__honeycombRepairRequests.push({ parseFailed: true, body });
          }
        }
        return originalFetch(...args);
      };

      const englishButton = Array.from(document.querySelectorAll(".languageButton"))
        .find((candidate) => candidate.textContent.trim() === "English");
      englishButton?.click();
      await waitFor(() => document.querySelector(".supervisorWorkbenchGrid"), "supervisor workbench missing before job creation");
      await waitFor(() => document.querySelector('[data-testid="runtime-repair-card"]'), "runtime repair card missing");
      const repairAction = await waitFor(
        () => {
          const button = document.querySelector('[data-testid="runtime-repair-action-providers.reconcileSecrets"]');
          return button && !button.disabled ? button : null;
        },
        "provider secret repair action missing"
      );
      repairAction.click();
      await waitFor(
        () => window.__honeycombRepairRequests.some((request) => request.action === "providers.reconcileSecrets"),
        "runtime repair request was not sent"
      );
      await waitFor(
        () => document.body.textContent.includes("Provider secret status") || document.body.textContent.includes("Reconciled"),
        "runtime repair result was not rendered"
      );
      setNativeValue(document.querySelector(".configCard input"), "C:\\Users\\Administrator\\Desktop\\Smoke Workspace");
      const skillAreas = Array.from(document.querySelectorAll(".toolsCard textarea"));
      setNativeValue(skillAreas[0], "writing, test review, routing");
      setNativeValue(skillAreas[1], "filesystem, git, browser");
      document.querySelector(".toolsCard button").click();
      await waitFor(() => document.body.textContent.includes("Workbench config saved locally."), "workbench config was not saved before job creation");
      const consoleTab = await waitFor(
        () => document.querySelector('[data-testid="console-view-tab"]'),
        "console tab missing"
      );
      consoleTab.click();
      await sleep(100);
      await waitFor(() => document.querySelector("#prompt"), "prompt field missing");
      const smartRoutingVisible = Boolean(document.querySelector('[data-testid="smart-routing-badge"]')) &&
        document.body.textContent.includes("Smart routing");
      const manualRoutingHidden = !document.querySelector("#routingMode");

      const beforeJobIds = new Set(
        Array.from(document.querySelectorAll(".jobRow strong"))
          .map((node) => node.textContent?.trim() ?? "")
          .filter((text) => text.startsWith("JOB-"))
      );

      const prompt = document.querySelector("#prompt");
      const maxModelCalls = document.querySelector("#maxModelCalls");
      setNativeValue(prompt, "Desktop UI smoke: create a cancellable mock job and show the timeline.");
      setNativeValue(maxModelCalls, "20");
      if (!smartRoutingVisible || !manualRoutingHidden) {
        throw new Error("smart routing UI did not replace manual routing select");
      }
      const submitButton = await waitFor(() => {
        const button = document.querySelector('[data-testid="start-job-button"]');
        return button && !button.disabled ? button : null;
      }, "start job button was not enabled");
      submitButton.click();
      await waitFor(() => window.__agentOpenClawJobRequests.length > 0, "job request body was not captured");
      const jobRequest = window.__agentOpenClawJobRequests.at(-1) || {};
      const jobRequestIncludesWorkbench =
        jobRequest.workdir === "C:\\Users\\Administrator\\Desktop\\Smoke Workspace" &&
        jobRequest.prompt.includes("[Honeycomb supervisor workbench context]") &&
        jobRequest.prompt.includes("Available skills: writing, test review, routing") &&
        jobRequest.prompt.includes("Available MCP: filesystem, git, browser");
      if (!jobRequestIncludesWorkbench) {
        throw new Error("job request did not include supervisor workbench context");
      }

      const jobId = await waitFor(() => {
        const rows = Array.from(document.querySelectorAll(".jobRow"));
        for (const row of rows) {
          const text = row.querySelector("strong")?.textContent?.trim() ?? "";
          if (text.startsWith("JOB-") && !beforeJobIds.has(text)) {
            row.click();
            return text;
          }
        }
        return "";
      }, "newly created job did not appear in list");

      await waitFor(() => document.body.textContent.includes(jobId), "created job was not selected");

      const cancelButton = await waitFor(
        () => document.querySelector(".dangerButton"),
        "cancel button missing"
      );
      const cancelAttempted = !cancelButton.disabled;
      if (cancelAttempted) {
        cancelButton.click();
      }

      const terminalStatus = await waitFor(() => {
        const selectedRowStatus = document.querySelector(".jobRow.selected .jobStatus")?.textContent?.trim() ?? "";
        const detailStatus = document.querySelector(".stats dd")?.textContent?.trim() ?? "";
        const status = detailStatus || selectedRowStatus;
        if (["cancelled", "succeeded", "failed", "waiting_for_human"].includes(status)) {
          return status;
        }
        return "";
      }, "job did not reach a terminal status", 90000);

      if (!["cancelled", "succeeded"].includes(terminalStatus)) {
        throw new Error("unexpected UI smoke terminal status: " + terminalStatus);
      }

      const search = await waitFor(() => document.querySelector("#jobSearch"), "job search field missing");
      setNativeValue(search, "Desktop UI smoke");
      const statusFilter = await waitFor(
        () => document.querySelector(
          terminalStatus === "cancelled"
            ? '.filterSegment[data-filter="cancelled"]'
            : '.filterSegment[data-filter="all"]'
        ),
        "status filter missing"
      );
      statusFilter.click();

      await waitFor(() => {
        const rows = Array.from(document.querySelectorAll(".jobRow"));
        const statuses = rows.map((row) => row.querySelector(".jobStatus")?.textContent?.trim() ?? "");
        return rows.some((row) => row.querySelector("strong")?.textContent?.trim() === jobId) &&
          statuses.length > 0 &&
          (terminalStatus !== "cancelled" || statuses.every((status) => status === "cancelled"));
      }, "search/status filters did not keep created job visible");

      const dayFilter = await waitFor(
        () => document.querySelector('.filterSegment[data-time-filter="24h"]'),
        "24h time filter missing"
      );
      dayFilter.click();

      await waitFor(() => {
        const rows = Array.from(document.querySelectorAll(".jobRow"));
        return rows.some((row) => row.querySelector("strong")?.textContent?.trim() === jobId);
      }, "24h time filter did not keep created job visible");

      const customFilter = await waitFor(
        () => document.querySelector('.filterSegment[data-time-filter="custom"]'),
        "custom time filter missing"
      );
      customFilter.click();
      const sinceInput = await waitFor(() => document.querySelector("#jobSince"), "custom since input missing");
      const untilInput = await waitFor(() => document.querySelector("#jobUntil"), "custom until input missing");
      setNativeValue(sinceInput, formatDateTimeLocal(new Date(Date.now() - 24 * 60 * 60 * 1000)));
      setNativeValue(untilInput, formatDateTimeLocal(new Date(Date.now() + 24 * 60 * 60 * 1000)));

      await waitFor(() => {
        const rows = Array.from(document.querySelectorAll(".jobRow"));
        return rows.some((row) => row.querySelector("strong")?.textContent?.trim() === jobId);
      }, "custom since/until filter did not keep created job visible");

      await waitFor(() => {
        return window.__agentOpenClawFetchUrls.some((url) => url.includes("/timeline?") && url.includes("cursor="));
      }, "timeline cursor request was not observed");

      await waitFor(() => document.querySelectorAll(".timelineItem").length > 0, "timeline did not render");
      const timelineCursorRequests = window.__agentOpenClawFetchUrls
        .filter((url) => url.includes("/timeline?") && url.includes("cursor="))
        .length;

      return {
        jobId,
        terminalStatus,
        cancelAttempted,
        jobRequestIncludesWorkbench,
        smartRoutingVisible,
        manualRoutingHidden,
        statusVisible: document.body.textContent.includes(terminalStatus),
        filteredJobVisible: Array.from(document.querySelectorAll(".jobRow"))
          .some((row) => row.querySelector("strong")?.textContent?.trim() === jobId),
        filteredStatuses: Array.from(document.querySelectorAll(".jobRow .jobStatus"))
          .map((node) => node.textContent?.trim() ?? ""),
        timeFilterVisible: Boolean(document.querySelector('.filterSegment.active[data-time-filter="custom"]')),
        customSinceVisible: Boolean(document.querySelector("#jobSince")),
        timelineCursorRequests,
        timelineItems: document.querySelectorAll(".timelineItem").length,
        runtimeRepairActionCalled: window.__honeycombRepairRequests
          .some((request) => request.action === "providers.reconcileSecrets"),
        title: document.querySelector(".jobDetail h2")?.textContent?.trim() ?? ""
      };
    })()
  `;

  const result = await page.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, 125_000);

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "UI flow failed");
  }

  return result.result.value as {
    jobId: string;
    terminalStatus: "cancelled" | "succeeded";
    cancelAttempted: boolean;
    jobRequestIncludesWorkbench: boolean;
    smartRoutingVisible: boolean;
    manualRoutingHidden: boolean;
    statusVisible: boolean;
    filteredJobVisible: boolean;
    filteredStatuses: string[];
    timeFilterVisible: boolean;
    customSinceVisible: boolean;
    timelineCursorRequests: number;
    timelineItems: number;
    title: string;
  };
}

async function runOnboardingFlow(page: CdpClient) {
  const expression = String.raw`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (fn, message, timeoutMs = 15000) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const value = fn();
          if (value) return value;
          await sleep(100);
        }
        throw new Error(message);
      };
      const setNativeValue = (element, value) => {
        const prototype = Object.getPrototypeOf(element);
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        descriptor.set.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };

      localStorage.clear();
      sessionStorage.clear();
      location.search = "?lang=zh";
      await new Promise(() => {});
    })()
  `;

  await page.send("Runtime.evaluate", { expression, awaitPromise: false });
  await page.send("Page.loadEventFired", {}, 10_000).catch(() => undefined);

  const flowExpression = String.raw`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (fn, message, timeoutMs = 20000) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const value = fn();
          if (value) return value;
          await sleep(100);
        }
        throw new Error(message);
      };
      const setNativeValue = (element, value) => {
        const prototype = Object.getPrototypeOf(element);
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        descriptor.set.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };

      await waitFor(() => document.querySelector(".supervisorForm"), "welcome setup did not appear");
      const welcomeTitleVisible = document.body.textContent.includes("开始创造您第一个专属AI员工");
      const nameNext = await waitFor(() => document.querySelector(".supervisorForm .supervisorNext"), "supervisor next button missing");
      const nameButtonDisabledBeforeInput = nameNext.disabled;
      const supervisorNameInput = document.querySelector(".supervisorNameField input");
      const supervisorInputHeight = supervisorNameInput.getBoundingClientRect().height;
      const supervisorNextHeight = nameNext.getBoundingClientRect().height;
      setNativeValue(supervisorNameInput, "蜂巢主管");
      await waitFor(() => !document.querySelector(".supervisorForm .supervisorNext").disabled, "supervisor next button did not enable");
      const nameButtonEnabledAfterInput = !document.querySelector(".supervisorForm .supervisorNext").disabled;
      document.querySelector(".supervisorForm .supervisorNext").click();

      await waitFor(() => document.querySelector(".providerFocus"), "provider setup did not appear");
      await waitFor(() => document.querySelector(".providerFocus.settled"), "provider setup did not settle after slide transition");
      const providerTitleUpdated = document.body.textContent.includes("开始创造您第一个专属AI员工");
      const providerIntroUpdated = document.body.textContent.includes("定制专属提示词") &&
        document.body.textContent.includes("大模型之后可以随时更改");
      const providerLabelText = Array.from(document.querySelectorAll(".providerFocus label"))
        .map((label) => label.textContent.trim())
        .join("|");
      const providerFieldsSimplified = providerLabelText.includes("模型") &&
        providerLabelText.includes("API Key") &&
        !providerLabelText.includes("模型服务商") &&
        !providerLabelText.includes("接口地址");
      const providerInputHeight = document.querySelector(".providerFocus input")?.getBoundingClientRect().height ?? 0;
      const modelPlaceholderVisible = document.querySelector(".providerFocus input")?.placeholder === "例如：deepseek-chat" &&
        document.querySelector(".providerFocus input")?.value === "";
      const supervisorControlsCompact = supervisorInputHeight <= providerInputHeight + 4 &&
        supervisorNextHeight <= providerInputHeight + 4;
      const providerBackButtonVisible = document.querySelector(".providerFocus .setupBack")?.textContent.includes("上一步");
      document.querySelector(".providerFocus .setupBack").click();
      await waitFor(() => document.querySelector(".supervisorForm:not(.entering) .supervisorNext"), "provider back button did not return to welcome");
      document.querySelector(".supervisorForm .supervisorNext").click();
      await waitFor(() => document.querySelector(".providerFocus.settled"), "provider setup did not reappear after back navigation");

      const navLocked = !document.querySelector('[data-testid="console-view-tab"]');
      const apiKeyToggleVisible = Boolean(document.querySelector(".providerFocus .apiKeyToggle"));
      const apiKeyHiddenByDefault = document.querySelector(".providerFocus .apiKeyInputShell input")?.type === "password";
      document.querySelector(".providerFocus .apiKeyToggle").click();
      await waitFor(() => document.querySelector(".providerFocus .apiKeyInputShell input")?.type === "text", "API key did not become visible");
      const apiKeyVisibleAfterToggle = document.querySelector(".providerFocus .apiKeyInputShell input")?.type === "text";
      document.querySelector(".providerFocus .apiKeyToggle").click();
      await waitFor(() => document.querySelector(".providerFocus .apiKeyInputShell input")?.type === "password", "API key did not hide again");
      const apiKeyHiddenAfterToggle = document.querySelector(".providerFocus .apiKeyInputShell input")?.type === "password";
      const apiKey = document.querySelector(".providerFocus .apiKeyInputShell input");
      setNativeValue(apiKey, "smoke-private-key");
      setNativeValue(document.querySelector(".providerFocus input"), "deepseek-chat");
      document.querySelector(".providerFocus .setupPrimary").click();

      await waitFor(() => document.querySelector(".interviewStage"), "interview did not appear");
      const firstQuestion = document.querySelector(".questionCard input");
      const firstQuestionPlaceholderVisible =
        firstQuestion.placeholder === "例如：科技领域、绘画领域、摄影领域……" &&
        firstQuestion.value === "";
      const firstInterviewBackVisible = document.querySelector(".questionCard .interviewBack")?.textContent.includes("上一步");
      const interviewNextHeight = document.querySelector(".questionCard .interviewNext")?.getBoundingClientRect().height ?? 0;
      const interviewNextCompact = interviewNextHeight <= providerInputHeight + 4;
      setNativeValue(firstQuestion, "农业领域");
      document.querySelector(".questionCard .setupPrimary").click();

      await waitFor(() => document.body.textContent.includes("Agent 正在思考中"), "first thinking state missing");
      await waitFor(() => {
        const placeholder = document.querySelector(".questionCard input")?.placeholder || "";
        return placeholder.includes("农场主") || placeholder.includes("农业技术员");
      }, "tailored agriculture role placeholder missing");
      const role = document.querySelector(".questionCard input");
      const tailoredPlaceholder = role.placeholder;
      const interviewBackVisibleOnRole = document.querySelector(".questionCard .interviewBack")?.textContent.includes("上一步");
      document.querySelector(".questionCard .interviewBack").click();
      await waitFor(() => document.querySelector(".questionCard input")?.value === "农业领域", "interview back did not return to domain question");
      document.querySelector(".questionCard .setupPrimary").click();
      await waitFor(() => {
        const placeholder = document.querySelector(".questionCard input")?.placeholder || "";
        return placeholder.includes("农场主") || placeholder.includes("农业技术员");
      }, "tailored agriculture placeholder missing after interview back");
      setNativeValue(document.querySelector(".questionCard input"), "农场主");
      document.querySelector(".questionCard .setupPrimary").click();

      await waitFor(() => document.body.textContent.includes("Agent 正在思考中"), "second thinking state missing");
      await waitFor(() => document.querySelectorAll(".workOption").length >= 4, "generated work options missing");
      const interviewBackVisibleOnWork = document.querySelector(".questionCard .interviewBack")?.textContent.includes("上一步");
      const workOptionText = Array.from(document.querySelectorAll(".workOption")).map((option) => option.textContent).join("|");
      const agricultureWorkOptions = workOptionText.includes("农事") || workOptionText.includes("病虫害") || workOptionText.includes("农资");
      document.querySelector(".workOption").click();
      await sleep(80);
      document.querySelector(".questionCard .setupPrimary").click();

      const quality = await waitFor(() => document.querySelector(".questionCard textarea"), "quality question missing");
      const qualityPlaceholder = quality.placeholder || "";
      const qualityPlaceholderTailored =
        qualityPlaceholder.includes("农事") ||
        qualityPlaceholder.includes("成本") ||
        qualityPlaceholder.includes("复盘") ||
        qualityPlaceholder.includes("可追溯");
      const interviewBackVisibleOnQuality = document.querySelector(".questionCard .interviewBack")?.textContent.includes("上一步");
      setNativeValue(quality, "准确、简洁、可以直接交付");
      document.querySelector(".questionCard .setupPrimary").click();

      await waitFor(() => document.querySelector(".reviewStage"), "review stage missing");
      const reviewText = document.querySelector(".reviewStage")?.textContent || "";
      const reviewRoutingTranslated =
        !reviewText.includes("master_slave_discussion") &&
        !reviewText.includes("classic_master_slave") &&
        !reviewText.includes("supervisor_pipeline") &&
        !reviewText.includes("pipeline");
      const generatedAgentCount = document.querySelectorAll(".agentReviewGrid article").length;
      const generatedTeamHasVideoAndNoMain = document.querySelector(".agentReviewGrid")?.textContent.includes("video-agent") === true &&
        document.querySelector(".agentReviewGrid")?.textContent.includes("main-agent") === false;
      document.querySelector(".reviewStage .setupPrimary").click();
      await waitFor(() => document.querySelector(".openclawInviteStage"), "openclaw invite stage did not appear after setup completion");
      await waitFor(() => document.body.textContent.includes("蜂巢主管:那我们开始在openclaw上配置多个agent来为你打工吧？"), "openclaw invite text missing");
      const inviteTextVisible = document.body.textContent.includes("蜂巢主管:那我们开始在openclaw上配置多个agent来为你打工吧？");
      const inviteLightAnimationVisible =
        document.querySelectorAll(".logoLineField span").length >= 60 &&
        Boolean(document.querySelector(".inviteLightOrb"));
      document.querySelector(".inviteNo").click();
      await waitFor(() => document.body.textContent.includes("可是不配置多个agent的话就没办法工作了QAQ"), "openclaw sad response missing");
      const inviteSadState = document.querySelector(".openclawInviteStage")?.classList.contains("sad") === true &&
        Boolean(document.querySelector(".inviteTears")) &&
        !document.querySelector(".inviteFaceSad");
      document.querySelector(".inviteYes").click();
      await waitFor(() => document.querySelector(".openclawInviteStage")?.classList.contains("happy"), "openclaw happy state did not appear");
      const inviteHappyCannonVisible = document.querySelector(".openclawInviteStage")?.classList.contains("happy") === true &&
        document.querySelectorAll(".inviteConfetti span").length >= 24 &&
        !document.querySelector(".inviteFlowers") &&
        !document.querySelector(".inviteFaceHappy");
      await waitFor(() => document.querySelector(".agentGrid"), "agent page did not appear after accepting openclaw invite");

      const consoleVisibleAfterComplete = Boolean(document.querySelector('[data-testid="console-view-tab"]'));
      const setupTabHiddenAfterComplete =
        !document.querySelector('[data-testid="setup-view-tab"]') &&
        !document.querySelector('[data-testid="setup-view-tab-secondary"]');
      const tourVisibleAfterSetup = Boolean(document.querySelector(".tourOverlay"));
      const tourCornerLogoRemoved = !document.querySelector(".tourCornerLogo");
      document.querySelector(".tourClose")?.click();
      await sleep(120);

      document.querySelector('button[aria-label="仪表盘"]')?.click();
      await waitFor(() => document.querySelector(".supervisorWorkbenchGrid"), "supervisor workbench grid missing");
      const supervisorWorkbenchVisible =
        document.body.textContent.includes("主管工作台") &&
        document.body.textContent.includes("运行时配置") &&
        document.body.textContent.includes("流式反馈") &&
        document.body.textContent.includes("计划与 Todo") &&
        document.body.textContent.includes("项目工作区") &&
        document.body.textContent.includes("权限控制") &&
        document.body.textContent.includes("Skills 与 MCP");
      setNativeValue(document.querySelector(".configCard input"), "C:\\Users\\Administrator\\Desktop\\农业项目");
      const permissionToggle = document.querySelector(".permissionToggle input");
      permissionToggle.click();
      const skillAreas = Array.from(document.querySelectorAll(".toolsCard textarea"));
      setNativeValue(skillAreas[0], "写作, 农业调研, 评审");
      setNativeValue(skillAreas[1], "filesystem, git, browser");
      document.querySelector(".toolsCard button").click();
      await waitFor(() => document.body.textContent.includes("工作台配置已保存在本地。"), "workbench save confirmation missing");
      const workbenchConfig = JSON.parse(localStorage.getItem("honeycomb.supervisorWorkbench") || "{}");
      const workbenchConfigSaved =
        workbenchConfig.workspacePath === "C:\\Users\\Administrator\\Desktop\\农业项目" &&
        workbenchConfig.skills.includes("农业调研") &&
        workbenchConfig.mcpServers.includes("filesystem") &&
        typeof workbenchConfig.permissions?.readWorkspace === "boolean";

      document.querySelector('button[aria-label="设置"]')?.click();
      await waitFor(() => document.querySelector(".resetPanel"), "settings reset panel missing");
      const resetPanelVisible = document.body.textContent.includes("重新设置你的面板agent") &&
        document.body.textContent.includes("重新设置你的职业");
      const securityIntroUpdated = document.body.textContent.includes("设置本地面板密码和密保问题。");
      const recoverySelect = document.querySelector(".securityPanel select");
      const recoveryOptionsText = Array.from(recoverySelect?.querySelectorAll("option") || [])
        .map((option) => option.textContent || "")
        .join("|");
      const localizedRecoveryQuestions = recoveryOptionsText.includes("你第一次准备用这个面板处理什么项目？") &&
        recoveryOptionsText.includes("其他");
      const securityPasswords = Array.from(document.querySelectorAll(".securityPanel input[type='password']"));
      setNativeValue(securityPasswords[0], "old-panel-pass");
      setNativeValue(securityPasswords[1], "old-panel-pass");
      setNativeValue(securityPasswords[2], "panel-recovery-answer");
      document.querySelector(".securityPanel .primaryButton").click();
      await waitFor(() => document.body.textContent.includes("修改密码或密保问题前"), "configured security panel did not appear");
      const configuredSecurityLocked = document.body.textContent.includes("面板密码") &&
        !document.body.textContent.includes("修改密保问题") &&
        !document.body.textContent.includes("取消本地面板密码") &&
        !document.body.textContent.includes("取消密保问题");
      setNativeValue(document.querySelector(".securityPanel input[type='password']"), "old-panel-pass");
      document.querySelector(".securityPanel .primaryButton").click();
      await waitFor(() => document.body.textContent.includes("修改密保问题"), "security edit controls did not appear after password confirmation");
      const configuredSecurityRequiresCurrent = configuredSecurityLocked &&
        document.body.textContent.includes("修改密保问题") &&
        document.body.textContent.includes("取消本地面板密码") &&
        document.body.textContent.includes("取消修改") &&
        !document.body.textContent.includes("取消密保问题");
      Array.from(document.querySelectorAll(".securityPanel button"))
        .find((button) => button.textContent.includes("取消修改"))
        ?.click();
      await waitFor(() => document.body.textContent.includes("面板密码") && !document.body.textContent.includes("修改密保问题"), "cancel modification did not return to locked security view");
      const cancelModifyReturnsLocked = document.body.textContent.includes("面板密码") &&
        !document.body.textContent.includes("修改密保问题");

      document.querySelector('button[aria-label="模型"]')?.click();
      await waitFor(() => document.querySelector(".routingFlowChart"), "model routing flow chart missing");
      const modelFlowVisible = document.querySelectorAll(".routingFlowChart article").length >= 5 &&
        !document.body.textContent.includes("编排配置");

      document.querySelector('button[aria-label="Agent"]')?.click();
      await waitFor(() => document.querySelector(".agentGrid"), "agent page missing");
      const agentPageUsesSupervisorName = document.body.textContent.includes("蜂巢主管");
      const agentPageHasNoDuplicateMain = !document.body.textContent.includes("main-agent");
      const videoAgentVisible = document.body.textContent.includes("video-agent");
      const specialistAgentsPending = document.querySelectorAll(".agentModelTag.pending").length >= 5 &&
        document.body.textContent.includes("配置模型与 Key");
      const agentConfigButton = Array.from(document.querySelectorAll(".agentConfigureButton"))
        .find((button) => button.textContent.includes("配置模型与 Key"));
      const agentConfigButtonStyle = agentConfigButton ? getComputedStyle(agentConfigButton) : null;
      const agentConfigButtonOrange = Boolean(agentConfigButtonStyle?.backgroundColor && agentConfigButtonStyle.backgroundColor !== "rgba(0, 0, 0, 0)");
      agentConfigButton?.click();
      await waitFor(() => document.querySelector(".agentPanel.expanded .agentConfigPanel"), "expanded agent config panel missing");
      const expandedAgentConfigVisible =
        document.querySelector(".agentPanel.expanded")?.getBoundingClientRect().width > document.querySelector(".agentGrid")?.getBoundingClientRect().width * 0.9 &&
        document.body.textContent.includes("Agent 模型配置") &&
        document.body.textContent.includes("保存配置");
      const agentConfigLabelText = Array.from(document.querySelectorAll(".agentPanel.expanded .agentConfigFields label"))
        .map((label) => label.textContent.trim())
        .join(" ");
      const agentConfigFieldsSimplified = agentConfigLabelText.includes("模型") &&
        agentConfigLabelText.includes("API Key") &&
        !agentConfigLabelText.includes("模型服务商") &&
        !agentConfigLabelText.includes("接口地址") &&
        !agentConfigLabelText.includes("Provider") &&
        !agentConfigLabelText.includes("Base URL");
      const agentConfigApiKeyRetained = document.querySelector(".agentPanel.expanded .apiKeyInputShell input")?.value === "smoke-private-key";

      document.querySelector('button[aria-label="设置"]')?.click();
      await waitFor(() => document.querySelector(".resetPanel"), "settings panel missing after agent page");
      const englishButton = Array.from(document.querySelectorAll(".languageButton"))
        .find((candidate) => candidate.textContent.trim() === "English");
      englishButton?.click();
      await waitFor(() => document.body.textContent.includes("Panel agent"), "english reset panel text missing");
      const englishResetButtonsFit = Array.from(document.querySelectorAll(".resetActionButton"))
        .every((button) => button.scrollWidth <= button.clientWidth + 2);
      const panelAgentResetButton = Array.from(document.querySelectorAll(".resetActionButton"))
        .find((button) => button.textContent.includes("Panel agent"));
      panelAgentResetButton?.click();
      await waitFor(() => document.querySelector(".supervisorForm"), "panel agent reset name step missing");
      document.querySelector(".supervisorForm .supervisorNext").click();
      await waitFor(() => document.querySelector(".providerFocus.settled"), "panel agent reset provider step missing");
      const resetApiKeyRetained = document.querySelector(".providerFocus .apiKeyInputShell input")?.value === "smoke-private-key";
      document.querySelector(".providerFocus .setupBack + .setupBack")?.click();
      await waitFor(() => document.querySelector(".resetPanel"), "cancel setup did not return to settings");
      const savedPreview = JSON.parse(localStorage.getItem("honeycomb.firstRunPreview") || "{}");
      const supervisorPrompt = savedPreview.agents?.find((agent) => agent.path.includes("panel-supervisor-agent"))?.contents || "";
      const supervisorPromptHasGuardrails =
        supervisorPrompt.includes("Never ask the user to paste API keys") &&
        supervisorPrompt.includes("If the user asks whether they can add several child agents");
      const toggle = document.querySelector('[data-testid="sidebar-toggle"]');
      toggle.click();
      await sleep(250);
      const collapsed = document.querySelector(".darkShell").classList.contains("sideCollapsed");

      if (!welcomeTitleVisible) throw new Error("updated welcome title was not visible");
      if (!nameButtonDisabledBeforeInput) throw new Error("supervisor next button was not disabled before input");
      if (!nameButtonEnabledAfterInput) throw new Error("supervisor next button was not enabled after input");
      if (!providerTitleUpdated || !providerIntroUpdated) throw new Error("provider copy was not updated");
      if (!modelPlaceholderVisible) throw new Error("model input placeholder did not show the gray example");
      if (!providerFieldsSimplified) throw new Error("provider fields were not simplified to model and API key");
      if (!firstQuestionPlaceholderVisible) throw new Error("first work interview question did not use a gray placeholder");
      if (!supervisorControlsCompact) {
        throw new Error(
          "supervisor input/button are taller than provider inputs: input=" +
            supervisorInputHeight +
            ", button=" +
            supervisorNextHeight +
            ", provider=" +
            providerInputHeight
        );
      }
      if (!providerBackButtonVisible) throw new Error("provider back button was not visible");
      if (!interviewNextCompact) {
        throw new Error("interview next button is too tall: " + interviewNextHeight + ", provider=" + providerInputHeight);
      }
      if (!firstInterviewBackVisible || !interviewBackVisibleOnRole || !interviewBackVisibleOnWork || !interviewBackVisibleOnQuality) {
        throw new Error("interview back button was not visible on every question");
      }
      if (!agricultureWorkOptions) throw new Error("agriculture work options were not tailored: " + workOptionText);
      if (!qualityPlaceholderTailored) throw new Error("quality placeholder was not tailored to agriculture work: " + qualityPlaceholder);
      if (!reviewRoutingTranslated) throw new Error("review routing mode leaked a raw id: " + reviewText);
      if (generatedAgentCount !== 6 || !generatedTeamHasVideoAndNoMain) throw new Error("generated team did not contain panel + five specialists without main-agent");
      if (!inviteTextVisible || !inviteLightAnimationVisible || !inviteSadState || !inviteHappyCannonVisible) {
        throw new Error("openclaw invite animation did not match light gather / tears / confetti requirements");
      }
      if (!setupTabHiddenAfterComplete) throw new Error("first-run setup tab was still visible after setup completion");
      if (!supervisorWorkbenchVisible || !workbenchConfigSaved) throw new Error("supervisor workbench modules were missing or did not save config");
      if (!resetPanelVisible) throw new Error("settings reset panel was not visible");
      if (!securityIntroUpdated) throw new Error("security intro copy was not updated");
      if (!localizedRecoveryQuestions) throw new Error("localized recovery question select was not available: " + recoveryOptionsText);
      if (!configuredSecurityRequiresCurrent) throw new Error("configured security panel did not require current password or exposed wrong cancel action");
      if (!cancelModifyReturnsLocked) throw new Error("cancel modification did not return to password confirmation state");
      if (!modelFlowVisible) throw new Error("model routing flow chart was not visible or old config label leaked");
      if (!agentPageUsesSupervisorName || !specialistAgentsPending || !agentPageHasNoDuplicateMain || !videoAgentVisible) throw new Error("agent page did not show supervisor name, video agent, and pending specialists without duplicate main-agent");
      if (!agentConfigButtonOrange || !expandedAgentConfigVisible) throw new Error("agent config button was not orange or expanded panel was not visible");
      if (!agentConfigFieldsSimplified || !agentConfigApiKeyRetained) throw new Error("agent config fields were not simplified or retained the supervisor API key");
      if (!englishResetButtonsFit) throw new Error("english reset panel buttons overflowed their containers");
      if (!resetApiKeyRetained) throw new Error("panel agent reset did not retain the configured API key");
      if (!apiKeyToggleVisible || !apiKeyHiddenByDefault || !apiKeyVisibleAfterToggle || !apiKeyHiddenAfterToggle) {
        throw new Error("API key visibility toggle did not work");
      }
      if (!supervisorPromptHasGuardrails) throw new Error("panel supervisor prompt guardrails missing");
      if (!tourVisibleAfterSetup) throw new Error("guided tour did not appear after setup");
      if (!tourCornerLogoRemoved) throw new Error("guided tour corner logo was still visible");

      return {
        navLocked,
        welcomeTitleVisible,
        nameButtonDisabledBeforeInput,
        nameButtonEnabledAfterInput,
        providerTitleUpdated,
        providerIntroUpdated,
        providerFieldsSimplified,
        modelPlaceholderVisible,
        firstQuestionPlaceholderVisible,
        supervisorControlsCompact,
        supervisorInputHeight,
        supervisorNextHeight,
        providerInputHeight,
        providerBackButtonVisible,
        apiKeyToggleVisible,
        apiKeyHiddenByDefault,
        apiKeyVisibleAfterToggle,
        apiKeyHiddenAfterToggle,
        tailoredPlaceholder,
        interviewNextHeight,
        interviewNextCompact,
        firstInterviewBackVisible,
        interviewBackVisibleOnRole,
        interviewBackVisibleOnWork,
        interviewBackVisibleOnQuality,
        agricultureWorkOptions,
        qualityPlaceholder,
        qualityPlaceholderTailored,
        reviewRoutingTranslated,
        generatedAgentCount,
        inviteTextVisible,
        inviteLightAnimationVisible,
        inviteSadState,
        inviteHappyCannonVisible,
        tourVisibleAfterSetup,
        tourCornerLogoRemoved,
        setupTabHiddenAfterComplete,
        supervisorWorkbenchVisible,
        workbenchConfigSaved,
        resetPanelVisible,
        securityIntroUpdated,
        localizedRecoveryQuestions,
        configuredSecurityRequiresCurrent,
        cancelModifyReturnsLocked,
        modelFlowVisible,
        agentPageUsesSupervisorName,
        specialistAgentsPending,
        agentConfigButtonOrange,
        expandedAgentConfigVisible,
        englishResetButtonsFit,
        resetApiKeyRetained,
        supervisorPromptHasGuardrails,
        consoleVisibleAfterComplete,
        collapsed,
        setupCompleted: localStorage.getItem("honeycomb.setupCompleted") === "true",
        language: localStorage.getItem("agentOpenClaw.language")
      };
    })()
  `;

  const result = await page.send("Runtime.evaluate", {
    expression: flowExpression,
    awaitPromise: true,
    returnByValue: true
  }, 90_000);

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Onboarding UI flow failed");
  }
  return result.result.value as {
    navLocked: boolean;
    welcomeTitleVisible: boolean;
    nameButtonDisabledBeforeInput: boolean;
    nameButtonEnabledAfterInput: boolean;
    providerTitleUpdated: boolean;
    providerIntroUpdated: boolean;
    providerFieldsSimplified: boolean;
    modelPlaceholderVisible: boolean;
    firstQuestionPlaceholderVisible: boolean;
    supervisorControlsCompact: boolean;
    supervisorInputHeight: number;
    supervisorNextHeight: number;
    providerInputHeight: number;
    providerBackButtonVisible: boolean;
    apiKeyToggleVisible: boolean;
    apiKeyHiddenByDefault: boolean;
    apiKeyVisibleAfterToggle: boolean;
    apiKeyHiddenAfterToggle: boolean;
    tailoredPlaceholder: string;
    interviewNextHeight: number;
    interviewNextCompact: boolean;
    firstInterviewBackVisible: boolean;
    interviewBackVisibleOnRole: boolean;
    interviewBackVisibleOnWork: boolean;
    interviewBackVisibleOnQuality: boolean;
    agricultureWorkOptions: boolean;
    qualityPlaceholder: string;
    qualityPlaceholderTailored: boolean;
    reviewRoutingTranslated: boolean;
    generatedAgentCount: number;
    inviteTextVisible: boolean;
    inviteLightAnimationVisible: boolean;
    inviteSadState: boolean;
    inviteHappyCannonVisible: boolean;
    tourVisibleAfterSetup: boolean;
    tourCornerLogoRemoved: boolean;
    setupTabHiddenAfterComplete: boolean;
    supervisorWorkbenchVisible: boolean;
    workbenchConfigSaved: boolean;
    resetPanelVisible: boolean;
    securityIntroUpdated: boolean;
    localizedRecoveryQuestions: boolean;
    configuredSecurityRequiresCurrent: boolean;
    cancelModifyReturnsLocked: boolean;
    modelFlowVisible: boolean;
    agentPageUsesSupervisorName: boolean;
    specialistAgentsPending: boolean;
    agentConfigButtonOrange: boolean;
    expandedAgentConfigVisible: boolean;
    englishResetButtonsFit: boolean;
    resetApiKeyRetained: boolean;
    supervisorPromptHasGuardrails: boolean;
    consoleVisibleAfterComplete: boolean;
    collapsed: boolean;
    setupCompleted: boolean;
    language: string;
  };
}

async function runMemoryFlow(page: CdpClient) {
  const prepareExpression = String.raw`
    (() => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("honeycomb.tourCompleted", "true");
      localStorage.setItem("honeycomb.setupCompleted", "true");
      localStorage.setItem("agentOpenClaw.language", "zh");
      location.search = "?lang=zh&skipOnboarding=true";
    })()
  `;

  await page.send("Runtime.evaluate", { expression: prepareExpression, awaitPromise: false });
  await page.send("Page.loadEventFired", {}, 10_000).catch(() => undefined);

  const expression = String.raw`
    (async () => {
      const apiUrl = "${apiUrl}";
      const apiAuthToken = ${JSON.stringify(apiAuthToken)};
      const apiHeaders = apiAuthToken ? { authorization: "Bearer " + apiAuthToken } : {};
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (fn, message, timeoutMs = 90000) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const value = await fn();
          if (value) return value;
          await sleep(150);
        }
        throw new Error(message);
      };

      await waitFor(() => document.querySelector(".dashboardPage"), "dashboard did not load");
      const marker = "Desktop memory UI smoke " + Math.random().toString(16).slice(2);
      const created = await fetch(apiUrl + "/jobs", {
        method: "POST",
        headers: { ...apiHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          prompt: marker,
          requesterId: "desktop-memory-ui-smoke",
          routingMode: "pipeline",
          maxModelCalls: 20
        })
      }).then((response) => response.json());

      await waitFor(async () => {
        const job = await fetch(apiUrl + "/jobs/" + created.jobId, { headers: apiHeaders }).then((response) => response.json());
        return job.status === "succeeded";
      }, "memory smoke job did not succeed");

      await waitFor(async () => {
        const response = await fetch(apiUrl + "/memory/experiences?status=candidate&limit=200", { headers: apiHeaders })
          .then((candidateResponse) => candidateResponse.json());
        return response.experiences.some((experience) => experience.sourceJobId === created.jobId);
      }, "memory candidate was not created");

      const memoryNav = await waitFor(
        () => Array.from(document.querySelectorAll(".navItem"))
          .find((button) => button.textContent.includes("记忆")),
        "memory navigation item missing"
      );
      memoryNav.click();

      const card = await waitFor(
        () => Array.from(document.querySelectorAll(".experienceCard"))
          .find((candidate) => candidate.textContent.includes(created.jobId)),
        "memory candidate card missing"
      );
      const localizedSummary = card.textContent.includes("成功完成一次任务");
      const evidenceVisible = card.textContent.includes("证据");
      const adopt = card.querySelector('[data-testid="experience-adopt"]');
      adopt.click();

      await waitFor(
        () => !Array.from(document.querySelectorAll(".experienceCard"))
          .some((candidate) => candidate.textContent.includes(created.jobId)),
        "adopted card did not leave candidate filter"
      );

      const adoptedFilter = await waitFor(
        () => Array.from(document.querySelectorAll(".memoryFilterButton"))
          .find((button) => button.textContent.includes("已采纳")),
        "adopted filter missing"
      );
      adoptedFilter.click();

      const adoptedCard = await waitFor(
        () => Array.from(document.querySelectorAll(".experienceCard"))
          .find((candidate) =>
            candidate.textContent.includes(created.jobId) &&
            candidate.querySelector(".experienceStatus.adopted")
          ),
        "adopted experience card missing"
      );
      const counts = Array.from(document.querySelectorAll(".memoryStates strong"))
        .map((node) => Number(node.textContent.trim()));

      return {
        jobId: created.jobId,
        localizedSummary,
        evidenceVisible,
        adoptedStatusVisible: Boolean(adoptedCard),
        candidateCount: counts[0],
        adoptedCount: counts[1],
        rejectedCount: counts[2],
        language: localStorage.getItem("agentOpenClaw.language")
      };
    })()
  `;

  const result = await page.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, 120_000);

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Memory UI flow failed");
  }
  return result.result.value as {
    jobId: string;
    localizedSummary: boolean;
    evidenceVisible: boolean;
    adoptedStatusVisible: boolean;
    candidateCount: number;
    adoptedCount: number;
    rejectedCount: number;
    language: string;
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function main() {
  logStep(`mode=${mode}; skipApiStart=${skipApiStart}; onboardingMode=${onboardingMode}; memoryMode=${memoryMode}; uiUrl=${uiUrl}`);
  await ensureApiAuthToken();
  await mkdir(runtimeDir, { recursive: true });
  await rm(screenshotPath, { force: true });
  const smokeLock = skipApiStart ? null : await acquireSmokeLock("dev-stack");

  let vite: ChildProcess | null = null;
  let staticServer: Server | null = null;
  let browser: ChildProcess | null = null;

  try {
    if (mode === "prod") {
      logStep("building desktop production bundle");
      await run(npmCommand(), ["run", "build"], {
        cwd: desktopDir,
        shell: process.platform === "win32",
        env: {
          ...process.env,
          VITE_ORCHESTRATOR_URL: apiUrl,
          VITE_HONEYCOMB_API_TOKEN: apiAuthToken
        }
      });
      logStep("desktop production bundle built");
    }

    if (onboardingMode) {
      logStep("onboarding mode does not require backend API");
    } else if (skipApiStart) {
      logStep("waiting for existing API health");
      await waitForHttp(`${apiUrl}/health`, 60_000);
    } else {
      logStep("starting local API");
      await run(npmCommand(), ["run", "dev:start"], {
        shell: process.platform === "win32",
        env: {
          ...process.env,
          FEISHU_ADAPTER_ENABLED: "false",
          FEISHU_DRY_RUN: "true",
          OPENCLAW_AGENT_MODE: "mock",
          HONEYCOMB_API_TOKEN: apiAuthToken,
          AGENT_CLUSTER_CONFIG_PATH: "",
          ORCHESTRATOR_CORS_ORIGINS: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://127.0.0.1:5174",
            "tauri://localhost"
          ].join(",")
        }
      });
    }

    if (mode === "prod") {
      logStep(`serving production bundle on ${uiUrl}`);
      staticServer = await startStaticServer(path.join(desktopDir, "dist"), uiPort);
    } else if (!(await isHttpReady(uiUrl))) {
      logStep(`starting Vite dev server on ${uiUrl}`);
      vite = spawnManaged(npmCommand(), ["run", "dev"], {
        cwd: desktopDir,
        shell: process.platform === "win32",
        env: {
          ...process.env,
          VITE_ORCHESTRATOR_URL: apiUrl,
          VITE_HONEYCOMB_API_TOKEN: apiAuthToken
        }
      });
      vite.stdout?.on("data", (chunk) => process.stdout.write(chunk));
      vite.stderr?.on("data", (chunk) => process.stderr.write(chunk));
    }

    const browserPort = await getFreePort();
    const browserPath = await findBrowser();
    logStep(`launching browser: ${browserPath}`);
    const userDataDir = path.join(runtimeDir, "browser-profile");
    await rm(userDataDir, { recursive: true, force: true });

    const browserArgs = [
      "--headless=new",
      "--disable-gpu",
      "--window-size=1440,980",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-component-extensions-with-background-pages",
      `--remote-debugging-port=${browserPort}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank"
    ];

    if (process.env.CI === "true" || process.platform === "linux") {
      browserArgs.splice(2, 0, "--no-sandbox", "--disable-dev-shm-usage");
    }

    browser = spawnManaged(
      browserPath,
      browserArgs,
      { stdio: "ignore" }
    );

    logStep("waiting for browser DevTools");
    await waitForHttp(`http://127.0.0.1:${browserPort}/json/version`, 30_000);
    logStep("waiting for UI");
    await waitForHttp(uiUrl, 60_000);

    const initialUiUrl = onboardingMode ? uiUrl : `${uiUrl}?skipOnboarding=true`;
    const page = await openPage(browserPort, initialUiUrl);
    try {
      logStep("running browser UI flow");
      const flow = memoryMode
        ? await withTimeout(runMemoryFlow(page), 120_000, "desktop memory browser flow")
        : onboardingMode
          ? await withTimeout(runOnboardingFlow(page), 90_000, "desktop onboarding browser flow")
          : await withTimeout(runUiFlow(page), 120_000, "desktop UI browser flow");
      const screenshot = await page.send("Page.captureScreenshot", { format: "png" });
      await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

      if (memoryMode) {
        const memoryFlow = flow as Awaited<ReturnType<typeof runMemoryFlow>>;
        console.log(
          JSON.stringify(
            {
              ok: true,
              mode,
              memoryMode,
              url: uiUrl,
              ...memoryFlow,
              screenshotPath,
              checked: [
                "successful_job_creates_memory_candidate",
                "memory_page_lists_candidate",
                "chinese_memory_summary",
                "source_evidence_visible",
                "adopt_candidate_from_desktop",
                "adopted_filter_and_counts"
              ]
            },
            null,
            2
          )
        );
        return;
      }

      if (onboardingMode) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              mode,
              onboardingMode,
              url: uiUrl,
              ...flow,
              screenshotPath,
              checked: [
                "first_run_before_guided_tour",
                "supervisor_agent_name_required",
                "provider_title_and_intro_updated",
                "provider_fields_simplified",
                "supervisor_controls_compact",
                "provider_back_navigation",
                "api_key_visibility_toggle",
                "interview_back_navigation",
                "interview_next_compact",
                "navigation_locked_before_setup",
                "provider_only_stage",
                "thinking_state",
                "tailored_role_placeholder",
                "generated_work_options",
                "unseeded_domain_tailoring",
                "panel_supervisor_prompt_guardrails",
                "agent_profile_review",
                "guided_tour_after_setup",
                "navigation_unlocked_after_setup",
                "security_requires_current_password",
                "model_page_routing_flow_chart",
                "agent_page_pending_specialist_keys",
                "english_reset_panel_fits",
                "sidebar_collapse"
              ]
            },
            null,
            2
          )
        );
        return;
      }

      const jobFlow = flow as Awaited<ReturnType<typeof runUiFlow>>;
      console.log(
        JSON.stringify(
          {
            ok: true,
            mode,
            skipApiStart,
            url: uiUrl,
            jobId: jobFlow.jobId,
            terminalStatus: jobFlow.terminalStatus,
            cancelAttempted: jobFlow.cancelAttempted,
            jobRequestIncludesWorkbench: jobFlow.jobRequestIncludesWorkbench,
            smartRoutingVisible: jobFlow.smartRoutingVisible,
            manualRoutingHidden: jobFlow.manualRoutingHidden,
            statusVisible: jobFlow.statusVisible,
            filteredJobVisible: jobFlow.filteredJobVisible,
            filteredStatuses: jobFlow.filteredStatuses,
            timeFilterVisible: jobFlow.timeFilterVisible,
            customSinceVisible: jobFlow.customSinceVisible,
            timelineCursorRequests: jobFlow.timelineCursorRequests,
            timelineItems: jobFlow.timelineItems,
            screenshotPath,
            checked: [
              "desktop_ui_load",
              mode === "prod" ? "prod_bundle_served" : "vite_dev_server",
              "smart_routing_replaces_manual_select",
              "supervisor_workbench_context_sent_to_job",
              "create_job_from_ui",
              "job_list_selection",
              jobFlow.cancelAttempted ? "cancel_job_from_ui" : "skip_cancel_already_terminal",
              "job_terminal_status_visible",
              "job_filter_search_visible",
              "job_filter_time_window_visible",
              "timeline_cursor_used",
              "timeline_rendered"
            ]
          },
          null,
          2
        )
      );
    } finally {
      page.close();
    }
  } finally {
    browser?.kill("SIGKILL");
    if (vite) {
      vite.kill();
    }
    if (staticServer) {
      const server = staticServer;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await releaseSmokeLock(smokeLock);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
