import { spawn } from "node:child_process";
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

export type McpToolCallInput = {
  server: McpServerRecord;
  toolName: string;
  arguments?: Record<string, unknown>;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export type McpToolCallResult = {
  serverId: string;
  serverName: string;
  toolName: string;
  displayCommand: string;
  result: unknown;
  stderr: string;
  durationMs: number;
};

export type McpListResult = {
  serverId: string;
  serverName: string;
  method: "tools/list" | "resources/list";
  displayCommand: string;
  result: unknown;
  stderr: string;
  durationMs: number;
};

type McpRequestInput = {
  server: McpServerRecord;
  method: "tools/call" | "tools/list" | "resources/list";
  params?: Record<string, unknown>;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

type McpRequestResult = {
  serverId: string;
  serverName: string;
  method: "tools/call" | "tools/list" | "resources/list";
  displayCommand: string;
  result: unknown;
  stderr: string;
  durationMs: number;
};

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

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const HARD_MAX_OUTPUT_BYTES = 1024 * 1024;

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

export function formatMcpToolTarget(serverId: string, toolName: string) {
  return `mcp://${encodeURIComponent(serverId)}/${encodeURIComponent(toolName)}`;
}

export function formatMcpToolCommand(server: McpServerRecord, toolName: string) {
  return `MCP ${server.name} tools/call ${toolName}`;
}

export function formatMcpListTarget(serverId: string, method: "tools/list" | "resources/list") {
  return `mcp://${encodeURIComponent(serverId)}/${method}`;
}

export function formatMcpListCommand(server: McpServerRecord, method: "tools/list" | "resources/list") {
  return `MCP ${server.name} ${method}`;
}

async function runMcpRequest(input: McpRequestInput): Promise<McpRequestResult> {
  if (!input.server.enabled) {
    throw new McpToolError("mcp_server_disabled", "MCP server is disabled.", {
      serverId: input.server.id
    });
  }

  const timeoutMs = clampNumber(input.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 120_000);
  const maxOutputBytes = clampNumber(input.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, 1, HARD_MAX_OUTPUT_BYTES);
  const startedAt = Date.now();
  const displayCommand = commandPreview([input.server.command, ...input.server.args]);

  return new Promise((resolve, reject) => {
    const child = spawn(input.server.command, input.server.args, {
      env: {
        PATH: process.env.PATH,
        ...collectEnv(input.server.envKeys)
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    let stdoutBuffer = "";
    let stdoutBytes = 0;
    let stderr = "";
    let settled = false;
    const pending = new Map<string | number, (message: JsonRpcMessage) => void>();

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.kill();
      callback();
    };

    const fail = (error: unknown) => {
      finish(() => {
        reject(error);
      });
    };

    const send = (message: JsonRpcMessage) => {
      child.stdin.write(safeJsonLine(message));
    };

    const request = (message: JsonRpcMessage) =>
      new Promise<JsonRpcMessage>((requestResolve, requestReject) => {
        if (message.id === undefined || message.id === null) {
          requestReject(new McpToolError("invalid_mcp_request", "MCP JSON-RPC request needs an id."));
          return;
        }
        pending.set(message.id, requestResolve);
        try {
          send(message);
        } catch (error) {
          pending.delete(message.id);
          requestReject(error);
        }
      });

    const timer = setTimeout(() => {
      fail(new McpToolError("mcp_call_timeout", "MCP tool call timed out.", { timeoutMs }));
    }, timeoutMs);

    child.once("error", (error) => {
      fail(new McpToolError("mcp_process_failed", error.message, {
        command: displayCommand
      }));
    });

    child.once("exit", (code, signal) => {
      if (settled) {
        return;
      }
      fail(new McpToolError("mcp_process_exited", "MCP server exited before the tool call completed.", {
        exitCode: code,
        signal,
        stderr: clipped(stderr, 4000)
      }));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = clipped(stderr + chunk.toString("utf8"), 8000);
    });

    child.stdout.on("data", (chunk: Buffer) => {
      try {
        stdoutBytes += chunk.length;
        if (stdoutBytes > maxOutputBytes) {
          throw new McpToolError("mcp_output_limit_exceeded", "MCP server output exceeded the configured limit.", {
            maxOutputBytes
          });
        }

        stdoutBuffer += chunk.toString("utf8");
        for (;;) {
          const newlineIndex = stdoutBuffer.indexOf("\n");
          if (newlineIndex < 0) {
            break;
          }
          const line = stdoutBuffer.slice(0, newlineIndex);
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
          const message = parseJsonRpcLine(line);
          if (!message || message.id === undefined || message.id === null) {
            continue;
          }
          const resolver = pending.get(message.id);
          if (resolver) {
            pending.delete(message.id);
            resolver(message);
          }
        }
      } catch (error) {
        fail(error);
      }
    });

    (async () => {
      const initialize = await request({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: {
            name: "honeycomb",
            version: "0.1.0"
          }
        }
      });
      if (initialize.error) {
        throw new McpToolError("mcp_initialize_failed", initialize.error.message ?? "MCP initialize failed.", {
          error: initialize.error
        });
      }

      send({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {}
      });

      const toolCall = await request({
        jsonrpc: "2.0",
        id: 2,
        method: input.method,
        params: input.params ?? {}
      });
      if (toolCall.error) {
        throw new McpToolError("mcp_request_failed", toolCall.error.message ?? "MCP request failed.", {
          method: input.method,
          error: toolCall.error
        });
      }

      finish(() => {
        resolve({
          serverId: input.server.id,
          serverName: input.server.name,
          method: input.method,
          displayCommand,
          result: toolCall.result,
          stderr: clipped(stderr, 8000),
          durationMs: Date.now() - startedAt
        });
      });
    })().catch(fail);
  });
}

export async function runMcpToolCall(input: McpToolCallInput): Promise<McpToolCallResult> {
  const result = await runMcpRequest({
    server: input.server,
    method: "tools/call",
    params: {
      name: input.toolName,
      arguments: input.arguments ?? {}
    },
    timeoutMs: input.timeoutMs,
    maxOutputBytes: input.maxOutputBytes
  });
  return {
    serverId: result.serverId,
    serverName: result.serverName,
    toolName: input.toolName,
    displayCommand: result.displayCommand,
    result: result.result,
    stderr: result.stderr,
    durationMs: result.durationMs
  };
}

export async function runMcpToolsList(input: {
  server: McpServerRecord;
  cursor?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}): Promise<McpListResult> {
  const result = await runMcpRequest({
    server: input.server,
    method: "tools/list",
    params: input.cursor ? { cursor: input.cursor } : {},
    timeoutMs: input.timeoutMs,
    maxOutputBytes: input.maxOutputBytes
  });
  return {
    ...result,
    method: "tools/list"
  };
}

export async function runMcpResourcesList(input: {
  server: McpServerRecord;
  cursor?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}): Promise<McpListResult> {
  const result = await runMcpRequest({
    server: input.server,
    method: "resources/list",
    params: input.cursor ? { cursor: input.cursor } : {},
    timeoutMs: input.timeoutMs,
    maxOutputBytes: input.maxOutputBytes
  });
  return {
    ...result,
    method: "resources/list"
  };
}
