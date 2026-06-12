import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import type { McpServerRecord } from "../../../packages/shared/src/types";

export class McpToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

export const DEFAULT_MCP_TIMEOUT_MS = 30_000;
export const DEFAULT_MCP_MAX_OUTPUT_BYTES = 256 * 1024;
export const HARD_MCP_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_SWEEP_INTERVAL_MS = 30_000;

// JSON-RPC error responses leave the stdio stream healthy; every other failure
// (timeout, parse error, output overflow, process exit) leaves the stream in an
// untrusted state, so the session must be dropped.
const SESSION_SAFE_ERROR_CODES = new Set(["mcp_request_failed"]);

function clampNumber(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(value ?? fallback), min), max);
}

function commandPreview(parts: string[]) {
  return parts.map((part) => (/\s/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part)).join(" ");
}

function clipped(value: string, maxBytes: number) {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) {
    return value;
  }
  return buffer.subarray(0, maxBytes).toString("utf8");
}

function collectEnv(envKeys: string[]) {
  const env: NodeJS.ProcessEnv = {};
  for (const key of envKeys) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

function safeJsonLine(message: JsonRpcMessage) {
  const line = JSON.stringify(message);
  if (line.includes("\n") || line.includes("\r")) {
    throw new McpToolError("mcp_message_newline", "MCP stdio JSON-RPC messages must be one line.");
  }
  return `${line}\n`;
}

function parseJsonRpcLine(line: string): JsonRpcMessage | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new McpToolError("invalid_mcp_response", "MCP server returned a non-object JSON-RPC message.");
  }
  return parsed as JsonRpcMessage;
}

export function mcpServerSessionFingerprint(server: McpServerRecord) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        command: server.command,
        args: server.args,
        envKeys: server.envKeys,
        enabled: server.enabled
      })
    )
    .digest("hex")
    .slice(0, 16);
}

