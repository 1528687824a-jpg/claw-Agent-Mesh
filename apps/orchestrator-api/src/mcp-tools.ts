import type { McpServerRecord } from "../../../packages/shared/src/types";
import {
  mcpSessionManager,
  type McpSessionInfo
} from "./mcp-sessions";

export { McpToolError } from "./mcp-sessions";

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
  session: McpSessionInfo;
};

export type McpListResult = {
  serverId: string;
  serverName: string;
  method: "tools/list" | "resources/list";
  displayCommand: string;
  result: unknown;
  stderr: string;
  durationMs: number;
  session: McpSessionInfo;
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
  session: McpSessionInfo;
};

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
  const response = await mcpSessionManager.request(input.server, input.method, input.params ?? {}, {
    timeoutMs: input.timeoutMs,
    maxOutputBytes: input.maxOutputBytes
  });

  return {
    serverId: input.server.id,
    serverName: input.server.name,
    method: input.method,
    displayCommand: response.displayCommand,
    result: response.result,
    stderr: response.stderr,
    durationMs: response.durationMs,
    session: response.session
  };
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
    durationMs: result.durationMs,
    session: result.session
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
