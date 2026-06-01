import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rm, stat, unlink, writeFile, type FileHandle } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import net from "node:net";
import path from "node:path";

declare const WebSocket: any;

const root = path.resolve(__dirname, "..");
const desktopDir = path.join(root, "apps", "desktop-app");
const runtimeDir = path.join(root, ".runtime", "desktop-ui-smoke");
const apiUrl = "http://localhost:3000";
const mode = process.argv.includes("--prod") ? "prod" : "dev";
const skipApiStart = process.argv.includes("--skip-api-start");
const uiPort = Number(process.env.DESKTOP_UI_SMOKE_PORT ?? (mode === "prod" ? 5174 : 5173));
const uiUrl = `http://127.0.0.1:${uiPort}`;
const screenshotPath = path.join(runtimeDir, `desktop-ui-${mode}-smoke.png`);

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

  return ["google-chrome", "chromium", "chromium-browser", "microsoft-edge"];
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

  send(method: string, params: Record<string, unknown> = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`Timed out waiting for CDP method ${method}`));
        }
      }, 20_000);
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
      const originalFetch = window.fetch.bind(window);
      window.fetch = (...args) => {
        const target = args[0];
        window.__agentOpenClawFetchUrls.push(
          typeof target === "string" ? target : target?.url ?? String(target)
        );
        return originalFetch(...args);
      };

      await waitFor(() => document.querySelector("#prompt"), "prompt field missing");

      const beforeJobIds = new Set(
        Array.from(document.querySelectorAll(".jobRow strong"))
          .map((node) => node.textContent?.trim() ?? "")
          .filter((text) => text.startsWith("JOB-"))
      );

      const prompt = document.querySelector("#prompt");
      const routingMode = document.querySelector("#routingMode");
      const maxModelCalls = document.querySelector("#maxModelCalls");
      const submitButton = Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent.trim() === "Start Job");

      setNativeValue(prompt, "Desktop UI smoke: create a cancellable mock job and show the timeline.");
      setNativeValue(routingMode, "supervisor_pipeline");
      setNativeValue(maxModelCalls, "20");
      submitButton.click();

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

      const cancelButton = await waitFor(() => {
        const button = document.querySelector(".dangerButton");
        return button && !button.disabled ? button : null;
      }, "cancel button was not enabled");
      cancelButton.click();

      await waitFor(() => {
        const text = document.body.textContent;
        return text.includes(jobId) && text.includes("cancelled");
      }, "job did not become cancelled", 90000);

      const search = await waitFor(() => document.querySelector("#jobSearch"), "job search field missing");
      setNativeValue(search, "Desktop UI smoke");
      const cancelledFilter = await waitFor(
        () => document.querySelector('.filterSegment[data-filter="cancelled"]'),
        "cancelled filter missing"
      );
      cancelledFilter.click();

      await waitFor(() => {
        const rows = Array.from(document.querySelectorAll(".jobRow"));
        const statuses = rows.map((row) => row.querySelector(".jobStatus")?.textContent?.trim() ?? "");
        return rows.some((row) => row.querySelector("strong")?.textContent?.trim() === jobId) &&
          statuses.length > 0 &&
          statuses.every((status) => status === "cancelled");
      }, "cancelled/search filters did not keep created job visible");

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
        statusVisible: document.body.textContent.includes("cancelled"),
        filteredJobVisible: Array.from(document.querySelectorAll(".jobRow"))
          .some((row) => row.querySelector("strong")?.textContent?.trim() === jobId),
        filteredStatuses: Array.from(document.querySelectorAll(".jobRow .jobStatus"))
          .map((node) => node.textContent?.trim() ?? ""),
        timeFilterVisible: Boolean(document.querySelector('.filterSegment.active[data-time-filter="custom"]')),
        customSinceVisible: Boolean(document.querySelector("#jobSince")),
        timelineCursorRequests,
        timelineItems: document.querySelectorAll(".timelineItem").length,
        title: document.querySelector(".jobDetail h2")?.textContent?.trim() ?? ""
      };
    })()
  `;

  const result = await page.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "UI flow failed");
  }

  return result.result.value as {
    jobId: string;
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
  logStep(`mode=${mode}; skipApiStart=${skipApiStart}; uiUrl=${uiUrl}`);
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
          VITE_ORCHESTRATOR_URL: apiUrl
        }
      });
      logStep("desktop production bundle built");
    }

    if (skipApiStart) {
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
          VITE_ORCHESTRATOR_URL: apiUrl
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

    browser = spawnManaged(
      browserPath,
      [
        "--headless=new",
        "--disable-gpu",
        "--window-size=1440,980",
        "--no-first-run",
        "--no-default-browser-check",
        `--remote-debugging-port=${browserPort}`,
        `--user-data-dir=${userDataDir}`,
        "about:blank"
      ],
      { stdio: "ignore" }
    );

    logStep("waiting for browser DevTools");
    await waitForHttp(`http://127.0.0.1:${browserPort}/json/version`, 30_000);
    logStep("waiting for UI");
    await waitForHttp(uiUrl, 60_000);

    const page = await openPage(browserPort, uiUrl);
    try {
      logStep("running browser UI flow");
      const flow = await withTimeout(runUiFlow(page), 120_000, "desktop UI browser flow");
      const screenshot = await page.send("Page.captureScreenshot", { format: "png" });
      await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

      console.log(
        JSON.stringify(
          {
            ok: true,
            mode,
            skipApiStart,
            url: uiUrl,
            jobId: flow.jobId,
            statusVisible: flow.statusVisible,
            filteredJobVisible: flow.filteredJobVisible,
            filteredStatuses: flow.filteredStatuses,
            timeFilterVisible: flow.timeFilterVisible,
            customSinceVisible: flow.customSinceVisible,
            timelineCursorRequests: flow.timelineCursorRequests,
            timelineItems: flow.timelineItems,
            screenshotPath,
            checked: [
              "desktop_ui_load",
              mode === "prod" ? "prod_bundle_served" : "vite_dev_server",
              "create_job_from_ui",
              "job_list_selection",
              "cancel_job_from_ui",
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