export type McpSessionRequestOptions = {
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export type McpSessionInfo = {
  pid: number | null;
  createdAt: string;
  requestCount: number;
  reusedSession: boolean;
};

export type McpSessionRequestResult = {
  result: unknown;
  stderr: string;
  durationMs: number;
  displayCommand: string;
  session: McpSessionInfo;
};

export type McpSessionStats = {
  serverId: string;
  serverName: string;
  pid: number | null;
  fingerprint: string;
  createdAt: string;
  lastUsedAt: string;
  requestCount: number;
};

class McpSession {
  readonly createdAt = new Date();
  lastUsedAt = new Date();
  requestCount = 0;
  closed = false;
  closeReason: McpToolError | null = null;

  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string | number, {
    resolve: (message: JsonRpcMessage) => void;
    reject: (error: unknown) => void;
  }>();
  private stdoutBuffer = "";
  private callStderr = "";
  private sessionStderr = "";
  private nextRequestId = 1;
  private initializedPromise: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private activeCall: { maxOutputBytes: number; bytes: number } | null = null;

  constructor(
    readonly server: McpServerRecord,
    readonly fingerprint: string,
    private readonly onClosed: (session: McpSession) => void
  ) {
    this.child = spawn(server.command, server.args, {
      env: {
        PATH: process.env.PATH,
        ...collectEnv(server.envKeys)
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    this.child.once("error", (error) => {
      this.destroy(
        new McpToolError("mcp_process_failed", error.message, {
          command: this.displayCommand
        })
      );
    });

    this.child.once("exit", (code, signal) => {
      this.destroy(
        new McpToolError("mcp_process_exited", "MCP server process exited.", {
          exitCode: code,
          signal,
          stderr: clipped(this.sessionStderr, 4000)
        })
      );
    });

    this.child.stdin.on("error", (error) => {
      this.destroy(
        new McpToolError("mcp_process_failed", error.message, {
          command: this.displayCommand
        })
      );
    });

    this.child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      this.callStderr = clipped(this.callStderr + text, 8000);
      this.sessionStderr = clipped(this.sessionStderr + text, 8000);
    });

    this.child.stdout.on("data", (chunk: Buffer) => {
      this.onStdout(chunk);
    });
  }

  get displayCommand() {
    return commandPreview([this.server.command, ...this.server.args]);
  }

  get pid() {
    return this.child.pid ?? null;
  }

  call(
    method: string,
    params: Record<string, unknown>,
    options: McpSessionRequestOptions
  ): Promise<McpSessionRequestResult> {
    const run = this.queue.then(() => this.runCall(method, params, options));
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  destroy(reason: McpToolError) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.closeReason = reason;
    for (const entry of this.pending.values()) {
      entry.reject(reason);
    }
    this.pending.clear();
    this.child.removeAllListeners("exit");
    this.child.kill();
    this.onClosed(this);
  }

  private onStdout(chunk: Buffer) {
    try {
      if (this.activeCall) {
        this.activeCall.bytes += chunk.length;
        if (this.activeCall.bytes > this.activeCall.maxOutputBytes) {
          throw new McpToolError(
            "mcp_output_limit_exceeded",
            "MCP server output exceeded the configured limit.",
            { maxOutputBytes: this.activeCall.maxOutputBytes }
          );
        }
      }

      this.stdoutBuffer += chunk.toString("utf8");
      if (this.stdoutBuffer.length > HARD_MCP_MAX_OUTPUT_BYTES) {
        throw new McpToolError(
          "mcp_output_limit_exceeded",
          "MCP server sent an oversized JSON-RPC line.",
          { maxOutputBytes: HARD_MCP_MAX_OUTPUT_BYTES }
        );
      }

      for (;;) {
        const newlineIndex = this.stdoutBuffer.indexOf("\n");
        if (newlineIndex < 0) {
          break;
        }
        const line = this.stdoutBuffer.slice(0, newlineIndex);
        this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
        const message = parseJsonRpcLine(line);
        if (!message || message.id === undefined || message.id === null) {
          continue;
        }
        const entry = this.pending.get(message.id);
        if (entry) {
          this.pending.delete(message.id);
          entry.resolve(message);
        }
      }
    } catch (error) {
      this.destroy(
        error instanceof McpToolError
          ? error
          : new McpToolError(
              "invalid_mcp_response",
              error instanceof Error ? error.message : String(error)
            )
      );
    }
  }

  private sendMessage(message: JsonRpcMessage) {
    if (this.closed) {
      throw this.closeReason ?? new McpToolError("mcp_session_closed", "MCP session is closed.");
    }
    this.child.stdin.write(safeJsonLine(message));
  }

  private rpcRequest(method: string, params: Record<string, unknown>) {
    const id = this.nextRequestId++;
    return new Promise<JsonRpcMessage>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.sendMessage({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private async ensureInitialized() {
    if (!this.initializedPromise) {
      this.initializedPromise = (async () => {
        const initialize = await this.rpcRequest("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: {
            name: "honeycomb",
            version: "0.1.0"
          }
        });
        if (initialize.error) {
          throw new McpToolError(
            "mcp_initialize_failed",
            initialize.error.message ?? "MCP initialize failed.",
            { error: initialize.error }
          );
        }
        this.sendMessage({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {}
        });
      })();
    }
    await this.initializedPromise;
  }

  private async runCall(
    method: string,
    params: Record<string, unknown>,
    options: McpSessionRequestOptions
  ): Promise<McpSessionRequestResult> {
    if (this.closed) {
      throw this.closeReason ?? new McpToolError("mcp_session_closed", "MCP session is closed.");
    }

    const timeoutMs = clampNumber(options.timeoutMs, DEFAULT_MCP_TIMEOUT_MS, 1000, 120_000);
    const maxOutputBytes = clampNumber(
      options.maxOutputBytes,
      DEFAULT_MCP_MAX_OUTPUT_BYTES,
      1,
      HARD_MCP_MAX_OUTPUT_BYTES
    );
    const startedAt = Date.now();
    const reusedSession = this.requestCount > 0;
    this.callStderr = "";
    this.activeCall = { maxOutputBytes, bytes: 0 };
    this.lastUsedAt = new Date();

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new McpToolError("mcp_call_timeout", "MCP tool call timed out.", { timeoutMs, method }));
      }, timeoutMs);
    });

    try {
      const work = (async () => {
        await this.ensureInitialized();
        const response = await this.rpcRequest(method, params);
        if (response.error) {
          throw new McpToolError("mcp_request_failed", response.error.message ?? "MCP request failed.", {
            method,
            error: response.error
          });
        }
        return response.result;
      })();

      const result = await Promise.race([work, timeout]);
      this.requestCount += 1;
      this.lastUsedAt = new Date();

      return {
        result,
        stderr: clipped(this.callStderr, 8000),
        durationMs: Date.now() - startedAt,
        displayCommand: this.displayCommand,
        session: {
          pid: this.pid,
          createdAt: this.createdAt.toISOString(),
          requestCount: this.requestCount,
          reusedSession
        }
      };
    } catch (error) {
      const toolError =
        error instanceof McpToolError
          ? error
          : new McpToolError("mcp_request_failed", error instanceof Error ? error.message : String(error));
      if (!SESSION_SAFE_ERROR_CODES.has(toolError.code)) {
        this.destroy(toolError);
      }
      throw toolError;
    } finally {
      clearTimeout(timer);
      this.activeCall = null;
    }
  }
}

export type McpSessionManagerOptions = {
  idleTimeoutMs?: number;
  sweepIntervalMs?: number;
};

export class McpSessionManager {
  private readonly sessions = new Map<string, McpSession>();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: McpSessionManagerOptions = {}) {}

  async request(
    server: McpServerRecord,
    method: string,
    params: Record<string, unknown>,
    options: McpSessionRequestOptions = {}
  ): Promise<McpSessionRequestResult> {
    if (!server.enabled) {
      this.invalidate(server.id, "mcp_server_disabled");
      throw new McpToolError("mcp_server_disabled", "MCP server is disabled.", {
        serverId: server.id
      });
    }
    return this.acquire(server).call(method, params, options);
  }

  invalidate(serverId: string, code = "mcp_session_invalidated") {
    const session = this.sessions.get(serverId);
    if (!session) {
      return false;
    }
    session.destroy(
      new McpToolError(code, "MCP session was invalidated.", { serverId })
    );
    this.sessions.delete(serverId);
    return true;
  }

  closeAll(code = "mcp_session_shutdown") {
    for (const serverId of [...this.sessions.keys()]) {
      this.invalidate(serverId, code);
    }
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  sweepIdleSessions(now = Date.now()) {
    const idleTimeoutMs = this.idleTimeoutMs();
    let closedCount = 0;
    for (const [serverId, session] of [...this.sessions]) {
      if (now - session.lastUsedAt.getTime() >= idleTimeoutMs) {
        this.invalidate(serverId, "mcp_session_idle_closed");
        closedCount += 1;
      }
    }
    return closedCount;
  }

  stats(): McpSessionStats[] {
    return [...this.sessions.values()].map((session) => ({
      serverId: session.server.id,
      serverName: session.server.name,
      pid: session.pid,
      fingerprint: session.fingerprint,
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: session.lastUsedAt.toISOString(),
      requestCount: session.requestCount
    }));
  }

  private idleTimeoutMs() {
    if (this.options.idleTimeoutMs !== undefined) {
      return Math.max(this.options.idleTimeoutMs, 1);
    }
    const fromEnv = Number(process.env.HONEYCOMB_MCP_SESSION_IDLE_MS);
    return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_IDLE_TIMEOUT_MS;
  }

  private acquire(server: McpServerRecord): McpSession {
    const fingerprint = mcpServerSessionFingerprint(server);
    const existing = this.sessions.get(server.id);
    if (existing && !existing.closed && existing.fingerprint === fingerprint) {
      return existing;
    }
    if (existing) {
      existing.destroy(
        new McpToolError("mcp_session_invalidated", "MCP server configuration changed.", {
          serverId: server.id
        })
      );
      this.sessions.delete(server.id);
    }

    const session = new McpSession(server, fingerprint, (closedSession) => {
      if (this.sessions.get(server.id) === closedSession) {
        this.sessions.delete(server.id);
      }
    });
    this.sessions.set(server.id, session);
    this.ensureSweeper();
    return session;
  }

  private ensureSweeper() {
    if (this.sweepTimer) {
      return;
    }
    const interval = Math.max(this.options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS, 1000);
    this.sweepTimer = setInterval(() => {
      this.sweepIdleSessions();
    }, interval);
    this.sweepTimer.unref?.();
  }
}

export const mcpSessionManager = new McpSessionManager();

export function invalidateMcpSession(serverId: string) {
  return mcpSessionManager.invalidate(serverId);
}

export function closeAllMcpSessions() {
  mcpSessionManager.closeAll();
}

export function listMcpSessionStats() {
  return mcpSessionManager.stats();
}
